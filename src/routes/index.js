const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { uploadProfile, uploadWorkProof, uploadPlant, uploadBlog, uploadIdProof } = require('../middleware/upload');
const authCtrl = require('../controllers/auth.controller');
const bookingCtrl = require('../controllers/booking.controller');
const subscriptionCtrl = require('../controllers/subscription.controller');
const adminCtrl = require('../controllers/admin.controller');
const contentCtrl = require('../controllers/content.controller');

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

// ── PLANTOPEDIA ───────────────────────────────────────────────────────────────
router.post('/plants/identify', authenticate, uploadPlant.single('image'), contentCtrl.identifyPlant);
router.get('/plants/history', authenticate, contentCtrl.getMyPlantHistory);

// ── BLOGS ─────────────────────────────────────────────────────────────────────
router.get('/blogs', contentCtrl.getBlogs);
router.get('/blogs/:slug', contentCtrl.getBlogBySlug);

// ── CITY PAGES ────────────────────────────────────────────────────────────────
router.get('/cities', contentCtrl.getCityPages);
router.get('/cities/:slug', contentCtrl.getCityPage);

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
router.post('/admin/gardeners/approve', authenticate, authorize('admin'), adminCtrl.approveGardener);
router.post('/admin/gardeners/reject', authenticate, authorize('admin'), adminCtrl.rejectGardener);

router.get('/admin/supervisors', authenticate, authorize('admin'), adminCtrl.getSupervisors);
router.post('/admin/supervisors', authenticate, authorize('admin'), adminCtrl.createSupervisor);

router.get('/admin/zones', authenticate, authorize('admin'), adminCtrl.getZones);
router.post('/admin/zones', authenticate, authorize('admin'), adminCtrl.createZone);
router.put('/admin/zones/:id', authenticate, authorize('admin'), adminCtrl.updateZone);

router.get('/admin/plans', authenticate, authorize('admin'), subscriptionCtrl.getPlans);
router.post('/admin/plans', authenticate, authorize('admin'), adminCtrl.createPlan);
router.put('/admin/plans/:id', authenticate, authorize('admin'), adminCtrl.updatePlan);

router.get('/admin/bookings', authenticate, authorize('admin', 'supervisor'), adminCtrl.getAllBookings);
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
    const { SLABreach } = require('../models');
    const { Op } = require('sequelize');
    const { is_resolved, breach_type, page = 1, limit = 20 } = req.query;
    const where = {};
    if (is_resolved !== undefined) where.is_resolved = is_resolved === 'true';
    if (breach_type) where.breach_type = breach_type;
    const { count, rows } = await SLABreach.findAndCountAll({
      where, order: [['detected_at', 'DESC']],
      include: [
        { model: Booking, as: 'booking', attributes: ['booking_number', 'scheduled_date', 'scheduled_time'] },
        { model: User, as: 'gardener', attributes: ['name', 'phone'] }
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
    const { AddOnService, BookingAddOn } = require('../models');
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
