// ─────────────────────────────────────────────────────────────────────────────
// Online tips (customer → gardener). ONLINE ONLY — there is deliberately no
// cash tip entry, reporting or reconciliation anywhere in the product.
//
// Invariants:
//   • Amounts are integer PAISE end-to-end.
//   • A tip is 'successful' only after server-side Razorpay verification
//     (checkout signature or webhook) — client redirects prove nothing.
//   • The ledger here is the single source of truth for every total shown in
//     the customer app, gardener app and admin panel.
//   • Payout allocation stamps tips atomically (payout_id set only where NULL)
//     so the same tip can never be paid twice.
//   • Completed records are never edited silently — every status transition
//     lands in tip_audits; corrections are reversal entries.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  Tip, TipPayout, TipAudit, Booking, User, SystemSetting, sequelize,
} = require('../models');

const IST_MIN = 330; // UTC+5:30

// ── Config (admin-editable suggested amounts + limits, in rupees) ────────────
const TIP_CONFIG_KEY = 'tip_config';
const DEFAULT_TIP_CONFIG = { suggested: [20, 50, 100, 200], min: 10, max: 5000 };

async function getTipConfig() {
  try {
    const row = await SystemSetting.findOne({ where: { key: TIP_CONFIG_KEY } });
    if (row?.value) {
      const c = JSON.parse(row.value);
      if (Array.isArray(c.suggested) && c.min > 0 && c.max >= c.min) return c;
    }
  } catch (_) { /* fall through to defaults */ }
  return DEFAULT_TIP_CONFIG;
}

