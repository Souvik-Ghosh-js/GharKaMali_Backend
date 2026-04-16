const { notify } = require('../services/push.service');
const { Op, fn, col, literal } = require('sequelize');
const { Booking, User, GardenerProfile, Subscription, ServiceZone, ServicePlan, Notification, BookingTracking, Geofence, GardenerZone, BookingLog } = require('../models');
const { sendWhatsApp, templates } = require('../services/otp.service');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

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
    const gzs = await GardenerZone.findAll({ where: { zone_id } });
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
    const { date, gardener_id, zone_id } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'Date is required' });

    const slots = await checkGardenerAvailabilityInternal(date, gardener_id, zone_id);
    res.json({ success: true, data: slots });
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
    const { zone_id, scheduled_date, scheduled_time, service_address, service_latitude, service_longitude, plant_count, customer_notes, preferred_gardener_id, payment_method } = req.body;

    // Use Geofence for pricing if available
    const zone = await Geofence.findByPk(zone_id);
    if (!zone) return res.status(404).json({ success: false, message: 'Service zone not found' });

    const pCount = parseInt(plant_count) || 1;
    const minPlants = zone.min_plants || 1;
    const pricePerPlant = parseFloat(zone.price_per_plant) || 0;
    const basePrice = parseFloat(zone.base_price) || 0;
    const surge = parseFloat(zone.surge_multiplier) || 1.0;

    const extraPlants = Math.max(0, pCount - minPlants);
    const baseAmount = (basePrice + (extraPlants * pricePerPlant)) * surge;

    // Wallet payment: check balance before confirming
    if (payment_method === 'wallet') {
      const customer = await User.findByPk(req.user.id);
      if (parseFloat(customer.wallet_balance) < baseAmount) {
        return res.status(400).json({ success: false, message: `Insufficient wallet balance. Required: ₹${baseAmount.toFixed(2)}, Available: ₹${parseFloat(customer.wallet_balance).toFixed(2)}` });
      }
    }

    // Find best gardener
    let gardener_id = null;
    if (preferred_gardener_id) {
      const g = await GardenerProfile.findOne({ where: { user_id: preferred_gardener_id, is_available: true } });
      if (g) gardener_id = preferred_gardener_id;
    }

    if (!gardener_id) {
      // Find nearest available gardener in zone
      const available = await GardenerProfile.findOne({
        where: { is_available: true },
        include: [{ model: User, as: 'user', where: { is_active: true, is_approved: true } }]
      });
      if (available) gardener_id = available.user_id;
    }

    const otp = genVisitOTP();
    const booking = await Booking.create({
      booking_number: genBookingNumber(),
      customer_id: req.user.id,
      gardener_id,
      zone_id,
      booking_type: 'ondemand',
      status: gardener_id ? 'assigned' : 'pending',
      assigned_at: gardener_id ? new Date() : null,
      scheduled_date,
      scheduled_time,
      otp,
      service_address,
      service_latitude,
      service_longitude,
      plant_count: plant_count || 1,
      base_amount: baseAmount,
      total_amount: baseAmount,
      customer_notes,
      payment_status: payment_method === 'wallet' ? 'paid' : 'pending'
    });

    // Deduct wallet balance if wallet payment
    if (payment_method === 'wallet') {
      await User.decrement({ wallet_balance: baseAmount }, { where: { id: req.user.id } });
      await User.increment({ total_spent: baseAmount }, { where: { id: req.user.id } });
    }

    // Log booking creation
    await logBookingEvent(booking.id, 'created', req.user.id, 'customer', { zone_id, payment_method: payment_method || 'online', surge_multiplier: surge }, `Booking ${booking.booking_number} created`);
    if (gardener_id) {
      await logBookingEvent(booking.id, 'assigned', null, 'system', { gardener_id }, 'Auto-assigned to gardener');
    }

    // Send WhatsApp notification
    const customer = await User.findByPk(req.user.id);
    await sendWhatsApp(customer.phone, templates.bookingConfirmed(customer.name, scheduled_date, scheduled_time || 'Morning'));
    
    if (gardener_id) {
      const g = await User.findByPk(gardener_id);
      // Notify customer
      if (customer.fcm_token) {
        await notify.bookingAssigned(customer.fcm_token, booking.booking_number, g?.name || 'Gardener');
      }
      // Notify gardener
      if (g?.fcm_token) {
        await notify.newJobAssigned(g.fcm_token, booking.booking_number, service_address, scheduled_date);
      }
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
        { model: BookingTracking, as: 'tracking', order: [['created_at', 'DESC']], limit: 1 }
      ]
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: booking });
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
    if (booking.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });

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
    if (gardener_notes) updates.gardener_notes = gardener_notes;
    if (status === 'assigned') updates.assigned_at = new Date();
    if (status === 'en_route') updates.en_route_at = new Date();
    if (status === 'arrived') updates.gardener_arrived_at = new Date();
    if (status === 'en_route') {
      await logBookingEvent(booking.id, 'en_route', req.user.id, 'gardener', null, 'Gardener is on the way');
      const customer = await User.findByPk(booking.customer_id);
      const gardener = await User.findByPk(req.user.id);
      await sendWhatsApp(customer.phone, templates.gardenerEnRoute(customer.name, gardener.name, '15'));
      if (customer.fcm_token) await notify.gardenerEnRoute(customer.fcm_token, gardener.name, booking.booking_number);
    }
    if (status === 'arrived') {
      await logBookingEvent(booking.id, 'arrived', req.user.id, 'gardener', null, 'Gardener arrived at location');
      await logBookingEvent(booking.id, 'otp_sent', null, 'system', { otp: booking.otp }, 'OTP sent to customer');
      const customer = await User.findByPk(booking.customer_id);
      await sendWhatsApp(customer.phone, templates.gardenerArrived(customer.name, booking.otp));
      if (customer.fcm_token) await notify.gardenerArrived(customer.fcm_token, booking.otp, booking.booking_number);
    }

    if (status === 'completed') {
      updates.completed_at = new Date();
      // Extra plants billing
      if (extra_plants > 0) {
        const zone = await Geofence.findByPk(booking.zone_id);
        const extraAmt = extra_plants * (zone ? parseFloat(zone.price_per_plant) : 15);
        updates.extra_plants = extra_plants;
        updates.extra_amount = extraAmt;
        // FIX: Increment current total_amount instead of resetting it (preserves add-ons)
        updates.total_amount = parseFloat(booking.total_amount) + extraAmt;
      }

      // Handle work proof images
      if (req.files) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        if (req.files.before_image) updates.before_image = `${baseUrl}/uploads/work-proof/${req.files.before_image[0].filename}`;
        if (req.files.after_image) updates.after_image = `${baseUrl}/uploads/work-proof/${req.files.after_image[0].filename}`;
      }

      const customer = await User.findByPk(booking.customer_id);
      await sendWhatsApp(customer.phone, templates.visitCompleted(customer.name, updates.total_amount || booking.total_amount));
      if (customer?.fcm_token) await notify.visitCompleted(customer.fcm_token, booking.booking_number, updates.total_amount || booking.total_amount);

      // Update gardener stats: increment jobs AND earnings
      await GardenerProfile.increment({ 
        total_jobs: 1, 
        completed_jobs: 1,
        total_earnings: updates.total_amount || booking.total_amount
      }, { where: { user_id: req.user.id } });

      // If subscription booking, increment used visits
      if (booking.booking_type === 'subscription' && booking.subscription_id) {
        await Subscription.increment('visits_used', { where: { id: booking.subscription_id } });
      }
    }

    if (status === 'completed') {
      await logBookingEvent(booking.id, 'completed', req.user.id, 'gardener', { total_amount: updates.total_amount || booking.total_amount }, 'Service completed');
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
    if (status) where.status = status;
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
