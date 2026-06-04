const { User, Booking, Payment, Subscription, ServicePlan, Order } = require('../models');
const crypto = require('crypto');

// Get my payments
exports.getMyPayments = async (req, res) => {
  try {
    const payments = await Payment.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Check payment status
exports.checkPaymentStatus = async (req, res) => {
  try {
    const { txnid } = req.params;
    const payment = await Payment.findOne({ where: { transaction_id: txnid } });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, data: payment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reschedule booking (if payment adjustment needed)
exports.rescheduleBooking = async (req, res) => {
  try {
    const { booking_id, new_date, new_time } = req.body;
    const booking = await Booking.findOne({ where: { id: booking_id, customer_id: req.user.id } });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    
    await booking.update({ scheduled_date: new_date, scheduled_time: new_time });
    res.json({ success: true, message: 'Booking rescheduled successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Check serviceability
exports.checkServiceability = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat || req.query.latitude);
    const lng = parseFloat(req.query.lng || req.query.longitude);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });

    const { resolveGeofence } = require('../utils/geo');
    const zone = await resolveGeofence(lat, lng);

    if (!zone) {
      return res.json({ success: true, data: { serviceable: false, zone: null, zones: [] } });
    }

    res.json({ success: true, data: { serviceable: true, zone, zones: [zone] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all payments (Admin)
exports.getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const where = {};
    if (status) where.status = status;

    const { count, rows } = await Payment.findAndCountAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });

    res.json({
      success: true,
      data: {
        items: rows,
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Wallet topup initiate
exports.walletTopup = async (req, res) => {
  try {
    const { amount, geofence_id } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ success: false, message: 'Minimum topup is ₹1' });
    req.body.type = 'wallet_topup';
    req.body.amount = amount;
    req.body.geofence_id = geofence_id;
    return exports.createRazorpayOrder(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── RAZORPAY ─────────────────────────────────────────────────────────────────

function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay is not configured (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET).');
  }
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

// Authoritative amount for an entity (so the client can't tamper with totals).
async function entityAmount(type, id) {
  if (type === 'booking') { const b = await Booking.findByPk(id); return b ? parseFloat(b.total_amount) || 0 : 0; }
  if (type === 'subscription') {
    const s = await Subscription.findByPk(id, { include: [{ model: ServicePlan, as: 'plan' }] });
    return s ? parseFloat(s.amount_paid || (s.plan && s.plan.price)) || 0 : 0;
  }
  if (type === 'order') { const o = await Order.findByPk(id); return o ? parseFloat(o.total_amount) || 0 : 0; }
  return 0;
}

// Mark a single entity paid/active.
async function fulfillEntity(type, id) {
  if (type === 'booking') await Booking.update({ payment_status: 'paid' }, { where: { id } });
  else if (type === 'subscription') await Subscription.update({ status: 'active' }, { where: { id } });
  else if (type === 'order') await Order.update({ payment_status: 'paid', status: 'processing' }, { where: { id } });
}

// Mark a pending payment paid and fulfill everything it covers. A combined-cart
// payment stores a JSON {fulfill:[{type,id},…]} list in `notes`. Idempotent —
// safe to call from both the verify endpoint and the webhook.
async function fulfillPayment(payment, gatewayResponse) {
  if (payment.status === 'success') return; // already fulfilled
  await payment.update({
    status: 'success',
    txn_id: gatewayResponse?.razorpay_payment_id || payment.txn_id,
    gateway_response: gatewayResponse || null
  });

  if (payment.type === 'wallet_topup') {
    const user = await User.findByPk(payment.user_id);
    if (user) await user.update({ wallet_balance: Number(user.wallet_balance || 0) + Number(payment.amount) });
    return;
  }

  // Combined cart: fulfill the whole list.
  let fulfillList = null;
  try { const p = payment.notes && JSON.parse(payment.notes); if (p && Array.isArray(p.fulfill)) fulfillList = p.fulfill; } catch (_) { /* not JSON */ }
  if (fulfillList) {
    for (const e of fulfillList) { if (e && e.type && e.id) await fulfillEntity(e.type, e.id); }
    return;
  }

  // Single-entity payment.
  if (payment.booking_id) await fulfillEntity('booking', payment.booking_id);
  if (payment.subscription_id) await fulfillEntity('subscription', payment.subscription_id);
  if (payment.type === 'order' && payment.notes && String(payment.notes).startsWith('order:')) {
    const oid = parseInt(String(payment.notes).split(':')[1]);
    if (oid) await fulfillEntity('order', oid);
  }
}

// 1) Create a Razorpay order; returns the data the client needs to open checkout.
// Accepts either a single entity (type + booking_id/subscription_id/order_id)
// or a combined `fulfill` list (whole cart) — amounts are always summed
// server-side so the total can't be tampered with.
exports.createRazorpayOrder = async (req, res) => {
  try {
    const { type, booking_id, subscription_id, order_id, geofence_id, fulfill } = req.body;
    let amount = 0;
    let productinfo = 'GharKaMali';
    let notes = null;
    const combined = Array.isArray(fulfill) && fulfill.length > 0;

    if (combined) {
      // Combined cart — sum the authoritative amount of every entity.
      for (const e of fulfill) {
        if (e && e.type && e.id) amount += await entityAmount(e.type, e.id);
      }
      productinfo = `Cart (${fulfill.length} item${fulfill.length > 1 ? 's' : ''})`;
      notes = JSON.stringify({ fulfill });
    } else if (type === 'booking' && booking_id) {
      amount = await entityAmount('booking', booking_id); productinfo = `Booking ${booking_id}`;
    } else if (type === 'subscription' && subscription_id) {
      amount = await entityAmount('subscription', subscription_id); productinfo = `Subscription ${subscription_id}`;
    } else if (type === 'order' && order_id) {
      amount = await entityAmount('order', order_id); productinfo = `Order ${order_id}`; notes = `order:${order_id}`;
    } else {
      amount = parseFloat(req.body.amount) || 0; // wallet_topup
    }
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid payment amount' });

    const user = await User.findByPk(req.user.id);
    const instance = getRazorpay();
    const rzpOrder = await instance.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      receipt: `GKM-${Date.now()}`,
      notes: { user_id: String(req.user.id), type: combined ? 'cart' : (type || 'order') }
    });

    await Payment.create({
      user_id: req.user.id,
      booking_id: (!combined && booking_id) || null,
      subscription_id: (!combined && subscription_id) || null,
      geofence_id: geofence_id || null,
      amount,
      type: combined ? 'order' : (type || 'order'),
      status: 'pending',
      payment_method: 'razorpay',
      transaction_id: rzpOrder.id, // Razorpay order id — our lookup key on verify/webhook
      payment_for: productinfo,
      notes
    });

    res.json({
      success: true,
      data: {
        key_id: process.env.RAZORPAY_KEY_ID,
        order_id: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        name: 'GharKaMali',
        description: productinfo,
        prefill: { name: user?.name || '', email: user?.email || '', contact: user?.phone || '' }
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 2) Verify the signature returned by Razorpay Checkout, then fulfill.
exports.verifyRazorpayPayment = async (req, res) => {
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
    const payment = await Payment.findOne({ where: { transaction_id: razorpay_order_id } });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found' });
    if (payment.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'This payment does not belong to you' });

    await fulfillPayment(payment, { razorpay_order_id, razorpay_payment_id, razorpay_signature });
    res.json({ success: true, message: 'Payment verified', data: { payment_id: razorpay_payment_id, type: payment.type } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// 3) Webhook — Razorpay's authoritative server-to-server confirmation (reliable
// even if the user closes the tab). Signature-verified against the raw body.
exports.razorpayWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ success: false, message: 'Webhook secret not configured' });
    const signature = req.headers['x-razorpay-signature'];
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (expected !== signature) return res.status(400).json({ success: false, message: 'Invalid webhook signature' });

    const event = req.body.event;
    const entity = req.body.payload && req.body.payload.payment && req.body.payload.payment.entity;
    if ((event === 'payment.captured' || event === 'order.paid') && entity && entity.order_id) {
      const payment = await Payment.findOne({ where: { transaction_id: entity.order_id } });
      if (payment) await fulfillPayment(payment, { razorpay_order_id: entity.order_id, razorpay_payment_id: entity.id, source: 'webhook' });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
