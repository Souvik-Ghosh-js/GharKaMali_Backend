// Customer wallet (cashback + top-ups) — see services/wallet.service.js for the
// ledger rules. These endpoints only read the ledger and manage the config;
// money moves exclusively through payment fulfillment and admin goodwill credits.
const { Op } = require('sequelize');
const walletService = require('../services/wallet.service');

// GET /wallet — balance, cashback offer tiers, and transaction history.
exports.getMyWallet = async (req, res) => {
  try {
    const { WalletCredit, WalletDebit } = require('../models');
    const userId = req.user.id;
    const [cfg, balance, credits, debits] = await Promise.all([
      walletService.getWalletConfig(),
      walletService.balancePaise(userId),
      WalletCredit.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']], limit: 100 }),
      WalletDebit.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']], limit: 100 }),
    ]);

    // Soonest-expiring money still in the wallet, so the apps can nudge usage.
    const now = Date.now();
    const expiring = credits
      .filter(c => c.remaining_paise > 0 && c.expires_at && new Date(String(c.expires_at).replace(' ', 'T')).getTime() > now)
      .map(c => ({ amount_paise: c.remaining_paise, expires_at: c.expires_at }))
      .sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));

    const transactions = [
      ...credits.map(c => ({
        id: `c${c.id}`, direction: 'credit', type: c.type,
        amount_paise: c.amount_paise, remaining_paise: c.remaining_paise,
        note: c.note, expires_at: c.expires_at,
        expired: !!(c.expires_at && new Date(String(c.expires_at).replace(' ', 'T')).getTime() <= now && c.remaining_paise > 0),
        created_at: c.created_at,
      })),
      ...debits.map(d => ({
        id: `d${d.id}`, direction: 'debit', type: d.purpose_type || 'spend',
        amount_paise: d.amount_paise, note: d.note, created_at: d.created_at,
      })),
    ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    await walletService.syncBalanceCache(userId); // keep profile displays fresh
    res.json({
      success: true,
      data: {
        balance_paise: balance,
        balance: Number((balance / 100).toFixed(2)),
        expiring,
        transactions,
        offer: { enabled: cfg.enabled, tiers: cfg.tiers, validity_days: cfg.validity_days },
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /wallet/offers — public cashback tiers for marketing banners.
exports.getOffers = async (req, res) => {
  try {
    const cfg = await walletService.getWalletConfig();
    res.json({ success: true, data: { enabled: cfg.enabled, tiers: cfg.tiers, validity_days: cfg.validity_days } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── ADMIN ───────────────────────────────────────────────────────────────────

exports.adminGetConfig = async (req, res) => {
  try {
    const cfg = await walletService.getWalletConfig();
    res.json({ success: true, data: cfg });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.adminSaveConfig = async (req, res) => {
  try {
    const cfg = {
      enabled: req.body.enabled !== false,
      tiers: req.body.tiers,
      validity_days: parseInt(req.body.validity_days) || 30,
    };
    const invalid = walletService.validateConfig(cfg);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const { SystemSetting } = require('../models');
    const [row, created] = await SystemSetting.findOrCreate({
      where: { key: walletService.SETTING_KEY },
      defaults: { value: JSON.stringify(cfg), updated_by: req.user.id },
    });
    if (!created) await row.update({ value: JSON.stringify(cfg), updated_by: req.user.id });
    walletService.invalidateWalletConfigCache();
    res.json({ success: true, data: cfg });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /admin/wallet/credit — goodwill/manual credit to one customer.
exports.adminCredit = async (req, res) => {
  try {
    const { User } = require('../models');
    const userId = parseInt(req.body.user_id);
    const amount = Number(req.body.amount);
    const note = String(req.body.note || '').trim();
    const validityDays = req.body.validity_days ? parseInt(req.body.validity_days) : null;
    if (!userId) return res.status(400).json({ success: false, message: 'user_id is required' });
    if (!(amount > 0) || amount > 100000) return res.status(400).json({ success: false, message: 'amount must be ₹1–₹100000' });
    if (!note) return res.status(400).json({ success: false, message: 'A note explaining the credit is required' });
    if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365)) {
      return res.status(400).json({ success: false, message: 'validity_days must be 1–365 (or empty for never expires)' });
    }
    const user = await User.findByPk(userId, { attributes: ['id', 'name', 'role'] });
    if (!user || user.role !== 'customer') return res.status(404).json({ success: false, message: 'Customer not found' });

    const row = await walletService.credit(userId, {
      type: 'admin',
      amountPaise: Math.round(amount * 100),
      note: `${note} (by admin #${req.user.id})`,
      expiresAt: validityDays ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000) : null,
    });
    res.json({ success: true, message: `₹${amount} credited to ${user.name}`, data: row });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /admin/wallet/summary — liability + cashback programme health.
exports.adminSummary = async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const [[row]] = await sequelize.query(`
      SELECT
        COALESCE(SUM(CASE WHEN remaining_paise > 0 AND (expires_at IS NULL OR expires_at > NOW()) THEN remaining_paise END), 0) AS outstanding_paise,
        COALESCE(SUM(CASE WHEN type = 'cashback' THEN amount_paise END), 0) AS cashback_issued_paise,
        COALESCE(SUM(CASE WHEN type = 'cashback' AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN amount_paise END), 0) AS cashback_month_paise,
        COALESCE(SUM(CASE WHEN remaining_paise > 0 AND expires_at IS NOT NULL AND expires_at <= NOW() THEN remaining_paise END), 0) AS expired_unused_paise
      FROM wallet_credits`);
    const [[spent]] = await sequelize.query('SELECT COALESCE(SUM(amount_paise), 0) AS redeemed_paise FROM wallet_debits');
    const { WalletCredit, User } = require('../models');
    const recent = await WalletCredit.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }],
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    res.json({ success: true, data: { ...row, ...spent, recent } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
