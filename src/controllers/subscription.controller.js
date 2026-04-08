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

    // Auto-scheduling removed - user will select dates manually via selectDates API

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
      include: [
        { model: ServicePlan, as: 'plan' },
        { model: Booking, as: 'bookings', attributes: ['id', 'scheduled_date', 'status'] }
      ],
      order: [['created_at', 'DESC']]
    });
    
    // Calculate simple next_visit_date and clean up data
    const enhancedSubs = subs.map(sub => {
      const data = sub.toJSON();
      const upcoming = data.bookings.filter(b => moment(b.scheduled_date).isSameOrAfter(moment(), 'day'));
      if (upcoming.length > 0) {
        upcoming.sort((a,b) => moment(a.scheduled_date).valueOf() - moment(b.scheduled_date).valueOf());
        data.next_visit_date = upcoming[0].scheduled_date;
      }
      data.scheduled_visits_count = data.bookings.length;
      return data;
    });

    res.json({ success: true, data: enhancedSubs });
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
    const { page = 1, limit = 20, status, search } = req.query;
    const where = status ? { status } : {};
    
    if (search) {
      where[Op.or] = [
        { '$customer.name$': { [Op.like]: `%${search}%` } },
        { '$customer.phone$': { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Subscription.findAndCountAll({
      where,
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'email'] },
        { model: ServicePlan, as: 'plan', attributes: ['id', 'name', 'price'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
      distinct: true
    });
    res.json({ success: true, data: { subscriptions: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const bookingCtrl = require('./booking.controller');

// Select dates manually
exports.selectDates = async (req, res) => {
  try {
    const { dates } = req.body;
    const subscriptionId = req.params.id;

    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide an array of dates' });
    }

    const subscription = await Subscription.findOne({
      where: { id: subscriptionId, customer_id: req.user.id },
      include: [{ model: ServicePlan, as: 'plan' }]
    });

    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    if (subscription.status !== 'active') return res.status(400).json({ success: false, message: 'Subscription is not active' });

    const existingBookings = await Booking.count({ where: { subscription_id: subscription.id } });
    const remainingToSchedule = subscription.visits_total - existingBookings;

    if (dates.length > remainingToSchedule) {
      return res.status(400).json({ success: false, message: `You can only schedule ${remainingToSchedule} more visits` });
    }

    const plan = subscription.plan;
    const weekendSurgePrice = parseFloat(plan.weekend_surge_price) || 0;
    const baseAmountPerVisit = parseFloat(plan.price) / plan.visits_per_month;
    let totalSurgeAmount = 0;

    for (const d of dates) {
      const dateMoment = moment(d, 'YYYY-MM-DD');
      if (dateMoment.isBefore(moment(subscription.start_date, 'YYYY-MM-DD'), 'day') || dateMoment.isAfter(moment(subscription.end_date, 'YYYY-MM-DD'), 'day')) {
        return res.status(400).json({ success: false, message: `Date ${d} is outside your active billing period (${subscription.start_date} to ${subscription.end_date})` });
      }

      const dayOfWeek = dateMoment.day();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6); // 0=Sun, 6=Sat
      
      let extraAmount = 0;
      if (isWeekend && weekendSurgePrice > 0) {
        extraAmount = weekendSurgePrice;
        totalSurgeAmount += weekendSurgePrice;
      }

      // Check availability for preferred gardener or zone
      const availableSlots = await bookingCtrl.checkGardenerAvailabilityInternal(d, subscription.preferred_gardener_id, subscription.zone_id);
      let scheduled_time = '09:00:00';
      if (availableSlots.length > 0 && !availableSlots.includes('09:00')) {
        scheduled_time = availableSlots[0] + ':00';
      }

      const gardenerId = subscription.preferred_gardener_id || null;
      const booking = await Booking.create({
        booking_number: genBookingNumber(),
        customer_id: req.user.id,
        gardener_id: gardenerId,
        subscription_id: subscription.id,
        zone_id: subscription.zone_id,
        booking_type: 'subscription',
        status: gardenerId ? 'assigned' : 'pending',
        assigned_at: gardenerId ? new Date() : null,
        scheduled_date: d,
        scheduled_time,
        otp: genVisitOTP(),
        service_address: subscription.service_address,
        service_latitude: subscription.service_latitude,
        service_longitude: subscription.service_longitude,
        plant_count: subscription.plant_count,
        base_amount: baseAmountPerVisit,
        extra_amount: extraAmount,
        total_amount: baseAmountPerVisit + extraAmount
      });

      // Notify gardener if assigned
      if (gardenerId) {
        const { notify } = require('../services/push.service');
        const g = await User.findByPk(gardenerId);
        if (g?.fcm_token) {
          await notify.newJobAssigned(g.fcm_token, booking.booking_number, subscription.service_address, d);
        }
      }
    }

    res.json({
      success: true,
      message: `${dates.length} visits scheduled successfully.`,
      data: { total_surge_amount: totalSurgeAmount }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