exports.getConfig = async (req, res) => {
  try {
    res.json({ success: true, data: await getTipConfig() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.saveConfig = async (req, res) => {
  try {
    const suggested = (req.body?.suggested || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const min = parseInt(req.body?.min), max = parseInt(req.body?.max);
    if (!suggested.length || !(min > 0) || !(max >= min)) {
      return res.status(400).json({ success: false, message: 'Need suggested amounts and 0 < min <= max (rupees)' });
    }
    const value = JSON.stringify({ suggested, min, max });
    const [row] = await SystemSetting.findOrCreate({ where: { key: TIP_CONFIG_KEY }, defaults: { value } });
    if (row.value !== value) await row.update({ value });
    res.json({ success: true, message: 'Tip settings saved', data: { suggested, min, max } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Audit helper (best-effort: an audit hiccup never fails the transaction) ──
const audit = async (fields) => {
  try { await TipAudit.create(fields); } catch (e) { console.error('[tips] audit failed:', e.message); }
};

// ── 1) CREATE — customer opens a tip payment for an eligible completed visit ─
exports.createTip = async (req, res) => {
  try {
    const { booking_id, amount, idempotency_key } = req.body; // amount in RUPEES from the form
    const bid = parseInt(booking_id);
    if (!bid) return res.status(400).json({ success: false, message: 'booking_id is required' });

    const booking = await Booking.findByPk(bid);
    if (!booking) return res.status(404).json({ success: false, message: 'Visit not found' });
    if (booking.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'This visit is not yours' });
    }
    if (booking.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'You can tip only after the visit is completed' });
    }
    if (!booking.gardener_id) {
      return res.status(400).json({ success: false, message: 'No gardener was assigned to this visit' });
    }

    const cfg = await getTipConfig();
    const rupees = Math.round(Number(amount));
    if (!Number.isInteger(rupees) || rupees < cfg.min || rupees > cfg.max) {
      return res.status(400).json({ success: false, message: `Tip must be between ₹${cfg.min} and ₹${cfg.max}` });
    }
    const amount_paise = rupees * 100;

    // One successful tip per visit; a duplicate create for the same attempt
    // (retry / double-tap) returns the existing pending order instead.
    const already = await Tip.findOne({ where: { booking_id: bid, status: 'successful' } });
    if (already) return res.status(409).json({ success: false, message: 'This visit has already been tipped — thank you!' });

    const idem = String(idempotency_key || '').slice(0, 80) || null;
    if (idem) {
      const dup = await Tip.findOne({ where: { idempotency_key: idem } });
      if (dup && dup.status === 'pending') {
        return res.json({
          success: true,
          data: {
            tip_id: dup.id, key_id: process.env.RAZORPAY_KEY_ID, order_id: dup.gateway_order_id,
            amount: dup.amount_paise, currency: dup.currency, name: 'GharKaMali',
            description: `Tip for visit ${booking.booking_number || bid}`,
          },
        });
      }
      if (dup) return res.status(409).json({ success: false, message: 'This tip attempt was already processed' });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ success: false, message: 'Online payments are not configured' });
    }
    const Razorpay = require('razorpay');
    const instance = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const rzpOrder = await instance.orders.create({
      amount: amount_paise, currency: 'INR',
      receipt: `TIP-${bid}-${Date.now()}`,
      notes: { kind: 'tip', booking_id: String(bid), customer_id: String(req.user.id), gardener_id: String(booking.gardener_id) },
    });

    const tip = await Tip.create({
      customer_id: req.user.id,
      gardener_id: booking.gardener_id,
      booking_id: bid,
      amount: rupees, // legacy rupee mirror (NOT NULL on the live table)
      amount_paise,
      geofence_id: booking.geofence_id || null,
      gateway_order_id: rzpOrder.id,
      idempotency_key: idem,
      status: 'pending',
    });
    await audit({ tip_id: tip.id, actor_id: req.user.id, action: 'created', to_status: 'pending' });

    const customer = await User.findByPk(req.user.id, { attributes: ['name', 'email', 'phone'] });
    res.json({
      success: true,
      data: {
        tip_id: tip.id, key_id: process.env.RAZORPAY_KEY_ID, order_id: rzpOrder.id,
        amount: amount_paise, currency: 'INR', name: 'GharKaMali',
        description: `Tip for visit ${booking.booking_number || bid}`,
        prefill: { name: customer?.name || '', email: customer?.email || '', contact: customer?.phone || '' },
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Shared idempotent fulfillment — safe from both verify and the webhook.
async function fulfillTip(tip, paymentId, actorId) {
  if (tip.status === 'successful') return tip; // duplicate callback — no-op
  await tip.update({ status: 'successful', gateway_payment_id: paymentId || tip.gateway_payment_id, verified_at: new Date() });
  await audit({ tip_id: tip.id, actor_id: actorId || null, action: 'payment_verified', from_status: 'pending', to_status: 'successful' });
  // Tell the gardener (informational only — never determines payment status).
  try {
    const g = await User.findByPk(tip.gardener_id);
    if (g?.fcm_token) {
      const { notify } = require('../services/push.service');
      await notify.custom(g.fcm_token, 'You received a tip! 🎉', `A customer tipped you ₹${(tip.amount_paise / 100).toLocaleString('en-IN')}. See My Tips for details.`);
    }
  } catch (e) { console.error('[tips] gardener push failed:', e.message); }
  return tip;
}
// Webhook hook-in: called by payment.controller's webhook when an order id
// doesn't belong to a Payment row.
exports.fulfillTipByOrderId = async (orderId, paymentId) => {
  const tip = await Tip.findOne({ where: { gateway_order_id: orderId } });
  if (tip) await fulfillTip(tip, paymentId, null);
  return !!tip;
};

// ── 2) VERIFY — Razorpay Checkout signature, server-side only ────────────────
exports.verifyTip = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment verification fields' });
    }
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment signature verification failed' });
    }
    const tip = await Tip.findOne({ where: { gateway_order_id: razorpay_order_id } });
    if (!tip) return res.status(404).json({ success: false, message: 'Tip record not found' });
    if (tip.customer_id !== req.user.id) return res.status(403).json({ success: false, message: 'This tip does not belong to you' });

    await fulfillTip(tip, razorpay_payment_id, req.user.id);
    res.json({ success: true, message: 'Tip received — thank you!', data: { tip_id: tip.id, reference: razorpay_payment_id, amount_paise: tip.amount_paise } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Customer dismissed checkout — close the attempt so it never counts anywhere.
exports.cancelTip = async (req, res) => {
  try {
    const tip = await Tip.findOne({ where: { gateway_order_id: req.body.razorpay_order_id || req.body.order_id || '' } });
    if (!tip) return res.status(404).json({ success: false, message: 'Tip not found' });
    if (tip.customer_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not yours' });
    if (tip.status === 'successful') return res.status(409).json({ success: false, message: 'Tip already completed' });
    if (tip.status !== 'pending') return res.json({ success: true, message: 'Already closed' });
    await tip.update({ status: 'cancelled' });
    await audit({ tip_id: tip.id, actor_id: req.user.id, action: 'cancelled', from_status: 'pending', to_status: 'cancelled' });
    res.json({ success: true, message: 'Tip cancelled' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── IST window helpers (Today / This Month per Asia/Kolkata) ─────────────────
function istWindows() {
  const ist = new Date(Date.now() + IST_MIN * 60000);
  const dayStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MIN * 60000);
  const monthStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_MIN * 60000);
  return { dayStart, monthStart };
}

// ── 3) GARDENER — own tips only, read-only ───────────────────────────────────
exports.myTipSummary = async (req, res) => {
  try {
    const gid = req.user.id;
    const { dayStart, monthStart } = istWindows();
    const ok = { gardener_id: gid, status: 'successful' };
    const [today, month, allTime, paidRow] = await Promise.all([
      Tip.sum('amount_paise', { where: { ...ok, verified_at: { [Op.gte]: dayStart } } }),
      Tip.sum('amount_paise', { where: { ...ok, verified_at: { [Op.gte]: monthStart } } }),
      Tip.sum('amount_paise', { where: ok }),
      sequelize.query(
        `SELECT COALESCE(SUM(t.amount_paise), 0) AS paid FROM tips t
         JOIN tip_payouts p ON p.id = t.payout_id
         WHERE t.gardener_id = :gid AND t.status = 'successful' AND p.status = 'paid'`,
        { replacements: { gid }, type: sequelize.QueryTypes.SELECT },
      ),
    ]);
    const paidOut = Number(paidRow?.[0]?.paid) || 0;
    const received = Number(allTime) || 0;
    res.json({
      success: true,
      data: {
        today_paise: Number(today) || 0,
        this_month_paise: Number(month) || 0,
        all_time_paise: received,
        received_paise: received,
        paid_out_paise: paidOut,
        pending_payout_paise: Math.max(0, received - paidOut),
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.myTips = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const { count, rows } = await Tip.findAndCountAll({
      where: { gardener_id: req.user.id, status: { [Op.in]: ['successful', 'refunded'] } },
      include: [
        { model: Booking, as: 'booking', attributes: ['booking_number', 'scheduled_date'] },
        { model: TipPayout, as: 'payout', attributes: ['status', 'payout_reference', 'paid_at'] },
      ],
      order: [['verified_at', 'DESC']],
      limit, offset: (page - 1) * limit,
    });
    res.json({
      success: true,
      data: {
        items: rows.map((t) => ({
          id: t.id, amount_paise: t.amount_paise, status: t.status,
          verified_at: t.verified_at, booking_number: t.booking?.booking_number,
          payout_status: t.payout ? t.payout.status : 'pending',
          payout_reference: t.payout?.status === 'paid' ? t.payout.payout_reference : null,
        })),
        total: count, page, pages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.myPayouts = async (req, res) => {
  try {
    const rows = await TipPayout.findAll({
      where: { gardener_id: req.user.id, status: { [Op.in]: ['approved', 'processing', 'paid'] } },
      include: [{ model: Tip, as: 'allocations', attributes: ['id', 'amount_paise'] }],
      order: [['created_at', 'DESC']], limit: 100,
    });
    res.json({
      success: true,
      data: rows.map((p) => ({
        id: p.id, amount_paise: p.amount_paise, status: p.status,
        payout_reference: p.payout_reference, paid_at: p.paid_at,
        tips_count: p.allocations?.length || 0, created_at: p.created_at,
      })),
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── 4) ADMIN — tip management ────────────────────────────────────────────────
exports.adminSummary = async (req, res) => {
  try {
    const [row] = await sequelize.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'successful' THEN amount_paise END), 0) AS successful_paise,
        COALESCE(SUM(CASE WHEN status = 'successful' THEN 1 ELSE 0 END), 0) AS successful_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_attempts,
        COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_paise END), 0) AS refunded_paise
      FROM tips
    `, { type: sequelize.QueryTypes.SELECT });
    const [payouts] = await sequelize.query(`
      SELECT
        COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount_paise END), 0) AS paid_out_paise,
        COALESCE(SUM(CASE WHEN p.status IN ('draft','approved','processing') THEN p.amount_paise END), 0) AS in_flight_paise
      FROM tip_payouts p
    `, { type: sequelize.QueryTypes.SELECT });
    const [unalloc] = await sequelize.query(`
      SELECT COALESCE(SUM(amount_paise), 0) AS unallocated_paise
      FROM tips WHERE status = 'successful' AND payout_id IS NULL
    `, { type: sequelize.QueryTypes.SELECT });
    res.json({ success: true, data: { ...row, ...payouts, ...unalloc } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.adminListTips = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, gardener_id, search, from_date, to_date, unallocated } = req.query;
    const where = {};
    if (status) where.status = status;
    if (gardener_id) where.gardener_id = parseInt(gardener_id);
    if (unallocated === '1') { where.status = 'successful'; where.payout_id = null; }
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (DATE_RE.test(String(from_date || ''))) where.created_at = { ...(where.created_at || {}), [Op.gte]: `${from_date} 00:00:00` };
    if (DATE_RE.test(String(to_date || ''))) where.created_at = { ...(where.created_at || {}), [Op.lte]: `${to_date} 23:59:59` };

    const include = [
      { model: User, as: 'customer', attributes: ['id', 'name', 'phone'], ...(search ? { where: { [Op.or]: [{ name: { [Op.like]: `%${search}%` } }, { phone: { [Op.like]: `%${search}%` } }] } } : {}) },
      { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
      { model: Booking, as: 'booking', attributes: ['booking_number'] },
      { model: TipPayout, as: 'payout', attributes: ['id', 'status', 'payout_reference'] },
    ];
    const { count, rows } = await Tip.findAndCountAll({
      where, include, order: [['created_at', 'DESC']],
      limit: Math.min(100, parseInt(limit)), offset: (parseInt(page) - 1) * parseInt(limit), distinct: true,
    });
    res.json({ success: true, data: { items: rows, total: count, page: parseInt(page), pages: Math.max(1, Math.ceil(count / parseInt(limit))) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.adminTipDetail = async (req, res) => {
  try {
    const tip = await Tip.findByPk(req.params.id, {
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone'] },
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
        { model: Booking, as: 'booking', attributes: ['id', 'booking_number', 'scheduled_date'] },
        { model: TipPayout, as: 'payout' },
        { model: TipAudit, as: 'audits', include: [{ model: User, as: 'actor', attributes: ['name'] }] },
      ],
    });
    if (!tip) return res.status(404).json({ success: false, message: 'Tip not found' });
    res.json({ success: true, data: tip });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Reversal — preserves the original row; blocked once the tip is inside a PAID
// payout (policy for that case is a finance decision, per the handoff doc).
exports.adminReverseTip = async (req, res) => {
  try {
    const tip = await Tip.findByPk(req.params.id, { include: [{ model: TipPayout, as: 'payout' }] });
    if (!tip) return res.status(404).json({ success: false, message: 'Tip not found' });
    if (tip.status !== 'successful') return res.status(400).json({ success: false, message: `Only successful tips can be reversed (this one is '${tip.status}')` });
    if (tip.payout && tip.payout.status === 'paid') {
      return res.status(409).json({ success: false, message: 'Tip is part of a PAID payout — handle as a recovery with finance, not a reversal' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'A reason is required for a reversal' });
    await tip.update({ status: 'refunded', payout_id: null });
    await audit({ tip_id: tip.id, actor_id: req.user.id, action: 'reversed', from_status: 'successful', to_status: 'refunded', reason });
    res.json({ success: true, message: 'Tip reversed — totals recalculate from the ledger' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── 5) PAYOUTS ───────────────────────────────────────────────────────────────
// Create: atomically claim the listed tips (payout_id set only where it is
// still NULL and the tip is successful + belongs to the gardener). If any tip
// was already claimed, nothing is written.
exports.adminCreatePayout = async (req, res) => {
  try {
    const gardener_id = parseInt(req.body?.gardener_id);
    const tip_ids = (req.body?.tip_ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!gardener_id || !tip_ids.length) {
      return res.status(400).json({ success: false, message: 'gardener_id and tip_ids are required' });
    }
    const result = await sequelize.transaction(async (t) => {
      const payout = await TipPayout.create({ gardener_id, status: 'draft', initiated_by: req.user.id }, { transaction: t });
      const [, meta] = await sequelize.query(
        `UPDATE tips SET payout_id = :pid
         WHERE id IN (:ids) AND gardener_id = :gid AND status = 'successful' AND payout_id IS NULL`,
        { replacements: { pid: payout.id, ids: tip_ids, gid: gardener_id }, transaction: t },
      );
      const claimed = Number(meta?.affectedRows ?? meta) || 0;
      if (claimed !== tip_ids.length) {
        throw Object.assign(new Error('One or more tips are not eligible (already allocated, not successful, or not this gardener\'s)'), { httpStatus: 409 });
      }
      const [sum] = await sequelize.query(
        'SELECT COALESCE(SUM(amount_paise), 0) AS total FROM tips WHERE payout_id = :pid',
        { replacements: { pid: payout.id }, transaction: t, type: sequelize.QueryTypes.SELECT },
      );
      await payout.update({ amount_paise: Number(sum.total) || 0 }, { transaction: t });
      return payout;
    });
    await audit({ payout_id: result.id, actor_id: req.user.id, action: 'payout_created', to_status: 'draft', reason: `${tip_ids.length} tip(s)` });
    res.json({ success: true, message: `Payout draft created for ₹${(result.amount_paise / 100).toLocaleString('en-IN')}`, data: result });
  } catch (err) { res.status(err.httpStatus || 500).json({ success: false, message: err.message }); }
};

exports.adminListPayouts = async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.gardener_id) where.gardener_id = parseInt(req.query.gardener_id);
    const rows = await TipPayout.findAll({
      where,
      include: [
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
        { model: Tip, as: 'allocations', attributes: ['id', 'amount_paise'] },
      ],
      order: [['created_at', 'DESC']], limit: 200,
    });
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const payoutTransition = (allowedFrom, to, extra) => async (req, res) => {
  try {
    const payout = await TipPayout.findByPk(req.params.id);
    if (!payout) return res.status(404).json({ success: false, message: 'Payout not found' });
    if (!allowedFrom.includes(payout.status)) {
      return res.status(400).json({ success: false, message: `Cannot move a '${payout.status}' payout to '${to}'` });
    }
    const patch = { status: to, ...(extra ? extra(req) : {}) };
    if (to === 'paid' && !String(patch.payout_reference || payout.payout_reference || '').trim()) {
      return res.status(400).json({ success: false, message: 'A bank/UPI payout reference is required to mark Paid' });
    }
    await payout.update(patch);
    // Freed tips become payable again when a payout dies.
    if (to === 'cancelled' || to === 'failed') {
      await sequelize.query('UPDATE tips SET payout_id = NULL WHERE payout_id = :pid', { replacements: { pid: payout.id } });
    }
    await audit({ payout_id: payout.id, actor_id: req.user.id, action: `payout_${to}`, to_status: to, reason: req.body?.reason || req.body?.failure_reason || null });
    res.json({ success: true, message: `Payout ${to}`, data: payout });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.adminApprovePayout = payoutTransition(['draft'], 'approved', (req) => ({ approved_by: req.user.id, approved_at: new Date() }));
exports.adminConfirmPayoutPaid = payoutTransition(['approved', 'processing'], 'paid', (req) => ({
  paid_at: new Date(),
  payout_reference: String(req.body?.payout_reference || '').trim(),
  payment_method: String(req.body?.payment_method || 'bank_transfer').trim(),
  notes: req.body?.notes || null,
}));
exports.adminCancelPayout = payoutTransition(['draft', 'approved'], 'cancelled');
exports.adminFailPayout = payoutTransition(['approved', 'processing'], 'failed', (req) => ({ failure_reason: String(req.body?.failure_reason || 'not specified') }));
