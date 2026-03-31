const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { uploadProfile, uploadWorkProof, uploadPlant, uploadBlog, uploadIdProof, uploadShop } = require('../middleware/upload');
const authCtrl = require('../controllers/auth.controller');
const bookingCtrl = require('../controllers/booking.controller');
const subscriptionCtrl = require('../controllers/subscription.controller');
const adminCtrl = require('../controllers/admin.controller');
const contentCtrl = require('../controllers/content.controller');
const shopCtrl = require('../controllers/shop.controller');
const taglineCtrl = require('../controllers/tagline.controller');

// ── AUTH ──────────────────────────────────────────────────────────────────────
router.post('/auth/send-otp', authCtrl.sendOtp);
router.post('/auth/verify-otp', authCtrl.verifyOtp);
router.post('/auth/admin-login', authCtrl.adminLogin);
router.post('/auth/gardener-login', authCtrl.gardenerLogin);
router.post('/auth/gardener-register',
  uploadIdProof.fields([{ name: 'profile_image', maxCount: 1 }, { name: 'id_proof', maxCount: 1 }]),
  authCtrl.gardenerRegister
);
router.get('/auth/profile', authenticate, authCtrl.getProfile);
router.put('/auth/profile', authenticate, uploadProfile.single('profile_image'), authCtrl.updateProfile);

// ── BOOKINGS ──────────────────────────────────────────────────────────────────
router.post('/bookings', authenticate, authorize('customer'), bookingCtrl.createBooking);
router.get('/bookings/my', authenticate, authorize('customer'), bookingCtrl.getMyBookings);
router.get('/bookings/:id', authenticate, bookingCtrl.getBookingDetail);
router.post('/bookings/verify-otp', authenticate, authorize('gardener'), bookingCtrl.verifyVisitOtp);
router.put('/bookings/status',
  authenticate, authorize('gardener'),
  uploadWorkProof.fields([{ name: 'before_image', maxCount: 1 }, { name: 'after_image', maxCount: 1 }]),
  bookingCtrl.updateBookingStatus
);
router.post('/bookings/rate', authenticate, authorize('customer'), bookingCtrl.rateBooking);
router.post('/bookings/cancel', authenticate, bookingCtrl.cancelBooking);
router.get('/bookings/gardener/jobs', authenticate, authorize('gardener'), bookingCtrl.getGardenerJobs);
router.post('/bookings/location', authenticate, authorize('gardener'), bookingCtrl.updateLocation);
router.get('/bookings/track/:booking_id', authenticate, authorize('customer'), bookingCtrl.getGardenerLocation);

// ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────────
router.get('/plans', subscriptionCtrl.getPlans);
router.post('/subscriptions', authenticate, authorize('customer'), subscriptionCtrl.subscribe);
router.get('/subscriptions/my', authenticate, authorize('customer'), subscriptionCtrl.getMySubscriptions);
router.put('/subscriptions/:id/cancel', authenticate, authorize('customer'), subscriptionCtrl.cancelSubscription);
router.post('/subscriptions/:id/select-dates', authenticate, authorize('customer'), subscriptionCtrl.selectDates);

// ── PLANTOPEDIA ───────────────────────────────────────────────────────────────
router.post('/plants/identify', authenticate, uploadPlant.single('image'), contentCtrl.identifyPlant);
router.get('/plants/history', authenticate, contentCtrl.getMyPlantHistory);

// ── BLOGS ─────────────────────────────────────────────────────────────────────
router.get('/blogs', contentCtrl.getBlogs);
router.get('/blogs/:slug', contentCtrl.getBlogBySlug);

// ── CITY PAGES ────────────────────────────────────────────────────────────────
router.get('/cities', contentCtrl.getCityPages);
router.get('/cities/:slug', contentCtrl.getCityPage);

// ── SHOP / MARKETPLACE ────────────────────────────────────────────────────────
router.get('/shop/categories', shopCtrl.getCategories);
router.get('/shop/products', shopCtrl.getProducts);
router.get('/shop/products/:id', shopCtrl.getProductDetail);
router.post('/shop/orders', authenticate, authorize('customer'), shopCtrl.createOrder);
router.get('/shop/orders/my', authenticate, authorize('customer'), shopCtrl.getMyOrders);

