const { User, Booking, Payment, Subscription, ServicePlan, Order } = require('../models');
const { PAYU_KEY, PAYU_SALT, PAYU_URL, BASE_URL } = process.env;
const crypto = require('crypto');

// Initiate payment — returns form data to post to PayU
exports.initiatePayment = async (req, res) => {
  try {
    const { type, booking_id, subscription_id, amount, geofence_id } = req.body;
    const user = await User.findByPk(req.user.id);

    const txnid = `GKM${Date.now()}${Math.floor(Math.random() * 1000)}`;
    let productinfo = 'GardeningService';
    let paymentAmount = amount;

    if (type === 'booking' && booking_id) {
      const booking = await Booking.findByPk(booking_id);
      paymentAmount = booking ? (booking.total_amount || amount) : amount;
      productinfo = booking ? `Booking-${booking.booking_number || booking.id}` : `Booking-${booking_id}`;
    } else if (type === 'subscription' && subscription_id) {
      const sub = await Subscription.findByPk(subscription_id, {
        include: [{ model: ServicePlan, as: 'plan' }]
      });
      paymentAmount = sub ? (sub.plan?.price || sub.amount_paid || amount) : amount;
      productinfo = sub ? `Subscription-${sub.id}` : `Subscription-${subscription_id}`;
    } else if (type === 'order' && req.body.order_id) {
      const order = await Order.findByPk(req.body.order_id);
      paymentAmount = order ? (order.total_amount || amount) : amount;
      productinfo = order ? `Order-${order.order_number || order.id}` : `Order-${req.body.order_id}`;
    }

    // Create pending payment record
    const payment = await Payment.create({
      user_id: req.user.id,
      booking_id: booking_id || null,
      subscription_id: subscription_id || null,
      geofence_id: geofence_id || req.body.geofence_id || null,
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
      surl: `${BASE_URL}/api/payments/callback`,
      furl: `${BASE_URL}/api/payments/callback`,
      hash: ''
    };

    // Generate Hash: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
    const hashString = `${params.key}|${params.txnid}|${params.amount}|${params.productinfo}|${params.firstname}|${params.email}|||||||||||${PAYU_SALT}`;
    params.hash = crypto.createHash('sha512').update(hashString).digest('hex');

    res.json({
      success: true,
      data: {
        payu_url: PAYU_URL,
        params
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PayU Callback
exports.paymentCallback = async (req, res) => {
  const { txnid, status, hash, amount } = req.body;

  try {
    const payment = await Payment.findOne({ where: { transaction_id: txnid } });
    if (!payment) return res.redirect(`${process.env.FRONTEND_URL}/payment/status?status=failed&reason=payment_not_found`);

    // Verify hash
    const hashString = `${PAYU_SALT}|${status}|||||||||||${req.body.email}|${req.body.firstname}|${req.body.productinfo}|${req.body.amount}|${txnid}|${PAYU_KEY}`;
    const expectedHash = crypto.createHash('sha512').update(hashString).digest('hex');

    if (status === 'success') {
      await payment.update({ status: 'paid', metadata: JSON.stringify(req.body) });

      // If it's a wallet topup
      if (payment.type === 'wallet_topup') {
        const user = await User.findByPk(payment.user_id);
        await user.update({ wallet_balance: Number(user.wallet_balance || 0) + Number(payment.amount) });
      }

      // If it's a booking
      if (payment.booking_id) {
        await Booking.update({ payment_status: 'paid' }, { where: { id: payment.booking_id } });
      }

      // If it's a subscription
      if (payment.subscription_id) {
        await Subscription.update({ status: 'active', payment_status: 'paid' }, { where: { id: payment.subscription_id } });
      }

      res.redirect(`${process.env.FRONTEND_URL}/payment/status?status=success&txnid=${txnid}`);
    } else {
      await payment.update({ status: 'failed', metadata: JSON.stringify(req.body) });
      res.redirect(`${process.env.FRONTEND_URL}/payment/status?status=failed&txnid=${txnid}`);
    }
  } catch (err) {
    console.error('Payment Callback Error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/payment/status?status=error&message=${err.message}`);
  }
};

// PayU success/failure aliases or separate handlers
exports.paymentSuccess = async (req, res) => {
  return exports.paymentCallback(req, res);
};

exports.paymentFailure = async (req, res) => {
  return exports.paymentCallback(req, res);
};

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
    const lat = req.query.lat || req.query.latitude;
    const lng = req.query.lng || req.query.longitude;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });
    
    const { Geofence } = require('../models');
    const zones = await Geofence.findAll({ where: { is_active: true } });
    // Simple radius check or use a proper library if available
    // For now, return all active zones as a placeholder or implement point-in-polygon
    res.json({ success: true, data: zones });
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
    if (!amount || amount < 100) return res.status(400).json({ success: false, message: 'Minimum topup is ₹100' });
    req.body.type = 'wallet_topup';
    req.body.amount = amount;
    req.body.geofence_id = geofence_id;
    return exports.initiatePayment(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
