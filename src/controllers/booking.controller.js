const { notify } = require('../services/push.service');
const { Op, fn, col, literal } = require('sequelize');
const { Booking, User, GardenerProfile, Subscription, ServiceZone, ServicePlan, Notification, BookingTracking, Geofence, GardenerZone, BookingLog, BookingAddOn, AddOnService, BookingTimeAddon, sequelize } = require('../models');
const { sendWhatsApp, templates } = require('../services/otp.service');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

// ───────────────────────────────────────────────────────────────────────────
// Default arrival window for "Instant" on-demand bookings.
// TODO: replace with a real ETA computed from the assigned gardener's live
// distance to the customer location once on-the-ground operations are live.
// ───────────────────────────────────────────────────────────────────────────
const DEFAULT_INSTANT_ETA_MINUTES = 50;

// IST helpers — the server runs in UTC, so any wall-clock slot/date must be
// computed in IST to match the IST-stored booking timestamps. See utils/time.js.
const { IST_OFFSET_MINUTES, nowIST } = require('../utils/time');

// Helper: create booking log entry
const logBookingEvent = async (booking_id, event_type, actor_id, actor_role, meta, description) => {
  try {
    await BookingLog.create({ booking_id, event_type, actor_id, actor_role, meta, description });
  } catch (e) { console.error('BookingLog error:', e.message); }
};