// ── ZONES (public) ────────────────────────────────────────────────────────────
router.get('/zones', adminCtrl.getZones);

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
router.get('/notifications', authenticate, contentCtrl.getNotifications);
router.put('/notifications/:id/read', authenticate, contentCtrl.markNotificationRead);

// ── SUPERVISOR ────────────────────────────────────────────────────────────────
router.get('/supervisor/dashboard', authenticate, authorize('supervisor', 'admin'), contentCtrl.getSupervisorDashboard);

// ── ADMIN ─────────────────────────────────────────────────────────────────────
router.get('/admin/dashboard', authenticate, authorize('admin'), adminCtrl.getDashboard);
router.get('/admin/analytics', authenticate, authorize('admin'), adminCtrl.getAnalytics);

router.get('/admin/gardeners', authenticate, authorize('admin', 'supervisor'), adminCtrl.getGardeners);
router.put('/admin/gardeners/:id', authenticate, authorize('admin'), adminCtrl.updateGardener);
router.post('/admin/gardeners/approve', authenticate, authorize('admin'), adminCtrl.approveGardener);
router.post('/admin/gardeners/reject', authenticate, authorize('admin'), adminCtrl.rejectGardener);
router.delete('/admin/gardeners/:id', authenticate, authorize('admin'), adminCtrl.deleteGardener);

// ── GEOFENCE MANAGEMENT ──────────────────────────────────────────────────────
router.get('/admin/geofence', authenticate, authorize('admin'), adminCtrl.getGeofences);
router.post('/admin/geofence', authenticate, authorize('admin'), adminCtrl.createGeofence);
router.put('/admin/geofence/:id', authenticate, authorize('admin'), adminCtrl.updateGeofence);
router.delete('/admin/geofence/:id', authenticate, authorize('admin'), adminCtrl.deleteGeofence);


router.get('/admin/supervisors', authenticate, authorize('admin'), adminCtrl.getSupervisors);
router.post('/admin/supervisors', authenticate, authorize('admin'), adminCtrl.createSupervisor);

router.get('/admin/zones', authenticate, authorize('admin'), adminCtrl.getZones);
router.post('/admin/zones', authenticate, authorize('admin'), adminCtrl.createZone);
router.put('/admin/zones/:id', authenticate, authorize('admin'), adminCtrl.updateZone);

router.get('/admin/plans', authenticate, authorize('admin'), subscriptionCtrl.getPlans);
router.post('/admin/plans', authenticate, authorize('admin'), adminCtrl.createPlan);
router.put('/admin/plans/:id', authenticate, authorize('admin'), adminCtrl.updatePlan);

router.get('/admin/bookings', authenticate, authorize('admin', 'supervisor'), adminCtrl.getAllBookings);
router.get('/admin/bookings/:id', authenticate, authorize('admin', 'supervisor'), bookingCtrl.getBookingDetail);
router.get('/admin/subscriptions', authenticate, authorize('admin'), subscriptionCtrl.getAllSubscriptions);
router.get('/admin/customers', authenticate, authorize('admin'), adminCtrl.getCustomers);

router.post('/admin/rewards', authenticate, authorize('admin'), adminCtrl.createRewardPenalty);
router.get('/admin/rewards', authenticate, authorize('admin'), adminCtrl.getRewardPenalties);

router.post('/admin/price-hike', authenticate, authorize('admin'), adminCtrl.triggerPriceHike);

// Admin blog/content management
router.post('/admin/blogs', authenticate, authorize('admin'), uploadBlog.single('featured_image'), contentCtrl.createBlog);
router.put('/admin/blogs/:id', authenticate, authorize('admin'), uploadBlog.single('featured_image'), contentCtrl.updateBlog);
router.delete('/admin/blogs/:id', authenticate, authorize('admin'), contentCtrl.deleteBlog);
router.post('/admin/cities', authenticate, authorize('admin'), contentCtrl.upsertCityPage);
router.get('/admin/plants/history', authenticate, authorize('admin'), contentCtrl.getAllPlantIdentifications);

