const { Op } = require('sequelize');
const { Subscription, ServicePlan, User, Booking, ServiceZone } = require('../models');
const { sendWhatsApp, templates } = require('../services/otp.service');
const moment = require('moment');
const bookingCtrl = require('./booking.controller');

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
      geofence_id: zone_id, // Map selected zone/geofence
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

    // ── NOTIFY ─────────────────────────────────────────────────────────────
    const notificationService = require('../services/notification.service');
    
    // Notify User
    await notificationService.notifyUser(req.user.id, {
      title: '🎉 Subscription Activated',
      body: `Your ${plan.name} subscription is now active until ${endDate}.`,
      type: 'success',
      data: { subscription_id: subscription.id }
    });

    // Notify Admin
    await notificationService.notifyAdmins({
      title: '💎 New Subscription',
      body: `${customer.name} subscribed to ${plan.name}.`,
      type: 'success',
      data: { subscription_id: subscription.id }
    });

    res.status(201).json({ success: true, message: 'Subscription activated', data: subscription });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get my subscriptions
exports.getMySubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.findAll({
      where: { customer_id: req.user.id },
      include: [
        { model: ServicePlan, as: 'plan' },
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone', 'profile_image'] }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: subscriptions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Cancel subscription
exports.cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      where: { id: req.params.id, customer_id: req.user.id }
    });

    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    if (subscription.status === 'cancelled') return res.status(400).json({ success: false, message: 'Subscription already cancelled' });

    await subscription.update({ status: 'cancelled', auto_renew: false });

    // Cancel future pending bookings for this subscription
    await Booking.update(
      { status: 'cancelled', cancellation_reason: 'Subscription cancelled by user' },
      { 
        where: { 
          subscription_id: subscription.id, 
          status: 'pending',
          scheduled_date: { [Op.gt]: moment().format('YYYY-MM-DD') }
        } 
      }
    );

    res.json({ success: true, message: 'Subscription cancelled successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all subscriptions (Admin)
exports.getAllSubscriptions = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;

    const { count, rows } = await Subscription.findAndCountAll({
      where,
      include: [
        { model: ServicePlan, as: 'plan' },
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'email'] },
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] }
      ],
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
    const notificationService = require('../services/notification.service');

    for (const d of dates) {
      // ... (date logic remains unchanged) ...
      const dateMoment = moment(d, 'YYYY-MM-DD');
      const dayOfWeek = dateMoment.day();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      
      let extraAmount = 0;
      if (isWeekend && weekendSurgePrice > 0) {
        extraAmount = weekendSurgePrice;
        totalSurgeAmount += weekendSurgePrice;
      }

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
        geofence_id: subscription.geofence_id || subscription.zone_id,
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

      if (gardenerId) {
        const { notify: pushNotify } = require('../services/push.service');
        const g = await User.findByPk(gardenerId);
        if (g?.fcm_token) {
          await pushNotify.newJobAssigned(g.fcm_token, booking.booking_number, subscription.service_address, d);
        }
        // Real-time
        await notificationService.notifyUser(gardenerId, {
          title: '📅 New Scheduled Visit',
          body: `A new visit ${booking.booking_number} has been scheduled for ${d}.`,
          type: 'info',
          data: { booking_id: booking.id }
        });
      }
    }

    // Notify User
    await notificationService.notifyUser(req.user.id, {
      title: '📅 Visits Scheduled',
      body: `You have successfully scheduled ${dates.length} visits for your subscription.`,
      type: 'success'
    });

    res.json({
      success: true,
      message: `${dates.length} visits scheduled successfully.`,
      data: { total_surge_amount: totalSurgeAmount }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