// Get previous gardeners for a customer
exports.getPreviousGardeners = async (req, res) => {
  try {
    const customerId = req.user.id;
    const previousGardeners = await Booking.findAll({
      where: { customer_id: customerId, status: 'completed', gardener_id: { [Op.ne]: null } },
      attributes: [[fn('DISTINCT', col('gardener_id')), 'gardener_id']],
      include: [
        {
          model: User, as: 'gardener',
          attributes: ['id', 'name', 'profile_image'],
          include: [{ model: GardenerProfile, as: 'gardenerProfile', attributes: ['rating', 'total_jobs'] }]
        }
      ],
      raw: true,
      nest: true
    });

    const uniqueGardeners = previousGardeners.map(b => b.gardener).filter(g => g && g.id);
    res.json({ success: true, data: uniqueGardeners });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Internal function for availability check
const checkGardenerAvailabilityInternal = async (date, gardener_id, zone_id) => {
  const standardTimeSlots = ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];

  let gardenerIds = [];
  if (gardener_id) {
    gardenerIds = [parseInt(gardener_id)];
  } else if (zone_id) {
    const gzs = await GardenerZone.findAll({ where: { geofence_id: zone_id } });
    gardenerIds = gzs.map(gz => gz.gardener_id);
  } else {
    return [];
  }

  if (gardenerIds.length === 0) return [];

  const existingBookings = await Booking.findAll({
    where: {
      gardener_id: { [Op.in]: gardenerIds },
      scheduled_date: date,
      status: { [Op.notIn]: ['cancelled', 'failed'] }
    },
    attributes: ['gardener_id', 'scheduled_time']
  });

  const isFree = (gId, time) => {
    const requestedTime = moment(time, 'HH:mm');
    return !existingBookings.some(b => {
      if (b.gardener_id !== gId) return false;
      const bookingTime = moment(b.scheduled_time, 'HH:mm:ss');
      const diffMinutes = Math.abs(requestedTime.diff(bookingTime, 'minutes'));
      return diffMinutes < 120;
    });
  };

  const availabilityMap = [];
  if (gardener_id) {
    const gId = parseInt(gardener_id);
    standardTimeSlots.forEach(slot => { if (isFree(gId, slot)) availabilityMap.push(slot); });
  } else {
    standardTimeSlots.forEach(slot => {
      if (gardenerIds.some(gId => isFree(gId, slot))) availabilityMap.push(slot);
    });
  }
  return availabilityMap;
};

exports.checkGardenerAvailabilityInternal = checkGardenerAvailabilityInternal;

// Check availability based on gardener schedules
exports.checkAvailability = async (req, res) => {
  try {
    const { date, gardener_id, geofence_id } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'Date is required' });

    // Check if any gardeners are assigned to this zone at all
    let noGardenersInZone = false;
    if (geofence_id && !gardener_id) {
      const zoneCount = await GardenerZone.count({ where: { geofence_id } });
      if (zoneCount === 0) noGardenersInZone = true;
    }

    const slots = await checkGardenerAvailabilityInternal(date, gardener_id, geofence_id);
    res.json({
      success: true,
      data: slots,
      no_gardeners_in_zone: noGardenersInZone,
      message: noGardenersInZone ? 'No gardeners are currently serving this area.' : undefined
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// Check if instant on-demand booking is feasible right now in a given zone.
// Returns the configured ETA + whether any gardener is free to start "now".
// ───────────────────────────────────────────────────────────────────────────
exports.checkInstantAvailability = async (req, res) => {
  try {
    const { geofence_id } = req.query;
    if (!geofence_id) return res.status(400).json({ success: false, message: 'geofence_id is required' });

    const zone = await Geofence.findByPk(geofence_id);
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

    const etaMinutes = DEFAULT_INSTANT_ETA_MINUTES;

    // Today + (now + eta) in HH:mm — the slot we'd assign. Computed in IST so it
    // matches createBooking and the IST-stored booking timestamps.
    const target = nowIST().add(etaMinutes, 'minutes');
    const targetDate = target.format('YYYY-MM-DD');
    const targetTime = target.format('HH:mm');

    const zoneAssignments = await GardenerZone.findAll({ where: { geofence_id }, attributes: ['gardener_id'] });
    const zoneGardenerIds = zoneAssignments.map(gz => gz.gardener_id);
    if (zoneGardenerIds.length === 0) {
      return res.json({ success: true, data: { available: false, reason: 'no_gardeners_in_zone', eta_minutes: etaMinutes } });
    }

    const candidates = await GardenerProfile.findAll({
      where: { user_id: { [Op.in]: zoneGardenerIds }, is_available: true },
      include: [{ model: User, as: 'user', where: { is_active: true, is_approved: true, role: 'gardener' } }]
    });

    let freeCount = 0;
    for (const c of candidates) {
      const conflicts = await Booking.findAll({
        where: {
          gardener_id: c.user_id,
          scheduled_date: targetDate,
          status: { [Op.notIn]: ['cancelled', 'failed', 'completed'] }
        },
        attributes: ['scheduled_time']
      });
      const targetM = moment(targetTime, 'HH:mm');
      const isFree = !conflicts.some(b => Math.abs(targetM.diff(moment(b.scheduled_time, 'HH:mm:ss'), 'minutes')) < 120);
      if (isFree) freeCount++;
    }

    res.json({
      success: true,
      data: {
        available: freeCount > 0,
        eta_minutes: etaMinutes,
        gardener_count: freeCount,
        reason: freeCount > 0 ? null : 'no_free_gardeners',
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Generate booking number
const genBookingNumber = () => `GKM${Date.now().toString().slice(-8)}`;

// Generate 4-digit OTP for visit
const genVisitOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

// Create booking (on-demand)
exports.createBooking = async (req, res) => {
  try {
    let {
      zone_id, geofence_id, scheduled_date, scheduled_time,
      service_address, service_latitude, service_longitude,
      flat_no, building, area, landmark, city, state, pincode,
      plant_count, plan_id, customer_notes, preferred_gardener_id, payment_method,
      is_instant
    } = req.body;

    // Instant booking — server-side computes the slot. The client cannot pick
    // the time. ETA is currently a flat default; will be distance-based later.
    // NOTE: compute in IST (+05:30). The server process runs in UTC, so a bare
    // moment() would store the slot 5h30m behind wall-clock (a 14:22 IST booking
    // would show "09:42"). The DB connection already stores timestamps in IST,
    // so the slot must match.
    if (is_instant) {
      const target = nowIST().add(DEFAULT_INSTANT_ETA_MINUTES, 'minutes');
      scheduled_date = target.format('YYYY-MM-DD');
      scheduled_time = target.format('HH:mm');
    } else {
      if (!scheduled_date) {
        return res.status(400).json({ success: false, message: 'scheduled_date is required for scheduled bookings' });
      }
    }

    // Auto-save address to user profile
    const addressCtrl = require('./address.controller');
    await addressCtrl.smartSaveAddress(req.user.id, {
      flat_no, building, area, landmark, city, state, pincode,
      latitude: service_latitude, longitude: service_longitude,
      label: building || area || 'Home'
    });

    const activeZoneId = geofence_id || zone_id;
    // Use Geofence for pricing if available
    const zone = await Geofence.findByPk(activeZoneId);
    if (!zone) return res.status(404).json({ success: false, message: 'Service zone not found' });

    // The chosen plan defines how many plants are COVERED (max_plants). Anything
    // the customer adds on top is "extra plants" billed at ₹25 each.
    const plan = plan_id ? await ServicePlan.findByPk(plan_id) : null;
    const coveredPlants = plan ? (parseInt(plan.max_plants) || 0) : 0;

    const extraCount = parseInt(plant_count) || 0; // additional plants beyond plan coverage (optional)
    const pCount = extraCount; // pricing uses the extra plants only
    // Total plants serviced = plan coverage + extras (falls back to extras if no plan).
    const totalPlants = (coveredPlants + extraCount) || extraCount || 1;
    const minPlants = zone.min_plants || 1;
    const pricePerPlant = parseFloat(zone.price_per_plant) || 0;
    const basePrice = parseFloat(zone.base_price) || 0;
    const surge = parseFloat(zone.surge_multiplier) || 1.0;

    // Pricing model: a flat ₹25 per plant added on top of the zone base price.
    const ADDITIONAL_PLANT_RATE = 25;
    const baseAmount = basePrice + (pCount * ADDITIONAL_PLANT_RATE);

    // (Wallet balance is checked authoritatively inside the transaction below,
    //  against the full GST-inclusive total with the user row locked.)

    // Calculate addon total before creating booking
    const { addons } = req.body;
    let addonTotal = 0;
    let resolvedAddons = [];
    if (Array.isArray(addons) && addons.length > 0) {
      const addonIds = addons.map(a => a.addon_id).filter(Boolean);
      const addonServices = await AddOnService.findAll({ where: { id: addonIds, is_active: true } });
      resolvedAddons = addonServices.map(svc => {
        const req_addon = addons.find(a => Number(a.addon_id) === Number(svc.id));
        const qty = (req_addon && req_addon.quantity) || 1;
        addonTotal += parseFloat(svc.price) * qty;
        return { addon_id: svc.id, quantity: qty, price: parseFloat(svc.price) };
      });
    }

    // 18% GST is added on top of every booking (base + add-ons). total_amount is
    // GST-inclusive; the tax invoice derives the tax split from it (total / 1.18).
    const GST_RATE = 0.18;
    const grandTotal = Math.round((baseAmount + addonTotal) * (1 + GST_RATE) * 100) / 100;

    // ── Gardener assignment + booking creation are done inside a single DB
    // transaction so two simultaneous bookings can't grab the same gardener for
    // an overlapping slot (double-book race). We lock each candidate gardener's
    // profile row FOR UPDATE before checking their slot, so concurrent requests
    // targeting the same gardener serialize — the second one waits for the first
    // to commit, then sees the just-created booking in its conflict check.
    let gardener_id = null;
    let booking;
    try {
      booking = await sequelize.transaction(async (t) => {
        // Helper: lock the gardener's profile row, then check they're free at the
        // requested date/time (2-hr window). The lock is what serializes racers.
        const isGardenerFreeAtSlot = async (gId) => {
          await GardenerProfile.findOne({ where: { user_id: gId }, transaction: t, lock: t.LOCK.UPDATE });
          const conflicts = await Booking.findAll({
            where: {
              gardener_id: gId,
              scheduled_date,
              status: { [Op.notIn]: ['cancelled', 'failed'] }
            },
            attributes: ['scheduled_time'],
            transaction: t
          });
          const requestedMins = moment(scheduled_time, 'HH:mm');
          return !conflicts.some(b => {
            const bookingMins = moment(b.scheduled_time, 'HH:mm:ss');
            return Math.abs(requestedMins.diff(bookingMins, 'minutes')) < 120;
          });
        };

        // 1. Try preferred gardener first (must be in zone and free)
        if (preferred_gardener_id) {
          const inZone = await GardenerZone.findOne({ where: { gardener_id: preferred_gardener_id, geofence_id: activeZoneId }, transaction: t });
          const g = inZone ? await GardenerProfile.findOne({ where: { user_id: preferred_gardener_id, is_available: true }, transaction: t }) : null;
          if (g && await isGardenerFreeAtSlot(preferred_gardener_id)) gardener_id = preferred_gardener_id;
        }

        // 2. Auto-assign: find best available gardener assigned to this geofence
        if (!gardener_id) {
          const zoneAssignments = await GardenerZone.findAll({ where: { geofence_id: activeZoneId }, attributes: ['gardener_id'], transaction: t });
          const zoneGardenerIds = zoneAssignments.map(gz => gz.gardener_id);

          if (zoneGardenerIds.length === 0) {
            const e = new Error('No gardeners are available in your area. Please try again later or contact support.');
            e.httpStatus = 400;
            throw e;
          }

          // Find available gardeners in zone, ordered by rating desc
          const candidates = await GardenerProfile.findAll({
            where: { user_id: { [Op.in]: zoneGardenerIds }, is_available: true },
            include: [{ model: User, as: 'user', where: { is_active: true, is_approved: true, role: 'gardener' } }],
            order: [['rating', 'DESC']],
            transaction: t
          });

          for (const candidate of candidates) {
            if (await isGardenerFreeAtSlot(candidate.user_id)) {
              gardener_id = candidate.user_id;
              break;
            }
          }

          if (!gardener_id) {
            const e = new Error(is_instant
              ? 'No gardener is free for an instant visit right now. Please schedule a later slot.'
              : 'No gardener is available for the selected date and time slot. Please choose a different slot.');
            e.httpStatus = 409;
            e.noInstantSlot = !!is_instant;
            throw e;
          }
        }

        // Wallet payment: ensure sufficient balance BEFORE creating the booking,
        // so the wallet can't be driven negative.
        if (payment_method === 'wallet') {
          const walletUser = await User.findByPk(req.user.id, { attributes: ['wallet_balance'], transaction: t, lock: t.LOCK.UPDATE });
          const balance = parseFloat(walletUser?.wallet_balance) || 0;
          if (balance < grandTotal) {
            const e = new Error(`Insufficient wallet balance. This booking needs ₹${grandTotal.toFixed(0)} but your wallet has ₹${balance.toFixed(0)}.`);
            e.httpStatus = 400;
            throw e;
          }
        }

        const otp = genVisitOTP();
        const created = await Booking.create({
          booking_number: genBookingNumber(),
          customer_id: req.user.id,
          gardener_id,
          zone_id: activeZoneId,
          geofence_id: activeZoneId, // Map the selected geofence ID
          booking_type: 'ondemand',
          is_instant: !!is_instant,
          status: gardener_id ? 'assigned' : 'pending',
          assigned_at: gardener_id ? new Date() : null,
          scheduled_date,
          scheduled_time,
          otp,
          service_address,
          service_latitude,
          service_longitude,
          plant_count: totalPlants,   // total plants serviced (plan coverage + extras)
          extra_plants: extraCount,   // additional plants the customer added (₹25 each)
          base_amount: baseAmount,
          total_amount: grandTotal,
          customer_notes,
          payment_status: payment_method === 'wallet' ? 'paid' : 'pending'
        }, { transaction: t });

        // Create BookingAddOn records
        if (resolvedAddons.length > 0) {
          await BookingAddOn.bulkCreate(resolvedAddons.map(a => ({ booking_id: created.id, ...a })), { transaction: t });
        }

        // Deduct wallet balance if wallet payment (full total including addons)
        if (payment_method === 'wallet') {
          await User.decrement({ wallet_balance: grandTotal }, { where: { id: req.user.id }, transaction: t });
          await User.increment({ total_spent: grandTotal }, { where: { id: req.user.id }, transaction: t });
        }

        return created;
      });
    } catch (txErr) {
      // Assignment/wallet failures throw a controlled httpStatus; surface them as-is.
      if (txErr.httpStatus) {
        const body = { success: false, message: txErr.message };
        if (txErr.noInstantSlot) body.no_instant_slot = true;
        return res.status(txErr.httpStatus).json(body);
      }
      throw txErr; // unexpected → bubble to the outer catch (500)
    }

    // Log booking creation
    await logBookingEvent(booking.id, 'created', req.user.id, 'customer', { zone_id: activeZoneId, payment_method: payment_method || 'online', surge_multiplier: surge }, `Booking ${booking.booking_number} created`);
    if (gardener_id) {
      await logBookingEvent(booking.id, 'assigned', null, 'system', { gardener_id }, 'Auto-assigned to gardener');
    }

    // Send WhatsApp notification
    const customer = await User.findByPk(req.user.id);
    await sendWhatsApp(customer.phone, templates.bookingConfirmed(customer.name, scheduled_date, scheduled_time || 'Morning'));

    // Notify finance for wallet bookings (paid immediately). Online (Razorpay)
    // bookings are reported from fulfillEntity once payment is verified, so they
    // are NOT emailed here to avoid duplicates / reporting unpaid bookings.
    if (payment_method === 'wallet') {
      require('../services/financeMail').notifyBooking(booking.id, 'Wallet');
    }

    // ── NOTIFY ─────────────────────────────────────────────────────────────
    const notificationService = require('../services/notification.service');

    // Notify Customer
    await notificationService.notifyUser(req.user.id, {
      title: '🌿 Booking Received',
      body: `Your booking ${booking.booking_number} for ${scheduled_date} has been confirmed.`,
      type: 'success',
      data: { booking_id: booking.id }
    });

    // Notify Admin
    await notificationService.notifyAdmins({
      title: '🌿 New On-Demand Booking',
      body: `Booking ${booking.booking_number} received from ${customer.name} for ${scheduled_date}.`,
      type: 'info',
      data: { booking_id: booking.id }
    });

    if (gardener_id) {
      const g = await User.findByPk(gardener_id);
      // Notify customer
      if (customer.fcm_token) {
        await notify.bookingAssigned(customer.fcm_token, booking.booking_number, g?.name || 'Gardener');
      }

      // Real-time notification to Customer about gardener assignment
      await notificationService.notifyUser(customer.id, {
        title: '👨‍🌾 Gardener Assigned',
        body: `${g?.name || 'A gardener'} has been assigned to your booking ${booking.booking_number}.`,
        type: 'info',
        data: { booking_id: booking.id, gardener_name: g?.name }
      });

      // Notify gardener
      if (g?.fcm_token) {
        await notify.newJobAssigned(g.fcm_token, booking.booking_number, service_address, scheduled_date);
      }

      // Real-time notification to Gardener
      await notificationService.notifyUser(gardener_id, {
        title: '💼 New Job Assigned',
        body: `You have been assigned a new job ${booking.booking_number} at ${service_address}.`,
        type: 'info',
        data: { booking_id: booking.id }
      });
    }

    res.status(201).json({ success: true, message: 'Booking created', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get customer bookings
exports.getMyBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const where = { customer_id: req.user.id };
    if (status) where.status = status;

    const { count, rows } = await Booking.findAndCountAll({
      where,
      include: [
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone', 'profile_image'], include: [{ model: GardenerProfile, as: 'gardenerProfile', attributes: ['rating', 'total_jobs'] }] },
        { model: ServiceZone, as: 'zone', attributes: ['name', 'city'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });

    res.json({ success: true, data: { bookings: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



// Get booking detail
exports.getBookingDetail = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      where: { id: req.params.id },
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'profile_image'] },
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone', 'profile_image'], include: [{ model: GardenerProfile, as: 'gardenerProfile' }] },
        { model: ServiceZone, as: 'zone' },
        { model: BookingTracking, as: 'tracking', order: [['created_at', 'DESC']], limit: 1, separate: true },
        { model: BookingAddOn, as: 'addons', include: [{ model: AddOnService, as: 'addon' }] },
        { model: BookingTimeAddon, as: 'timeAddons' },
        { model: Geofence, as: 'geofenceRef', attributes: ['id', 'name', 'visit_minutes', 'time_addon_minutes', 'time_addon_price'] }
      ]
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// Customer: request a TIME ADDON on an on-demand booking.
// Each call adds one block of `time_addon_minutes` at `time_addon_price`,
// both configured per geofence/zone by the admin. Block size defaults to 30.
// ───────────────────────────────────────────────────────────────────────────
exports.requestTimeAddon = async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    const blocks = Math.max(1, parseInt(req.body.blocks) || 1); // allow buying N blocks at once

    const booking = await Booking.findByPk(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customer_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your booking' });
    if (booking.booking_type !== 'ondemand') return res.status(400).json({ success: false, message: 'Time addons are only available for on-demand visits' });

    // Customer can only add time AFTER they've shared the OTP and the visit has started.
    if (booking.status !== 'in_progress' || !booking.otp_verified) {
      return res.status(400).json({ success: false, message: 'Extra time can only be added after the gardener has started the visit (OTP verified).' });
    }

    // Resolve zone config (prefer geofence_id, then zone_id)
    const geofence = booking.geofence_id ? await Geofence.findByPk(booking.geofence_id) : null;
    if (!geofence) return res.status(400).json({ success: false, message: 'No service zone found for this booking' });

    const minutesPerBlock = parseInt(geofence.time_addon_minutes) || 30;
    const pricePerBlock = parseFloat(geofence.time_addon_price);
    if (!pricePerBlock || pricePerBlock <= 0) {
      return res.status(400).json({ success: false, message: 'Time addon is not configured for this zone. Please contact support.' });
    }

    const minutes = minutesPerBlock * blocks;
    const amount = pricePerBlock * blocks;

    const addon = await BookingTimeAddon.create({
      booking_id: booking.id,
      minutes,
      amount,
      requested_by: req.user.id,
      status: 'accepted',         // auto-accepted — customer-initiated
      payment_status: 'pending',  // settled at visit completion / via existing payment flow
    });

    await booking.update({
      extra_time_minutes: (booking.extra_time_minutes || 0) + minutes,
      extra_time_amount: parseFloat(booking.extra_time_amount || 0) + amount,
      total_amount: parseFloat(booking.total_amount || 0) + amount,
    });

    await logBookingEvent(booking.id, 'time_addon', req.user.id, 'customer',
      { minutes, amount, blocks },
      `Customer added ${minutes} mins (+₹${amount}) to the visit`);

    // Notify gardener
    if (booking.gardener_id) {
      try {
        const notificationService = require('../services/notification.service');
        await notificationService.notifyUser(booking.gardener_id, {
          title: '⏱️ Extra time requested',
          body: `Customer extended the visit by ${minutes} mins (+₹${amount}).`,
          type: 'info',
          data: { booking_id: booking.id, minutes, amount }
        });
        const gardener = await User.findByPk(booking.gardener_id);
        if (gardener?.fcm_token) {
          await notify.custom?.(gardener.fcm_token, '⏱️ Extra time requested',
            `Customer added ${minutes} mins (+₹${amount}) to booking ${booking.booking_number}`);
        }
      } catch (_) {}
    }

    res.status(201).json({
      success: true,
      message: `Added ${minutes} minutes (+₹${amount})`,
      data: {
        addon,
        booking: {
          id: booking.id,
          extra_time_minutes: booking.extra_time_minutes,
          extra_time_amount: booking.extra_time_amount,
          total_amount: booking.total_amount
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTimeAddons = async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    const booking = await Booking.findByPk(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    // Only customer, assigned gardener, or admin/supervisor can read
    const role = req.user.role;
    const isAuthed = role === 'admin' || role === 'supervisor'
      || booking.customer_id === req.user.id
      || booking.gardener_id === req.user.id;
    if (!isAuthed) return res.status(403).json({ success: false, message: 'Not authorized' });

    const addons = await BookingTimeAddon.findAll({
      where: { booking_id: bookingId },
      order: [['created_at', 'ASC']]
    });

    let blockMinutes = 30, blockPrice = 0;
    if (booking.geofence_id) {
      const g = await Geofence.findByPk(booking.geofence_id);
      if (g) { blockMinutes = parseInt(g.time_addon_minutes) || 30; blockPrice = parseFloat(g.time_addon_price) || 0; }
    }

    res.json({
      success: true,
      data: {
        addons,
        config: { block_minutes: blockMinutes, block_price: blockPrice, configured: blockPrice > 0 },
        totals: {
          extra_time_minutes: booking.extra_time_minutes || 0,
          extra_time_amount: parseFloat(booking.extra_time_amount || 0)
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Verify OTP to start visit
exports.verifyVisitOtp = async (req, res) => {
  try {
    const { booking_id, otp } = req.body;
    const booking = await Booking.findByPk(booking_id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.gardener_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your booking' });
    if (booking.status !== 'arrived') return res.status(400).json({ success: false, message: 'Please mark yourself as arrived at the location first' });
    if (booking.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP. Please ask the customer to check their notification.' });

    await booking.update({ otp_verified: true, otp_verified_at: new Date(), status: 'in_progress', started_at: new Date() });

    await logBookingEvent(booking.id, 'otp_accepted', req.user.id, 'gardener', null, 'OTP verified, service started');

    const customer = await User.findByPk(booking.customer_id);
    await sendWhatsApp(customer.phone, `🌿 *GharKaMali*\nYour garden service has started! Estimated completion: 1-2 hours.`);

    res.json({ success: true, message: 'Visit started', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Gardener: Update job status
exports.updateBookingStatus = async (req, res) => {
  try {
    const { booking_id, status, gardener_notes, extra_plants } = req.body;
    const booking = await Booking.findByPk(booking_id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.gardener_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your booking' });

    // Handle failed visit (customer unavailable)
    if (status === 'failed') {
      await booking.update({ status: 'failed', gardener_notes: gardener_notes || 'Customer unavailable' });
      const customer = await User.findByPk(booking.customer_id);
      if (customer) {
        await sendWhatsApp(customer.phone, `⚠️ *GharKaMali*\nYour gardener arrived for booking ${booking.booking_number} but couldn't reach you. The visit has been marked failed. Please reschedule or contact support.`);
      }
      return res.json({ success: true, message: 'Booking marked as failed', data: booking });
    }

    const updates = { status };
    const notificationService = require('../services/notification.service');

    if (status === 'en_route') {
      await logBookingEvent(booking.id, 'en_route', req.user.id, 'gardener', null, 'Gardener is on the way');
      const customer = await User.findByPk(booking.customer_id);
      const gardener = await User.findByPk(req.user.id);
      await sendWhatsApp(customer.phone, templates.gardenerEnRoute(customer.name, gardener.name, '15'));
      if (customer.fcm_token) await notify.gardenerEnRoute(customer.fcm_token, gardener.name, booking.booking_number);

      // Real-time
      await notificationService.notifyUser(customer.id, {
        title: '🚚 Gardener En Route',
        body: `${gardener.name} is on the way to your location for booking ${booking.booking_number}.`,
        type: 'info',
        data: { booking_id: booking.id, latitude: gardener.latitude, longitude: gardener.longitude }
      });
    }
    if (status === 'arrived') {
      await logBookingEvent(booking.id, 'arrived', req.user.id, 'gardener', null, 'Gardener arrived at location');
      await logBookingEvent(booking.id, 'otp_sent', null, 'system', { otp: booking.otp }, 'OTP sent to customer');
      const customer = await User.findByPk(booking.customer_id);
      await sendWhatsApp(customer.phone, templates.gardenerArrived(customer.name, booking.otp));
      if (customer.fcm_token) await notify.gardenerArrived(customer.fcm_token, booking.otp, booking.booking_number);

      // Real-time
      await notificationService.notifyUser(customer.id, {
        title: '📍 Gardener Arrived',
        body: `Your gardener has arrived! Please share the OTP ${booking.otp} to start the service.`,
        type: 'info',
        data: { booking_id: booking.id, otp: booking.otp }
      });
    }

    if (status === 'completed') {
      updates.completed_at = new Date();

      if (extra_plants > 0) {
        const zone = await Geofence.findByPk(booking.zone_id);
        const extraAmt = extra_plants * (zone ? parseFloat(zone.price_per_plant) : 15);
        updates.extra_plants = extra_plants;
        updates.extra_amount = extraAmt;
        updates.total_amount = parseFloat(booking.total_amount) + extraAmt;
      }

      if (req.files) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        if (req.files.before_image) updates.before_image = `${baseUrl}/uploads/work-proof/${req.files.before_image[0].filename}`;
        if (req.files.after_image) updates.after_image = `${baseUrl}/uploads/work-proof/${req.files.after_image[0].filename}`;
      }

      // Parse checklist submitted by gardener
      let checklistDone = [];
      if (req.body.checklist_done) {
        try { checklistDone = JSON.parse(req.body.checklist_done); } catch (_) {}
      }
      if (checklistDone.length > 0 || gardener_notes) {
        updates.gardener_notes = JSON.stringify({ tasks: checklistDone, notes: gardener_notes || null });
      }

      const customer = await User.findByPk(booking.customer_id);
      const finalAmount = updates.total_amount || booking.total_amount;

      // Send visit report via WhatsApp
      await sendWhatsApp(customer.phone, templates.visitReport(customer.name, booking.booking_number, checklistDone, gardener_notes || null));
      await sendWhatsApp(customer.phone, templates.visitCompleted(customer.name, finalAmount));
      if (customer?.fcm_token) await notify.visitCompleted(customer.fcm_token, booking.booking_number, finalAmount);

      // Real-time
      await notificationService.notifyUser(customer.id, {
        title: '✅ Service Completed',
        body: `Your garden service for booking ${booking.booking_number} is complete. Thank you!`,
        type: 'success',
        data: { booking_id: booking.id, total_amount: finalAmount }
      });

      // Update gardener stats
      await GardenerProfile.increment({
        total_jobs: 1,
        completed_jobs: 1,
        total_earnings: finalAmount
      }, { where: { user_id: req.user.id } });

      if (booking.booking_type === 'subscription' && booking.subscription_id) {
        await Subscription.increment('visits_used', { where: { id: booking.subscription_id } });
      }

      await logBookingEvent(booking.id, 'completed', req.user.id, 'gardener', { total_amount: finalAmount }, 'Service completed');
    }

    await booking.update(updates);
    res.json({ success: true, message: 'Status updated', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Rate booking
exports.rateBooking = async (req, res) => {
  try {
    const { booking_id, rating, review } = req.body;
    const booking = await Booking.findByPk(booking_id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.customer_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your booking' });
    if (booking.status !== 'completed') return res.status(400).json({ success: false, message: 'Can only rate completed bookings' });

    await booking.update({ rating, review, rated_at: new Date() });

    // Update gardener rating
    if (booking.gardener_id) {
      const allBookings = await Booking.findAll({ where: { gardener_id: booking.gardener_id, rating: { [Op.not]: null } } });
      const avgRating = allBookings.reduce((sum, b) => sum + b.rating, 0) / allBookings.length;
      await GardenerProfile.update({ rating: avgRating.toFixed(2) }, { where: { user_id: booking.gardener_id } });
    }

    res.json({ success: true, message: 'Rating submitted', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Gardener: get assigned jobs
exports.getGardenerJobs = async (req, res) => {
  try {
    const { status, date } = req.query;
    const where = { gardener_id: req.user.id };
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      where.status = statuses.length > 1 ? { [Op.in]: statuses } : statuses[0];
    }
    if (date) where.scheduled_date = date;

    const bookings = await Booking.findAll({
      where,
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'profile_image', 'address'] },
        { model: ServiceZone, as: 'zone', attributes: ['name', 'city'] }
      ],
      order: [['scheduled_date', 'ASC'], ['scheduled_time', 'ASC']]
    });

    res.json({ success: true, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update gardener location
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, booking_id } = req.body;
    await GardenerProfile.update({ current_latitude: latitude, current_longitude: longitude, last_location_update: new Date() }, { where: { user_id: req.user.id } });

    if (booking_id) {
      await BookingTracking.create({ booking_id, gardener_id: req.user.id, latitude, longitude });
    }

    res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get gardener location for tracking
exports.getGardenerLocation = async (req, res) => {
  try {
    const { booking_id } = req.params;
    const booking = await Booking.findByPk(booking_id);
    if (!booking || booking.customer_id !== req.user.id) return res.status(403).json({ success: false, message: 'Access denied' });

    const profile = await GardenerProfile.findOne({ where: { user_id: booking.gardener_id } });
    res.json({ success: true, data: { latitude: profile?.current_latitude, longitude: profile?.current_longitude, updated_at: profile?.last_location_update } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get booking audit logs
exports.getBookingLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findByPk(id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    // Access control: customers can only see their own booking logs
    if (req.user.role === 'customer' && booking.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    // Gardeners can only see logs for their own jobs
    if (req.user.role === 'gardener' && booking.gardener_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const logs = await BookingLog.findAll({
      where: { booking_id: id },
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'role'], required: false }],
      order: [['created_at', 'ASC']]
    });

    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Cancel booking
exports.cancelBooking = async (req, res) => {
  try {
    const { booking_id, reason } = req.body;
    const booking = await Booking.findByPk(booking_id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (!['pending', 'assigned'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel booking in current status' });
    }

    await booking.update({ status: 'cancelled', cancellation_reason: reason });

    await logBookingEvent(booking.id, 'cancelled', req.user.id, req.user.role, { reason }, `Booking cancelled: ${reason || 'No reason'}`);

    if (booking.gardener_id) {
      await GardenerProfile.increment({ cancelled_jobs: 1 }, { where: { user_id: booking.gardener_id } });
    }

    res.json({ success: true, message: 'Booking cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
