const crypto = require('crypto');
const axios = require('axios');
const { Payment, User, Booking, Subscription, Order } = require('../models');

// ── PayU Configuration ─────────────────────────────────────────────────────
const PAYU_KEY = process.env.PAYU_MERCHANT_KEY || 'gtKFFx';
const PAYU_SALT = process.env.PAYU_MERCHANT_SALT || '4R38lvwiV57FwVpsgOvTXBdLE4tHUXFW';
const PAYU_BASE = process.env.PAYU_MODE === 'production'
  ? 'https://secure.payu.in/_payment'
  : 'https://test.payu.in/_payment';

const MOCK_PAYMENT = true; // Set to true to bypass PayU and simulate success

// Generate SHA512 hash for PayU
const generateHash = (params) => {
  // Formula: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|SALT
  // Based on your image, PayU Biz test gateway expects exactly 7 pipes after the email
  const key = String(params.key).trim();
  const txnid = String(params.txnid).trim();
  const amount = String(params.amount).trim();
  const productinfo = String(params.productinfo).trim();
  const firstname = String(params.firstname).trim();
  const email = String(params.email).trim();
  
  const str = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||${PAYU_SALT}`;
  return crypto.createHash('sha512').update(str).digest('hex');
};

// Verify hash on response
const verifyHash = (params) => {
  const key = String(params.key).trim();
  const status = String(params.status).trim();
  const amount = String(params.amount).trim();
  const txnid = String(params.txnid).trim();
  const productinfo = String(params.productinfo).trim();
  const firstname = String(params.firstname).trim();
  const email = String(params.email).trim();

  // SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
  const str = `${PAYU_SALT}|${status}|||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
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
    };
    params.hash = generateHash(params);

    // MOCK BYPASS: If active, simulate success immediately
    if (MOCK_PAYMENT) {
      try {
        console.log(`[MOCK] Processing payment for TXN: ${txnid}, Type: ${type}`);
        
        // Simulate success callback logic
        await payment.update({ 
          status: 'success', 
          payment_method: 'mock',
          gateway_response: { note: 'Bypassed via Mock Payment' } 
        });
        
        if (payment.booking_id) {
          console.log(`[MOCK] Updating booking ${payment.booking_id} status to paid`);
          await Booking.update({ payment_status: 'paid' }, { where: { id: payment.booking_id } });
        }
        if (payment.subscription_id) {
          console.log(`[MOCK] Activating subscription ${payment.subscription_id}`);
          await Subscription.update({ status: 'active' }, { where: { id: payment.subscription_id } });
        }
        if (payment.type === 'wallet_topup') {
          console.log(`[MOCK] Incrementing wallet for user ${payment.user_id} by ${payment.amount}`);
          await User.increment({ wallet_balance: parseFloat(payment.amount) }, { where: { id: payment.user_id } });
        }
        if (payment.type === 'order' && req.body.order_id) {
          const order = await Order.findByPk(req.body.order_id);
          if (order) {
            console.log(`[MOCK] Updating order ${order.id} status to paid`);
            await order.update({ status: 'processing', payment_status: 'paid', payment_id: txnid });
          }
        }

        return res.json({
          success: true,
          data: {
            mock_success: true,
            txnid,
            amount: params.amount,
            frontend_redirect: `/payment/success?txnid=${txnid}&amount=${params.amount}`
          }
        });
      } catch (mockErr) {
        console.error('[MOCK ERROR]', mockErr);
        throw mockErr; // Let the outer catch handle it
      }
    }

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
    // Shop Order
    if (payment.type === 'order') {
      const orderId = payment.gateway_response ? payment.gateway_response.udf1 : null;
      if (orderId) {
        await Order.update({ status: 'processing', payment_status: 'paid' }, { where: { id: orderId } });
      }
    }
    // Wallet topup
    if (payment.type === 'wallet_topup') {
      await User.increment({ wallet_balance: payment.amount }, { where: { id: payment.user_id } });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://gkmapp.netlify.app';
    res.redirect(`${frontendUrl}/payment/success?txnid=${params.txnid}&amount=${params.amount}`);
  } catch (err) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://gkmapp.netlify.app';
    res.redirect(`${frontendUrl}/payment/failure?reason=error`);
  }
};

// PayU failure callback
exports.paymentFailure = async (req, res) => {
  try {
    const params = req.body;
    const payment = await Payment.findOne({ where: { transaction_id: params.txnid } });
    if (payment) await payment.update({ status: 'failed', gateway_response: params });
    const frontendUrl = process.env.FRONTEND_URL || 'https://gkmapp.netlify.app';
    res.redirect(`${frontendUrl}/payment/failure?reason=payment_failed`);
  } catch (err) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://gkmapp.netlify.app';
    res.redirect(`${frontendUrl}/payment/failure?reason=error`);
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

// Check if a point [lat, lng] is inside a polygon using ray-casting algorithm
function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Check if location is in a serviceable geofence zone
exports.checkServiceability = async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required' });
    }

    const { Geofence } = require('../models');
    const geofences = await Geofence.findAll({ where: { is_active: true } });

    const matched = [];
    for (const gf of geofences) {
      let polygon = [];
      try {
        polygon = typeof gf.polygon_coords === 'string'
          ? JSON.parse(gf.polygon_coords)
          : (gf.polygon_coords || []);
      } catch { continue; }

      if (polygon.length < 3) continue;

      if (pointInPolygon(lat, lng, polygon)) {
        matched.push({
          id: gf.id,
          name: gf.name,
          city: gf.city,
          state: gf.state,
          base_price: gf.base_price,
          price_per_plant: gf.price_per_plant,
          min_plants: gf.min_plants,
          polygon_vertices: polygon.length,
        });
      }
    }

    res.json({
      success: true,
      data: {
        serviceable: matched.length > 0,
        zones: matched,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

