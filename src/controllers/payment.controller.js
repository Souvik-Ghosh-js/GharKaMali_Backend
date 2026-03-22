const crypto = require('crypto');
const axios = require('axios');
const { Payment, User, Booking, Subscription } = require('../models');

// ── PayU Configuration ─────────────────────────────────────────────────────
const PAYU_KEY = process.env.PAYU_MERCHANT_KEY || 'YOUR_PAYU_KEY';
const PAYU_SALT = process.env.PAYU_MERCHANT_SALT || 'YOUR_PAYU_SALT';
const PAYU_BASE = process.env.PAYU_MODE === 'production'
  ? 'https://secure.payu.in/_payment'
  : 'https://test.payu.in/_payment';

// Generate SHA512 hash for PayU
const generateHash = (params) => {
  const str = `${params.key}|${params.txnid}|${params.amount}|${params.productinfo}|${params.firstname}|${params.email}|||||||||||||${PAYU_SALT}`;
  return crypto.createHash('sha512').update(str).digest('hex');
};

// Verify hash on response
const verifyHash = (params) => {
  const str = `${PAYU_SALT}|${params.status}|||||||||||||${params.email}|${params.firstname}|${params.productinfo}|${params.amount}|${params.txnid}|${params.key}`;
  const computed = crypto.createHash('sha512').update(str).digest('hex');
  return computed === params.hash;
};

// Initiate payment — returns form data to post to PayU
exports.initiatePayment = async (req, res) => {
  try {
    const { type, booking_id, subscription_id, amount } = req.body;
    const user = await User.findByPk(req.user.id);

    const txnid = `GKM${Date.now()}${Math.floor(Math.random() * 1000)}`;
    let productinfo = 'GardeningService';
    let paymentAmount = amount;

    if (type === 'booking' && booking_id) {
      const booking = await Booking.findByPk(booking_id);
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
      paymentAmount = booking.total_amount;
      productinfo = `Booking-${booking.booking_number}`;
    } else if (type === 'subscription' && subscription_id) {
      const sub = await Subscription.findByPk(subscription_id);
      if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
      paymentAmount = sub.amount_paid;
      productinfo = `Subscription-${sub.id}`;
    }

    // Create pending payment record
    const payment = await Payment.create({
      user_id: req.user.id,
      booking_id: booking_id || null,
      subscription_id: subscription_id || null,
      amount: paymentAmount,
      type,
      status: 'pending',
      transaction_id: txnid,
      payment_method: 'payu'
    });

    const params = {
      key: PAYU_KEY,
      txnid,
      amount: parseFloat(paymentAmount).toFixed(2),
      productinfo,
      firstname: user.name,
      email: user.email || `${user.phone}@gharkamali.com`,
      phone: user.phone,
      surl: `${process.env.BASE_URL}/api/payments/success`,
      furl: `${process.env.BASE_URL}/api/payments/failure`,
      service_provider: 'payu_paisa',
    };
    params.hash = generateHash(params);

    res.json({
      success: true,
      data: {
        payment_id: payment.id,
        payu_url: PAYU_BASE,
        params,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PayU success callback
exports.paymentSuccess = async (req, res) => {
  try {
    const params = req.body;
    if (!verifyHash(params)) {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/failure?reason=hash_mismatch`);
    }

    const payment = await Payment.findOne({ where: { transaction_id: params.txnid } });
    if (!payment) return res.redirect(`${process.env.FRONTEND_URL}/payment/failure?reason=not_found`);

    await payment.update({
      status: 'success',
      gateway_response: params,
      payment_method: params.mode || 'payu'
    });

    // Update booking or subscription status
    if (payment.booking_id) {
      await Booking.update({ payment_status: 'paid' }, { where: { id: payment.booking_id } });
    }
    if (payment.subscription_id) {
      await Subscription.update({ status: 'active' }, { where: { id: payment.subscription_id } });
    }
    // Wallet topup
    if (payment.type === 'wallet_topup') {
      await User.increment({ wallet_balance: payment.amount }, { where: { id: payment.user_id } });
    }

    res.redirect(`${process.env.FRONTEND_URL}/payment/success?txnid=${params.txnid}&amount=${params.amount}`);
  } catch (err) {
    res.redirect(`${process.env.FRONTEND_URL}/payment/failure?reason=error`);
  }
};

// PayU failure callback
exports.paymentFailure = async (req, res) => {
  try {
    const params = req.body;
    const payment = await Payment.findOne({ where: { transaction_id: params.txnid } });
    if (payment) await payment.update({ status: 'failed', gateway_response: params });
    res.redirect(`${process.env.FRONTEND_URL}/payment/failure?reason=payment_failed`);
  } catch (err) {
    res.redirect(`${process.env.FRONTEND_URL}/payment/failure?reason=error`);
  }
};

// Check payment status
exports.checkPaymentStatus = async (req, res) => {
  try {
    const payment = await Payment.findOne({
      where: { transaction_id: req.params.txnid, user_id: req.user.id }
    });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, data: payment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get my payments
exports.getMyPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { count, rows } = await Payment.findAndCountAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { payments: rows, total: count, page: parseInt(page) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Wallet topup initiate
exports.walletTopup = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ success: false, message: 'Minimum topup is ₹100' });
    req.body.type = 'wallet_topup';
    req.body.amount = amount;
    return exports.initiatePayment(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: get all payments
exports.getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    const { count, rows } = await Payment.findAndCountAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { payments: rows, total: count } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reschedule booking
exports.rescheduleBooking = async (req, res) => {
  try {
    const { booking_id, new_date, new_time } = req.body;
    const booking = await Booking.findOne({ where: { id: booking_id, customer_id: req.user.id } });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (!['pending', 'assigned'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Cannot reschedule booking in current status' });
    }
    await booking.update({ scheduled_date: new_date, scheduled_time: new_time || booking.scheduled_time });
    res.json({ success: true, message: 'Booking rescheduled', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Check if location is in a service zone
exports.checkServiceability = async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    const { ServiceZone } = require('../models');
    const zones = await ServiceZone.findAll({ where: { is_active: true } });

    // Simple radius check
    const R = 6371;
    const serviced = zones.filter(zone => {
      if (!zone.center_latitude || !zone.center_longitude) return false;
      const dLat = (latitude - zone.center_latitude) * Math.PI / 180;
      const dLon = (longitude - zone.center_longitude) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(zone.center_latitude * Math.PI/180) * Math.cos(latitude * Math.PI/180) * Math.sin(dLon/2)**2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return dist <= (zone.radius_km || 10);
    });

    res.json({
      success: true,
      data: {
        serviceable: serviced.length > 0,
        zones: serviced
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
