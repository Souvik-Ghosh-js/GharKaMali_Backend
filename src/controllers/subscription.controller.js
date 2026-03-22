const { Op } = require('sequelize');
const { Subscription, ServicePlan, User, Booking, ServiceZone } = require('../models');
const { sendWhatsApp, templates } = require('../services/otp.service');
const moment = require('moment');

const genVisitOTP = () => Math.floor(1000 + Math.random() * 9000).toString();
const genBookingNumber = () => `GKM${Date.now().toString().slice(-8)}`;

// Get all plans
exports.getPlans = async (req, res) => {
  try {
    const plans = await ServicePlan.findAll({ where: { is_active: true }, order: [['price', 'ASC']] });
    res.json({ success: true, data: plans });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Subscribe
exports.subscribe = async (req, res) => {
  try {
    const { plan_id, zone_id, service_address, service_latitude, service_longitude, plant_count, preferred_gardener_id, auto_renew, payment_id } = req.body;

    const plan = await ServicePlan.findByPk(plan_id);
    if (!plan || !plan.is_active) return res.status(404).json({ success: false, message: 'Plan not found' });

    const startDate = moment().format('YYYY-MM-DD');
    const endDate = moment().add(plan.duration_days, 'days').format('YYYY-MM-DD');

    const subscription = await Subscription.create({
      customer_id: req.user.id,
      plan_id,
      zone_id,
      preferred_gardener_id,
      status: 'active',
      start_date: startDate,
      end_date: endDate,
      auto_renew: auto_renew !== false,
      visits_total: plan.visits_per_month,
      visits_used: 0,
      amount_paid: plan.price,
      service_address,
      service_latitude,
      service_longitude,
      plant_count: plant_count || 1,
      payment_id
    });

    // Schedule visits (Mon-Sat, skip Sunday)
    const visitDates = [];
    let current = moment(startDate);
    let count = 0;
    while (count < plan.visits_per_month && current.isBefore(moment(endDate))) {
      if (current.day() !== 0 && (!plan.is_weekend_included ? current.day() !== 6 : true)) {
        visitDates.push(current.format('YYYY-MM-DD'));
        count++;
      }
      current.add(Math.floor(30 / plan.visits_per_month), 'days');
    }

    // Create scheduled bookings
    for (const date of visitDates) {
      await Booking.create({
        booking_number: genBookingNumber(),
        customer_id: req.user.id,
        gardener_id: preferred_gardener_id || null,
        subscription_id: subscription.id,
        zone_id,
        booking_type: 'subscription',
        status: 'assigned',
        scheduled_date: date,
        scheduled_time: '09:00:00',
        otp: genVisitOTP(),
        service_address,
        service_latitude,
        service_longitude,
        plant_count: plant_count || 1,
        base_amount: plan.price / plan.visits_per_month,
        total_amount: plan.price / plan.visits_per_month
      });
    }

    const customer = await User.findByPk(req.user.id);
    await sendWhatsApp(customer.phone, templates.subscriptionRenewed(customer.name, plan.name, endDate));

    res.status(201).json({ success: true, message: 'Subscription activated', data: subscription });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get my subscriptions
exports.getMySubscriptions = async (req, res) => {
  try {
    const subs = await Subscription.findAll({
      where: { customer_id: req.user.id },
      include: [{ model: ServicePlan, as: 'plan' }],
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: subs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Cancel subscription
exports.cancelSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ where: { id: req.params.id, customer_id: req.user.id } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    await sub.update({ status: 'cancelled' });
    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: get all subscriptions
exports.getAllSubscriptions = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const where = status ? { status } : {};
    const { count, rows } = await Subscription.findAndCountAll({
      where,
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'email'] },
        { model: ServicePlan, as: 'plan', attributes: ['id', 'name', 'price'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { subscriptions: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