// Admin Shop Management
router.get('/admin/shop/categories', authenticate, authorize('admin'), adminCtrl.getAdminCategories);
router.post('/admin/shop/categories', authenticate, authorize('admin'), uploadShop.single('image'), adminCtrl.createCategory);
router.put('/admin/shop/categories/:id', authenticate, authorize('admin'), uploadShop.single('image'), adminCtrl.updateCategory);
router.delete('/admin/shop/categories/:id', authenticate, authorize('admin'), adminCtrl.deleteCategory);

router.get('/admin/shop/products', authenticate, authorize('admin'), adminCtrl.getAdminProducts);
router.post('/admin/shop/products', authenticate, authorize('admin'), uploadShop.single('image'), adminCtrl.createProduct);
router.put('/admin/shop/products/:id', authenticate, authorize('admin'), uploadShop.single('image'), adminCtrl.updateProduct);
router.delete('/admin/shop/products/:id', authenticate, authorize('admin'), adminCtrl.deleteProduct);

router.get('/admin/shop/orders', authenticate, authorize('admin', 'supervisor'), adminCtrl.getAdminOrders);
router.put('/admin/shop/orders/:id/status', authenticate, authorize('admin', 'supervisor'), adminCtrl.updateOrderStatus);

// ─── TAGLINES ────────────────────────────────────────────────────────────────
router.get('/taglines', taglineCtrl.getActiveTaglines);
router.get('/admin/taglines', authenticate, authorize('admin'), taglineCtrl.getAdminTaglines);
router.post('/admin/taglines', authenticate, authorize('admin'), uploadShop.single('image'), taglineCtrl.createTagline);
router.put('/admin/taglines/:id', authenticate, authorize('admin'), uploadShop.single('image'), taglineCtrl.updateTagline);
router.delete('/admin/taglines/:id', authenticate, authorize('admin'), taglineCtrl.deleteTagline);


module.exports = router;

// ── PAYMENTS (PayU) ───────────────────────────────────────────────────────────
const paymentCtrl = require('../controllers/payment.controller');
router.post('/payments/initiate', authenticate, paymentCtrl.initiatePayment);
router.post('/payments/success', paymentCtrl.paymentSuccess);       // PayU callback
router.post('/payments/failure', paymentCtrl.paymentFailure);       // PayU callback
router.get('/payments/status/:txnid', authenticate, paymentCtrl.checkPaymentStatus);
router.get('/payments/my', authenticate, paymentCtrl.getMyPayments);
router.post('/payments/wallet-topup', authenticate, paymentCtrl.walletTopup);
router.post('/payments/reschedule', authenticate, paymentCtrl.rescheduleBooking);
router.get('/payments/check-serviceability', paymentCtrl.checkServiceability);
router.get('/admin/payments', authenticate, authorize('admin'), paymentCtrl.getAllPayments);

