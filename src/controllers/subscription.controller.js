const { Op, literal } = require('sequelize');
const { Subscription, ServicePlan, User, Booking, ServiceZone, Geofence, sequelize } = require('../models');
const { sendWhatsApp, templates } = require('../services/otp.service');
const moment = require('moment');
const { nowIST, todayIST } = require('../utils/time');
const { dateRangeWhere } = require('../utils/dateRange');
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
    const { 
      plan_id, zone_id, geofence_id: geofence_id_body, 
      service_address, service_latitude, service_longitude, 
      flat_no, building, area, landmark, city, state, pincode,
      plant_count, preferred_gardener_id, auto_renew, payment_id, payment_method, coupon_code
    } = req.body;
    // Online (Razorpay) subscriptions start as 'pending' and are activated by
    // the payment verification/webhook. Other paths activate immediately.
    const pendingPayment = payment_method === 'razorpay';

    // Auto-save address to user profile
    const addressCtrl = require('./address.controller');
    await addressCtrl.smartSaveAddress(req.user.id, {
      flat_no, building, area, landmark, city, state, pincode,
      latitude: service_latitude, longitude: service_longitude,
      label: building || area || 'Home'
    });
    const activeZoneId = geofence_id_body || zone_id;

    const plan = await ServicePlan.findByPk(plan_id);
    if (!plan || !plan.is_active) return res.status(404).json({ success: false, message: 'Plan not found' });

    const startDate = todayIST();
    const endDate = nowIST().add(plan.duration_days, 'days').format('YYYY-MM-DD');

    // Monthly price = (plan price + ₹25 per additional plant) + 18% GST.
    const preGstBase = parseFloat(plan.price) + ((parseInt(plant_count) || 0) * 25);
    let amountPaid = Math.round(preGstBase * 1.18 * 100) / 100;

    // ── Discount coupon (scope 'subscription') ──────────────────────────────
    // Validated against the pre-GST base, subtracted from the GST-inclusive
    // total (same as shop orders / bookings). The usage slot is claimed
    // atomically in the same transaction that creates the subscription.
    let discountAmount = 0;
    let appliedCoupon = null;
    if (coupon_code && String(coupon_code).trim()) {
      const { validateCoupon } = require('../utils/coupon');
      const result = await validateCoupon(coupon_code, preGstBase, 'subscription');
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.reason || 'Coupon could not be applied' });
      }
      discountAmount = result.discount;
      appliedCoupon = result.coupon;
      amountPaid = Math.max(0, Math.round((amountPaid - discountAmount) * 100) / 100);
    }

    let subscription;
    try {
      subscription = await sequelize.transaction(async (t) => {
        if (appliedCoupon) {
          const [updateRes] = await sequelize.query(
            'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = :id AND (usage_limit IS NULL OR usage_count < usage_limit)',
            { replacements: { id: appliedCoupon.id }, transaction: t }
          );
          if ((updateRes?.affectedRows ?? 0) === 0) {
            const e = new Error('This coupon has just reached its usage limit. Please remove it and try again.');
            e.httpStatus = 400;
            throw e;
          }
        }

        return Subscription.create({
          customer_id: req.user.id,
          plan_id,
          zone_id: activeZoneId,
          geofence_id: activeZoneId,
          preferred_gardener_id,
          status: pendingPayment ? 'pending' : 'active',
          start_date: startDate,
          end_date: endDate,
          auto_renew: auto_renew !== false,
          visits_total: plan.visits_per_month,
          visits_used: 0,
          amount_paid: amountPaid,
          coupon_code: appliedCoupon ? appliedCoupon.code : null,
          discount_amount: discountAmount,
          service_address,
          service_latitude,
          service_longitude,
          plant_count: parseInt(plant_count) || 0, // additional plants beyond the plan's free coverage (optional)
          payment_id
        }, { transaction: t });
      });
    } catch (txErr) {
      if (txErr.httpStatus) return res.status(txErr.httpStatus).json({ success: false, message: txErr.message });
      throw txErr; // unexpected → outer catch (500)
    }

    // Auto-scheduling removed - user will select dates manually via selectDates API

    const customer = await User.findByPk(req.user.id);

    // Only announce activation once payment isn't pending — otherwise the
    // payment verification/webhook will activate and the client can notify.
    if (!pendingPayment) {
      await sendWhatsApp(customer.phone, templates.subscriptionRenewed(customer.name, plan.name, endDate));
      const notificationService = require('../services/notification.service');
      await notificationService.notifyUser(req.user.id, {
        title: '🎉 Subscription Activated',
        body: `Your ${plan.name} subscription is now active until ${endDate}.`,
        type: 'success',
        data: { subscription_id: subscription.id }
      });
      await notificationService.notifyAdmins({
        title: '💎 New Subscription',
        body: `${customer.name} subscribed to ${plan.name}.`,
        type: 'success',
        data: { subscription_id: subscription.id }
      });

      // Notify finance — this branch only runs for subscriptions activated without
      // an online payment (e.g. wallet). Online subs are reported from fulfillEntity.
      require('../services/financeMail').notifySubscription(subscription.id, payment_method || 'Wallet');
    }

    res.status(201).json({ success: true, message: pendingPayment ? 'Subscription created — complete payment to activate' : 'Subscription activated', data: subscription });
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
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone', 'profile_image'] },
        {
          model: Booking,
          as: 'bookings',
          attributes: ['id', 'booking_number', 'scheduled_date', 'status', 'gardener_id'],
          include: [{ model: User, as: 'gardener', attributes: ['id', 'name', 'profile_image'] }],
          required: false
        }
      ],
      order: [['created_at', 'DESC']]
    });

    const data = subscriptions.map(sub => {
      const plain = sub.toJSON();
      plain.scheduled_visits_count = (plain.bookings || []).filter(b => b.status !== 'cancelled').length;
      const upcoming = (plain.bookings || [])
        .filter(b => b.status !== 'cancelled' && b.scheduled_date >= todayIST())
        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
      plain.next_visit_date = upcoming.length > 0 ? upcoming[0].scheduled_date : null;
      return plain;
    });

    res.json({ success: true, data });
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
    const reason = (req.body && typeof req.body.reason === 'string' && req.body.reason.trim())
      ? req.body.reason.trim().slice(0, 500)
      : 'Subscription cancelled by user';
    // Snapshot the visits being cancelled BEFORE the bulk update so we can
    // notify the customer and any assigned gardeners afterwards.
    const cancelledVisits = await Booking.findAll({
      where: {
        subscription_id: subscription.id,
        status: 'pending',
        scheduled_date: { [Op.gt]: todayIST() }
      },
      attributes: ['id', 'booking_number', 'customer_id', 'gardener_id']
    });
    await Booking.update(
      { status: 'cancelled', cancellation_reason: reason },
      {
        where: {
          subscription_id: subscription.id,
          status: 'pending',
          scheduled_date: { [Op.gt]: todayIST() }
        }
      }
    );

    // Notifications (best-effort; never fail the cancellation)
    (async () => {
      try {
        const { notify } = require('../services/push.service');
        const notificationService = require('../services/notification.service');

        // Gardeners assigned to any of the auto-cancelled visits
        for (const visit of cancelledVisits) {
          if (!visit.gardener_id) continue;
          try {
            const gardener = await User.findByPk(visit.gardener_id, { attributes: ['id', 'fcm_token'] });
            if (gardener?.fcm_token) {
              await notify.jobCancelled(gardener.fcm_token, visit.booking_number, reason);
            }
            await notificationService.notifyUser(visit.gardener_id, {
              title: '❌ Job Cancelled',
              body: `Booking ${visit.booking_number} has been cancelled. Reason: ${reason}`,
              type: 'warning',
              data: { booking_id: visit.id, booking_number: visit.booking_number, reason }
            });
          } catch (_) {}
        }

        // Customer gets a single confirmation covering the subscription + visits
        const customer = await User.findByPk(subscription.customer_id, { attributes: ['id', 'fcm_token'] });
        if (customer?.fcm_token) {
          if (cancelledVisits.length === 1) {
            await notify.bookingCancelled(customer.fcm_token, cancelledVisits[0].booking_number);
          } else {
            await notify.custom(customer.fcm_token, 'Subscription Cancelled',
              cancelledVisits.length > 0
                ? `Your subscription has been cancelled along with ${cancelledVisits.length} upcoming visits.`
                : 'Your subscription has been cancelled.',
              { type: 'booking_cancelled', subscription_id: subscription.id });
          }
        }
        await notificationService.notifyUser(subscription.customer_id, {
          title: 'Subscription Cancelled',
          body: cancelledVisits.length > 0
            ? `Your subscription has been cancelled. ${cancelledVisits.length} upcoming visit(s) were also cancelled. Reason: ${reason}`
            : `Your subscription has been cancelled. Reason: ${reason}`,
          type: 'info',
          data: { subscription_id: subscription.id, cancelled_bookings: cancelledVisits.map(v => v.booking_number), reason }
        });
      } catch (e) { console.error('[cancelSubscription] notify failed:', e.message); }
    })();

    res.json({ success: true, message: 'Subscription cancelled successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all subscriptions (Admin)
exports.getAllSubscriptions = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, geofence_id, plan_id, search } = req.query;
    const where = { ...dateRangeWhere(req.query) };
    if (status) where.status = status;
    if (plan_id) where.plan_id = plan_id;

    // Geofence filter: match explicit geofence_id/zone_id, the customer's own
    // geofence assignment, OR a city fallback for legacy records.
    // NOTE: columns inside literals MUST be qualified with the `Subscription`
    // alias — the joined users tables (customer/gardener) also have a
    // geofence_id column, and an unqualified reference makes MySQL throw
    // "Column 'geofence_id' in where clause is ambiguous" (query 500s and the
    // dashboard shows an empty list).
    if (geofence_id) {
      const gfId = parseInt(geofence_id, 10);
      if (isNaN(gfId)) return res.status(400).json({ success: false, message: 'Invalid geofence_id' });
      const gf = await Geofence.findByPk(gfId);
      const city = gf ? gf.city : null;
      const db = require('../config/database');
      where[Op.or] = [
        { geofence_id: gfId },
        { zone_id: gfId }, // legacy rows that stored the zone/geofence id in zone_id
        // Subs without their own geofence linkage whose CUSTOMER is assigned to
        // this geofence (rows created before subscriptions carried geofence_id;
        // their zone_id may hold a legacy service_zones id from a different id space).
        literal(`(\`Subscription\`.\`geofence_id\` IS NULL AND EXISTS (SELECT 1 FROM users cu WHERE cu.id = \`Subscription\`.\`customer_id\` AND cu.geofence_id = ${gfId}))`),
        ...(city ? [literal(`(\`Subscription\`.\`geofence_id\` IS NULL AND \`Subscription\`.\`zone_id\` IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = \`Subscription\`.\`customer_id\` AND u.city = ${db.escape(city)}))`)] : [])
      ];
    }

    // Search by customer name/phone
    const customerWhere = {};
    if (search) {
      customerWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Subscription.findAndCountAll({
      where,
      include: [
        { model: ServicePlan, as: 'plan' },
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'email'], where: Object.keys(customerWhere).length ? customerWhere : undefined },
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
        { model: Geofence, as: 'geofenceRef', attributes: ['id', 'name', 'city'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      subQuery: false
    });

    res.json({
      success: true,
      data: {
        items: rows,
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / parseInt(limit))
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

    // Count only non-cancelled bookings against the visit allowance, so a customer
    // who cancels a visit can reschedule it (cancelled bookings are kept for history,
    // not deleted). Matches the display count in getMySubscriptions.
    const existingBookings = await Booking.count({
      where: { subscription_id: subscription.id, status: { [Op.ne]: 'cancelled' } }
    });
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