// ── GARDENER EARNINGS BREAKDOWN ───────────────────────────────────────────────
router.get('/bookings/gardener/earnings', authenticate, authorize('gardener'), async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    const db = require('../config/database');
    const { Op } = require('sequelize');
    const moment = require('moment');

    let since, groupBy, labelFormat;
    switch (period) {
      case 'daily':
        since = moment().subtract(7, 'days').toDate();
        groupBy = 'DATE(completed_at)';
        labelFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        since = moment().subtract(8, 'weeks').toDate();
        groupBy = 'YEARWEEK(completed_at)';
        labelFormat = '%x-W%v';
        break;
      default: // monthly
        since = moment().subtract(6, 'months').toDate();
        groupBy = 'DATE_FORMAT(completed_at, \'%Y-%m\')';
        labelFormat = '%Y-%m';
        break;
    }

    const rows = await db.query(`
      SELECT 
        DATE_FORMAT(completed_at, :fmt) as period_label,
        COUNT(*) as jobs,
        SUM(total_amount) as earnings,
        AVG(rating) as avg_rating,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM bookings
      WHERE gardener_id = :uid
        AND completed_at >= :since
        AND status IN ('completed','cancelled')
      GROUP BY ${groupBy}
      ORDER BY period_label ASC
    `, {
      replacements: { fmt: labelFormat, uid: req.user.id, since },
      type: db.QueryTypes.SELECT
    });

    const totals = await db.query(`
      SELECT
        COUNT(*) as total_jobs,
        SUM(CASE WHEN status='completed' THEN total_amount ELSE 0 END) as total_earnings,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_jobs,
        AVG(CASE WHEN rating IS NOT NULL THEN rating END) as avg_rating
      FROM bookings
      WHERE gardener_id = :uid AND status IN ('completed','cancelled')
    `, { replacements: { uid: req.user.id }, type: db.QueryTypes.SELECT });

    res.json({ success: true, data: { period, breakdown: rows, totals: totals[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── SCHEDULED PRICE HIKES ─────────────────────────────────────────────────────
router.post('/admin/price-hike/schedule', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { PriceHikeSchedule } = require('../models');
    const schedule = await PriceHikeSchedule.create({ ...req.body, created_by: req.user.id });
    res.status(201).json({ success: true, data: schedule });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/admin/price-hike/schedules', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { PriceHikeSchedule } = require('../models');
    const { Op } = require('sequelize');
    const schedules = await PriceHikeSchedule.findAll({ order: [['scheduled_at', 'DESC']] });
    res.json({ success: true, data: schedules });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/admin/price-hike/schedule/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { PriceHikeSchedule } = require('../models');
    await PriceHikeSchedule.destroy({ where: { id: req.params.id, is_applied: false } });
    res.json({ success: true, message: 'Schedule deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── UTILIZATION REPORT ─────────────────────────────────────────────────────────
router.get('/admin/utilization', authenticate, authorize('admin'), adminCtrl.getUtilizationReport);

// ── COMPLAINTS ────────────────────────────────────────────────────────────────
const complaintCtrl = require('../controllers/complaint.controller');
router.post('/complaints', authenticate, authorize('customer'), complaintCtrl.raiseComplaint);
router.get('/complaints/my', authenticate, authorize('customer'), complaintCtrl.getMyComplaints);
router.get('/complaints/stats', authenticate, authorize('admin','supervisor'), complaintCtrl.getComplaintStats);
router.get('/complaints', authenticate, authorize('admin','supervisor'), complaintCtrl.getAllComplaints);
router.put('/complaints/:id', authenticate, authorize('admin','supervisor'), complaintCtrl.updateComplaint);

// ── SLA CONFIG & BREACHES ─────────────────────────────────────────────────────
router.get('/admin/sla/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { SLAConfig } = require('../models');
    const config = await SLAConfig.findOne({ where: { is_active: true } });
    res.json({ success: true, data: config || { max_arrival_delay_mins: 30, max_service_duration_hrs: 3, response_time_hrs: 24 } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/admin/sla/config', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { SLAConfig } = require('../models');
    let config = await SLAConfig.findOne({ where: { is_active: true } });
    if (config) await config.update({ ...req.body, updated_by: req.user.id });
    else config = await SLAConfig.create({ ...req.body, updated_by: req.user.id });
    res.json({ success: true, data: config });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/admin/sla/breaches', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { SLABreach, Booking: B, User: U } = require('../models');
    const { Op } = require('sequelize');
    const { is_resolved, breach_type, page = 1, limit = 20 } = req.query;
    const where = {};
    if (is_resolved !== undefined) where.is_resolved = is_resolved === 'true';
    if (breach_type) where.breach_type = breach_type;
    const { count, rows } = await SLABreach.findAndCountAll({
      where, order: [['detected_at', 'DESC']],
      include: [
        { model: B, as: 'booking', attributes: ['booking_number', 'scheduled_date', 'scheduled_time'] },
        { model: U, as: 'gardener', attributes: ['name', 'phone'] }
      ],
      limit: parseInt(limit), offset: (page - 1) * limit
    });
    res.json({ success: true, data: { breaches: rows, total: count } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/admin/sla/breaches/:id/resolve', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { SLABreach } = require('../models');
    await SLABreach.update({ is_resolved: true, resolved_at: new Date() }, { where: { id: req.params.id } });
    res.json({ success: true, message: 'Breach resolved' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADD-ON SERVICES ───────────────────────────────────────────────────────────
router.get('/addons', async (req, res) => {
  try {
    const { AddOnService } = require('../models');
    const addons = await AddOnService.findAll({ where: { is_active: true }, order: [['category','ASC'],['price','ASC']] });
    res.json({ success: true, data: addons });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/bookings/:id/addons', authenticate, authorize('customer'), async (req, res) => {
  try {
    const { addon_ids } = req.body; // array of { addon_id, quantity }
    const { AddOnService, BookingAddOn, Booking } = require('../models');
    const booking = await Booking.findOne({ where: { id: req.params.id, customer_id: req.user.id } });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (!['pending','assigned'].includes(booking.status)) return res.status(400).json({ success: false, message: 'Can only add services to pending/assigned bookings' });

    let addedTotal = 0;
    const created = [];
    for (const item of addon_ids) {
      const addon = await AddOnService.findByPk(item.addon_id);
      if (!addon) continue;
      const qty = item.quantity || 1;
      const linePrice = parseFloat(addon.price) * qty;
      addedTotal += linePrice;
      const ba = await BookingAddOn.create({ booking_id: booking.id, addon_id: addon.id, quantity: qty, price: linePrice });
      created.push({ ...ba.toJSON(), addon });
    }
    // Update booking total
    await booking.increment('total_amount', { by: addedTotal });
    res.json({ success: true, message: `${created.length} add-on(s) added. Extra: ₹${addedTotal}`, data: created });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/bookings/:id/addons', authenticate, async (req, res) => {
  try {
    const { BookingAddOn, AddOnService } = require('../models');
    const addons = await BookingAddOn.findAll({
      where: { booking_id: req.params.id },
      include: [{ model: AddOnService, as: 'addon' }]
    });
    res.json({ success: true, data: addons });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Admin: manage add-ons catalog
router.get('/admin/addons', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { AddOnService } = require('../models');
    const addons = await AddOnService.findAll({ order: [['category','ASC'],['name','ASC']] });
    res.json({ success: true, data: addons });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/admin/addons', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { AddOnService } = require('../models');
    const addon = await AddOnService.create(req.body);
    res.status(201).json({ success: true, data: addon });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/admin/addons/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { AddOnService } = require('../models');
    await AddOnService.update(req.body, { where: { id: req.params.id } });
    const addon = await AddOnService.findByPk(req.params.id);
    res.json({ success: true, data: addon });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GARDENER PROFILE (dedicated gardener routes) ──────────────────────────────
router.get('/gardener/profile', authenticate, authorize('gardener'), async (req, res) => {
  try {
    const { GardenerProfile, User, ServiceZone, GardenerZone } = require('../models');
    const user = await User.findByPk(req.user.id, { attributes: { exclude: ['password', 'otp', 'otp_expires_at'] } });
    const profile = await GardenerProfile.findOne({ where: { user_id: req.user.id } });
    const zones = await GardenerZone.findAll({
      where: { gardener_id: req.user.id },
      include: [{ model: ServiceZone, as: 'zone' }]
    });
    res.json({ success: true, data: { user, profile, zones } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/gardener/profile', authenticate, authorize('gardener'), async (req, res) => {
  try {
    const { GardenerProfile } = require('../models');
    const { bio, experience_years, bank_account, bank_ifsc, bank_name, id_proof_type, id_proof_number } = req.body;
    const updates = {};
    if (bio !== undefined) updates.bio = bio;
    if (experience_years !== undefined) updates.experience_years = experience_years;
    if (bank_account !== undefined) updates.bank_account = bank_account;
    if (bank_ifsc !== undefined) updates.bank_ifsc = bank_ifsc;
    if (bank_name !== undefined) updates.bank_name = bank_name;
    if (id_proof_type !== undefined) updates.id_proof_type = id_proof_type;
    if (id_proof_number !== undefined) updates.id_proof_number = id_proof_number;
    await GardenerProfile.update(updates, { where: { user_id: req.user.id } });
    const profile = await GardenerProfile.findOne({ where: { user_id: req.user.id } });
    res.json({ success: true, message: 'Profile updated', data: profile });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/gardener/availability', authenticate, authorize('gardener'), async (req, res) => {
  try {
    const { GardenerProfile } = require('../models');
    const { is_available } = req.body;
    if (typeof is_available !== 'boolean') return res.status(400).json({ success: false, message: 'is_available must be boolean' });
    await GardenerProfile.update({ is_available }, { where: { user_id: req.user.id } });
    res.json({ success: true, message: `Availability set to ${is_available}`, data: { is_available } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── SUBSCRIPTION PAUSE / RESUME ───────────────────────────────────────────────
router.patch('/subscriptions/:id/pause', authenticate, authorize('customer'), async (req, res) => {
  try {
    const { Subscription } = require('../models');
    const sub = await Subscription.findOne({ where: { id: req.params.id, customer_id: req.user.id, status: 'active' } });
    if (!sub) return res.status(404).json({ success: false, message: 'Active subscription not found' });
    await sub.update({ status: 'paused' });
    res.json({ success: true, message: 'Subscription paused', data: sub });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/subscriptions/:id/resume', authenticate, authorize('customer'), async (req, res) => {
  try {
    const { Subscription } = require('../models');
    const sub = await Subscription.findOne({ where: { id: req.params.id, customer_id: req.user.id, status: 'paused' } });
    if (!sub) return res.status(404).json({ success: false, message: 'Paused subscription not found' });
    await sub.update({ status: 'active' });
    res.json({ success: true, message: 'Subscription resumed', data: sub });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── NOTIFICATIONS MARK ALL READ ───────────────────────────────────────────────
router.put('/notifications/read-all', authenticate, async (req, res) => {
  try {
    const { Notification } = require('../models');
    await Notification.update({ is_read: true, read_at: new Date() }, { where: { user_id: req.user.id, is_read: false } });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN: SINGLE GARDENER DETAIL ─────────────────────────────────────────────
router.get('/admin/gardeners/:id', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { User, GardenerProfile, GardenerZone, ServiceZone, RewardPenalty, Booking } = require('../models');
    const { Op } = require('sequelize');
    const user = await User.findOne({
      where: { id: req.params.id, role: 'gardener' },
      attributes: { exclude: ['password', 'otp', 'otp_expires_at'] },
      include: [{ model: GardenerProfile, as: 'gardenerProfile' }]
    });
    if (!user) return res.status(404).json({ success: false, message: 'Gardener not found' });
    const zones = await GardenerZone.findAll({ where: { gardener_id: req.params.id }, include: [{ model: ServiceZone, as: 'zone' }] });
    const rewards = await RewardPenalty.findAll({ where: { gardener_id: req.params.id }, order: [['created_at', 'DESC']], limit: 10 });
    const recentJobs = await Booking.findAll({ where: { gardener_id: req.params.id }, order: [['created_at', 'DESC']], limit: 5, attributes: ['id', 'booking_number', 'status', 'scheduled_date', 'total_amount', 'rating'] });
    res.json({ success: true, data: { ...user.toJSON(), zones, recentRewards: rewards, recentJobs } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN: TOGGLE GARDENER ACTIVE STATUS ─────────────────────────────────────
router.patch('/admin/gardeners/:id/toggle', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { User } = require('../models');
    const user = await User.findOne({ where: { id: req.params.id, role: 'gardener' } });
    if (!user) return res.status(404).json({ success: false, message: 'Gardener not found' });
    await user.update({ is_active: !user.is_active });
    res.json({ success: true, message: `Gardener ${user.is_active ? 'activated' : 'deactivated'}`, data: { is_active: user.is_active } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN: GARDENER ZONE ASSIGNMENT ──────────────────────────────────────────
router.get('/admin/gardeners/:id/zones', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { GardenerZone, ServiceZone } = require('../models');
    const zones = await GardenerZone.findAll({ where: { gardener_id: req.params.id }, include: [{ model: ServiceZone, as: 'zone' }] });
    res.json({ success: true, data: zones });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/admin/gardeners/:id/zones', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { GardenerZone } = require('../models');
    const { zone_id } = req.body;
    const existing = await GardenerZone.findOne({ where: { gardener_id: req.params.id, zone_id } });
    if (existing) return res.status(400).json({ success: false, message: 'Zone already assigned' });
    const gz = await GardenerZone.create({ gardener_id: req.params.id, zone_id });
    res.status(201).json({ success: true, message: 'Zone assigned', data: gz });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/admin/gardeners/:id/zones/:zone_id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { GardenerZone } = require('../models');
    await GardenerZone.destroy({ where: { gardener_id: req.params.id, zone_id: req.params.zone_id } });
    res.json({ success: true, message: 'Zone removed from gardener' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN: PRICE HIKE LOGS ─────────────────────────────────────────────────────
router.get('/admin/price-hike/logs', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { PriceHikeLog, ServiceZone, ServicePlan, User } = require('../models');
    const { page = 1, limit = 20 } = req.query;
    const { count, rows } = await PriceHikeLog.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { logs: rows, total: count, page: parseInt(page) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── SUPERVISOR: TEAM GARDENERS ────────────────────────────────────────────────
router.get('/supervisor/gardeners', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { GardenerProfile, User } = require('../models');
    const supervisorId = req.user.role === 'admin' ? (req.query.supervisor_id || req.user.id) : req.user.id;
    const gardeners = await GardenerProfile.findAll({
      where: { supervisor_id: supervisorId },
      include: [{ model: User, as: 'user', attributes: { exclude: ['password', 'otp', 'otp_expires_at'] } }],
      order: [[{ model: User, as: 'user' }, 'name', 'ASC']]
    });
    res.json({ success: true, data: gardeners });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── SUPERVISOR: INDIVIDUAL GARDENER PERFORMANCE ───────────────────────────────
router.get('/supervisor/gardeners/:id/performance', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { GardenerProfile, Booking, RewardPenalty, User } = require('../models');
    const { Op } = require('sequelize');
    const moment = require('moment');
    const { period = '30' } = req.query;
    const since = moment().subtract(parseInt(period), 'days').toDate();

    const profile = await GardenerProfile.findOne({
      where: { user_id: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone', 'city'] }]
    });
    if (!profile) return res.status(404).json({ success: false, message: 'Gardener not found' });

    // Verify supervisor owns this gardener (skip for admin)
    if (req.user.role === 'supervisor' && profile.supervisor_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const [allJobs, completedJobs, cancelledJobs, rewards, penalties] = await Promise.all([
      Booking.count({ where: { gardener_id: req.params.id, created_at: { [Op.gte]: since } } }),
      Booking.count({ where: { gardener_id: req.params.id, status: 'completed', created_at: { [Op.gte]: since } } }),
      Booking.count({ where: { gardener_id: req.params.id, status: 'cancelled', created_at: { [Op.gte]: since } } }),
      RewardPenalty.sum('amount', { where: { gardener_id: req.params.id, type: 'reward', created_at: { [Op.gte]: since } } }),
      RewardPenalty.sum('amount', { where: { gardener_id: req.params.id, type: 'penalty', created_at: { [Op.gte]: since } } })
    ]);

    const completionRate = allJobs > 0 ? ((completedJobs / allJobs) * 100).toFixed(1) : 0;
    res.json({
      success: true,
      data: {
        gardener: { ...profile.user.toJSON(), profile: { rating: profile.rating, is_available: profile.is_available, total_jobs: profile.total_jobs, total_earnings: profile.total_earnings } },
        period_days: parseInt(period),
        stats: { allJobs, completedJobs, cancelledJobs, completionRate: parseFloat(completionRate), rewards: rewards || 0, penalties: penalties || 0, net: (rewards || 0) - (penalties || 0) }
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN: DELETE ADD-ON ───────────────────────────────────────────────────────
router.delete('/admin/addons/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { AddOnService } = require('../models');
    await AddOnService.update({ is_active: false }, { where: { id: req.params.id } });
    res.json({ success: true, message: 'Add-on deactivated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GARDENER: OWN REWARD/PENALTY HISTORY ─────────────────────────────────────
router.get('/gardener/rewards', authenticate, authorize('gardener'), async (req, res) => {
  try {
    const { RewardPenalty } = require('../models');
    const { type, page = 1, limit = 20 } = req.query;
    const where = { gardener_id: req.user.id };
    if (type) where.type = type;
    const { count, rows } = await RewardPenalty.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    const totalRewards = await RewardPenalty.sum('amount', { where: { gardener_id: req.user.id, type: 'reward' } }) || 0;
    const totalPenalties = await RewardPenalty.sum('amount', { where: { gardener_id: req.user.id, type: 'penalty' } }) || 0;
    res.json({ success: true, data: { items: rows, total: count, page: parseInt(page), summary: { totalRewards, totalPenalties, net: totalRewards - totalPenalties } } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN: MANUALLY REASSIGN GARDENER TO BOOKING ─────────────────────────────
router.patch('/admin/bookings/:id/reassign', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { Booking, User, GardenerProfile } = require('../models');
    const { gardener_id, reason } = req.body;
    if (!gardener_id) return res.status(400).json({ success: false, message: 'gardener_id is required' });

    const booking = await Booking.findByPk(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (['completed', 'cancelled', 'failed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Cannot reassign a closed booking' });
    }

    const gardener = await User.findOne({ where: { id: gardener_id, role: 'gardener', is_active: true, is_approved: true } });
    if (!gardener) return res.status(404).json({ success: false, message: 'Gardener not found or inactive' });

    const oldGardenerId = booking.gardener_id;
    await booking.update({ gardener_id, status: 'assigned', reassignment_reason: reason || 'Manual reassignment by admin' });

    // Notify new gardener via WhatsApp
    const { sendWhatsApp } = require('../services/otp.service');
    await sendWhatsApp(gardener.phone, `🌿 *GharKaMali*\nHello ${gardener.name}, a booking (${booking.booking_number}) has been assigned to you for ${booking.scheduled_date} at ${booking.scheduled_time || 'morning'}. Please check your app.`);

    res.json({ success: true, message: `Booking reassigned to ${gardener.name}`, data: { booking_id: booking.id, old_gardener_id: oldGardenerId, new_gardener_id: gardener_id } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN: SINGLE CUSTOMER DETAIL ─────────────────────────────────────────────
router.get('/admin/customers/:id', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { User, Booking, Subscription, ServicePlan, Payment } = require('../models');
    const { Op } = require('sequelize');

    const customer = await User.findOne({
      where: { id: req.params.id, role: 'customer' },
      attributes: { exclude: ['password', 'otp', 'otp_expires_at'] }
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const [bookings, subscriptions, payments, stats] = await Promise.all([
      Booking.findAll({
        where: { customer_id: req.params.id },
        order: [['created_at', 'DESC']],
        limit: 10,
        attributes: ['id', 'booking_number', 'status', 'scheduled_date', 'total_amount', 'rating', 'created_at']
      }),
      Subscription.findAll({
        where: { customer_id: req.params.id },
        include: [{ model: ServicePlan, as: 'plan', attributes: ['name', 'duration_days'] }],
        order: [['created_at', 'DESC']]
      }),
      Payment.findAll({
        where: { user_id: req.params.id },
        order: [['created_at', 'DESC']],
        limit: 10,
        attributes: ['id', 'txn_id', 'amount', 'status', 'payment_for', 'created_at']
      }),
      Booking.findAll({
        where: { customer_id: req.params.id },
        attributes: [
          [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'total_bookings'],
          [require('sequelize').fn('SUM', require('sequelize').col('total_amount')), 'total_spent'],
          [require('sequelize').fn('AVG', require('sequelize').col('rating')), 'avg_rating']
        ],
        raw: true
      })
    ]);

    res.json({
      success: true,
      data: {
        customer,
        recentBookings: bookings,
        subscriptions,
        recentPayments: payments,
        stats: stats[0] || { total_bookings: 0, total_spent: 0, avg_rating: null }
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
