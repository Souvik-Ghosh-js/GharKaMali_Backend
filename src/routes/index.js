const express = require('express');
const router = express.Router();
const { authenticate, authenticateOptional, authorize } = require('../middleware/auth');
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
router.get('/bookings/previous-gardeners', authenticate, authorize('customer'), bookingCtrl.getPreviousGardeners);
router.get('/bookings/check-availability', bookingCtrl.checkAvailability);
router.get('/bookings/:id', authenticate, bookingCtrl.getBookingDetail);
router.get('/bookings/:id/logs', authenticate, bookingCtrl.getBookingLogs);
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

// ── CONTACT ───────────────────────────────────────────────────────────────────
router.post('/contact', async (req, res) => {
  try {
    const { name, phone, email, message } = req.body;
    const { ContactMessage } = require('../models');
    const contact = await ContactMessage.create({ name, email, phone, message });
    res.status(201).json({ success: true, data: contact, message: 'Message received successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PLANTOPEDIA ───────────────────────────────────────────────────────────────
router.post('/plants/identify', authenticate, uploadPlant.single('image'), contentCtrl.identifyPlant);
router.get('/plants/history', authenticate, contentCtrl.getMyPlantHistory);

// ── BLOGS ─────────────────────────────────────────────────────────────────────
router.get('/blogs', contentCtrl.getBlogs);
router.get('/blogs/categories', contentCtrl.getBlogCategories);
router.get('/blogs/:slug', contentCtrl.getBlogBySlug);

// ── CITY PAGES ────────────────────────────────────────────────────────────────
router.get('/cities', contentCtrl.getCityPages);
router.get('/cities/:slug', contentCtrl.getCityPage);

// ── PRIVACY POLICY ────────────────────────────────────────────────────────────
router.get('/privacy-policy', contentCtrl.getPrivacyPolicy);

// ── SHOP / MARKETPLACE ────────────────────────────────────────────────────────
router.get('/shop/categories', authenticateOptional, shopCtrl.getCategories);
router.get('/shop/products', authenticateOptional, shopCtrl.getProducts);
router.get('/shop/products/:id', authenticateOptional, shopCtrl.getProductDetail);
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
router.put('/admin/supervisors/:id', authenticate, authorize('admin'), adminCtrl.updateSupervisor);

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

// ── ADMIN GARDENER ZONE ASSIGNMENT ────────────────────────────────────────────
router.post('/admin/gardeners/:id/zones', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { GardenerZone } = require('../models');
    const { zone_ids } = req.body;
    await GardenerZone.destroy({ where: { gardener_id: req.params.id } });
    for (const zid of zone_ids || []) {
      await GardenerZone.create({ gardener_id: req.params.id, zone_id: zid });
    }
    res.json({ success: true, message: 'Zones assigned' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── ADMIN GLOBAL SEARCH ───────────────────────────────────────────────────────
router.get('/admin/search', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: { users: [], bookings: [] } });
    const { User, Booking } = require('../models');
    const { Op } = require('sequelize');
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.like]: `%${q}%` } },
          { phone: { [Op.like]: `%${q}%` } },
          { email: { [Op.like]: `%${q}%` } }
        ]
      },
      limit: 10
    });
    const bookings = await Booking.findAll({
      where: { booking_number: { [Op.like]: `%${q}%` } },
      limit: 10
    });
    res.json({ success: true, data: { users, bookings } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── ADMIN TAGS ───────────────────────────────────────────────────────────────
router.get('/admin/tags', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { Tag } = require('../models');
    const tags = await Tag.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: tags });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/admin/tags', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { Tag } = require('../models');
    const tag = await Tag.create(req.body);
    res.status(201).json({ success: true, data: tag });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/admin/tags/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { Tag } = require('../models');
    await Tag.update(req.body, { where: { id: req.params.id } });
    const tag = await Tag.findByPk(req.params.id);
    res.json({ success: true, data: tag });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/admin/tags/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { Tag } = require('../models');
    await Tag.destroy({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Tag deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── ADMIN CONTACTS ───────────────────────────────────────────────────────────
router.get('/admin/contacts', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { ContactMessage } = require('../models');
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const { count, rows } = await ContactMessage.findAndCountAll({
      limit: parseInt(limit),
      offset,
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: rows, pagination: { total: count, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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

// ─── FAQS ────────────────────────────────────────────────────────────────────
router.get('/faqs', adminCtrl.getPublicFaqs);
router.get('/admin/faqs', authenticate, authorize('admin'), adminCtrl.getAdminFaqs);
router.post('/admin/faqs', authenticate, authorize('admin'), adminCtrl.createFaq);
router.put('/admin/faqs/:id', authenticate, authorize('admin'), adminCtrl.updateFaq);
router.delete('/admin/faqs/:id', authenticate, authorize('admin'), adminCtrl.deleteFaq);
router.get('/admin/taglines', authenticate, authorize('admin'), taglineCtrl.getAdminTaglines);
router.post('/admin/taglines', authenticate, authorize('admin'), uploadShop.single('image'), taglineCtrl.createTagline);
router.put('/admin/taglines/:id', authenticate, authorize('admin'), uploadShop.single('image'), taglineCtrl.updateTagline);
router.delete('/admin/taglines/:id', authenticate, authorize('admin'), taglineCtrl.deleteTagline);


router.get('/admin/maintenance/sync-db', async (req, res) => {
  if (req.query.key !== 'gharkamali') return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    const { sequelize } = require('../models');
    
    // Fix zero dates in key tables that might block sync
    const tables = ['users', 'products', 'orders', 'payments', 'bookings', 'geofences'];
    for (const table of tables) {
      try {
        await sequelize.query(`UPDATE ${table} SET created_at = NOW() WHERE CAST(created_at AS CHAR) = '0000-00-00 00:00:00' OR created_at IS NULL`);
        await sequelize.query(`UPDATE ${table} SET updated_at = NOW() WHERE CAST(updated_at AS CHAR) = '0000-00-00 00:00:00' OR updated_at IS NULL`);
      } catch (e) {
        console.log(`Failed to fix dates for ${table}:`, e.message);
      }
    }
    
    // Explicitly add missing columns in case sync(alter: true) fails due to constraints or versioning
    try { await sequelize.query("ALTER TABLE geofences ADD COLUMN surge_multiplier DECIMAL(4, 2) DEFAULT 1.00"); } catch(e){}
    try { await sequelize.query("ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100)"); } catch(e){}
    try { await sequelize.query("ALTER TABLE orders ADD COLUMN tracking_url VARCHAR(500)"); } catch(e){}

    await sequelize.sync({ alter: true });
    res.json({ success: true, message: 'Database schema synchronized successfully and legacy dates fixed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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
    await booking.update({ gardener_id, status: 'assigned', assigned_at: new Date(), reassignment_reason: reason || 'Manual reassignment by admin' });

    // Notify gardeners via Push & WhatsApp
    const { sendWhatsApp } = require('../services/otp.service');
    const { notify } = require('../services/push.service');
    
    // Notify new gardener
    await sendWhatsApp(gardener.phone, `🌿 *GharKaMali*\nHello ${gardener.name}, a booking (${booking.booking_number}) has been assigned to you for ${booking.scheduled_date} at ${booking.scheduled_time || 'morning'}. Please check your app.`);
    if (gardener.fcm_token) {
      await notify.newJobAssigned(gardener.fcm_token, booking.booking_number, booking.service_address, booking.scheduled_date);
    }

    // Notify old gardener if reassigned away
    if (oldGardenerId && oldGardenerId !== gardener_id) {
      const oldG = await User.findByPk(oldGardenerId);
      if (oldG?.fcm_token) {
        await notify.jobCancelled(oldG.fcm_token, booking.booking_number, 'Job has been reassigned to another gardener.');
      }
    }

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

// ── BOOKING LOGS TIMELINE ─────────────────────────────────────────────────────
router.get('/admin/bookings/:id/logs', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { BookingLog, User } = require('../models');
    const logs = await BookingLog.findAll({
      where: { booking_id: req.params.id },
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'role'] }],
      order: [['created_at', 'ASC']]
    });
    res.json({ success: true, data: logs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── TIP FEATURE ───────────────────────────────────────────────────────────────
router.post('/bookings/:id/tip', authenticate, authorize('customer'), async (req, res) => {
  try {
    const { Tip, Booking, GardenerProfile, User } = require('../models');
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Tip amount must be positive' });

    const booking = await Booking.findOne({ where: { id: req.params.id, customer_id: req.user.id, status: 'completed' } });
    if (!booking) return res.status(404).json({ success: false, message: 'Completed booking not found' });
    if (!booking.gardener_id) return res.status(400).json({ success: false, message: 'No gardener assigned to this booking' });

    // Check wallet balance
    const customer = await User.findByPk(req.user.id);
    if (parseFloat(customer.wallet_balance) < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance for tip' });
    }

    const tip = await Tip.create({
      booking_id: booking.id,
      customer_id: req.user.id,
      gardener_id: booking.gardener_id,
      amount
    });

    // Deduct from customer wallet
    await User.decrement({ wallet_balance: amount }, { where: { id: req.user.id } });
    // Credit to gardener earnings
    await GardenerProfile.increment({ total_earnings: amount }, { where: { user_id: booking.gardener_id } });

    res.json({ success: true, message: `Tip of ₹${amount} sent to gardener`, data: tip });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GARDENER WITHDRAWAL ───────────────────────────────────────────────────────
router.post('/gardener/withdraw', authenticate, authorize('gardener'), async (req, res) => {
  try {
    const { WithdrawalRequest, GardenerProfile } = require('../models');
    const { amount } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ success: false, message: 'Minimum withdrawal is ₹100' });

    const profile = await GardenerProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

    if (parseFloat(profile.total_earnings) - parseFloat(profile.pending_earnings || 0) < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient available earnings' });
    }

    const request = await WithdrawalRequest.create({
      gardener_id: req.user.id,
      amount,
      bank_account: profile.bank_account,
      bank_ifsc: profile.bank_ifsc,
      bank_name: profile.bank_name
    });

    // Mark earnings as pending
    await GardenerProfile.increment({ pending_earnings: amount }, { where: { user_id: req.user.id } });

    res.status(201).json({ success: true, message: 'Withdrawal request submitted', data: request });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/gardener/withdrawals', authenticate, authorize('gardener'), async (req, res) => {
  try {
    const { WithdrawalRequest } = require('../models');
    const requests = await WithdrawalRequest.findAll({
      where: { gardener_id: req.user.id },
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: requests });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/admin/withdrawals', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { WithdrawalRequest, User } = require('../models');
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    const { count, rows } = await WithdrawalRequest.findAndCountAll({
      where,
      include: [
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone', 'city'] },
        { model: User, as: 'processor', attributes: ['id', 'name'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit), offset: (page - 1) * limit
    });
    res.json({ success: true, data: { requests: rows, total: count } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/admin/withdrawals/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { WithdrawalRequest, GardenerProfile } = require('../models');
    const { status, admin_notes } = req.body;
    const request = await WithdrawalRequest.findByPk(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'Request already processed' });

    const updates = { status, admin_notes, processed_by: req.user.id };
    if (status === 'processed') {
      updates.processed_at = new Date();
      // Deduct from total earnings and pending earnings
      await GardenerProfile.decrement({ total_earnings: request.amount, pending_earnings: request.amount }, { where: { user_id: request.gardener_id } });
    } else if (status === 'rejected') {
      // Release pending earnings
      await GardenerProfile.decrement({ pending_earnings: request.amount }, { where: { user_id: request.gardener_id } });
    }

    await request.update(updates);
    res.json({ success: true, message: `Withdrawal ${status}`, data: request });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── REVIEWS MANAGEMENT ────────────────────────────────────────────────────────
router.get('/reviews', async (req, res) => {
  try {
    const { Review, User } = require('../models');
    const { status = 'approved', page = 1, limit = 20 } = req.query;
    const { count, rows } = await Review.findAndCountAll({
      where: { status },
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'city', 'profile_image'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit), offset: (page - 1) * limit
    });
    res.json({ success: true, data: { reviews: rows, total: count } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/bookings/:id/review', authenticate, authorize('customer'), async (req, res) => {
  try {
    const { Review, Booking } = require('../models');
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });

    const booking = await Booking.findOne({ where: { id: req.params.id, customer_id: req.user.id, status: 'completed' } });
    if (!booking) return res.status(404).json({ success: false, message: 'Completed booking not found' });

    const existing = await Review.findOne({ where: { booking_id: booking.id, customer_id: req.user.id } });
    if (existing) return res.status(400).json({ success: false, message: 'Review already submitted for this booking' });

    const review = await Review.create({
      customer_id: req.user.id,
      booking_id: booking.id,
      gardener_id: booking.gardener_id,
      rating,
      comment
    });
    res.status(201).json({ success: true, message: 'Review submitted for approval', data: review });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/admin/reviews', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { Review, User, Booking } = require('../models');
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    const { count, rows } = await Review.findAndCountAll({
      where,
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'city'] },
        { model: User, as: 'gardener', attributes: ['id', 'name'] },
        { model: Booking, as: 'booking', attributes: ['id', 'booking_number'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit), offset: (page - 1) * limit
    });
    res.json({ success: true, data: { reviews: rows, total: count } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/admin/reviews/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { Review } = require('../models');
    const { status, admin_notes } = req.body;
    await Review.update({ status, admin_notes }, { where: { id: req.params.id } });
    const review = await Review.findByPk(req.params.id);
    res.json({ success: true, message: `Review ${status}`, data: review });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN GLOBAL SEARCH ───────────────────────────────────────────────────────
router.get('/admin/search', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { User, Booking, Order } = require('../models');
    const { Op } = require('sequelize');
    const { q } = req.query;
    if (!q || q.length < 2) return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters' });

    const searchTerm = `%${q}%`;
    const [customers, gardeners, bookings, orders] = await Promise.all([
      User.findAll({ where: { role: 'customer', [Op.or]: [{ name: { [Op.like]: searchTerm } }, { phone: { [Op.like]: searchTerm } }, { email: { [Op.like]: searchTerm } }] }, attributes: ['id', 'name', 'phone', 'city'], limit: 5 }),
      User.findAll({ where: { role: 'gardener', [Op.or]: [{ name: { [Op.like]: searchTerm } }, { phone: { [Op.like]: searchTerm } }] }, attributes: ['id', 'name', 'phone', 'city'], limit: 5 }),
      Booking.findAll({ where: { [Op.or]: [{ booking_number: { [Op.like]: searchTerm } }] }, attributes: ['id', 'booking_number', 'status', 'scheduled_date'], limit: 5 }),
      Order.findAll({ where: { [Op.or]: [{ order_number: { [Op.like]: searchTerm } }] }, attributes: ['id', 'order_number', 'status', 'total_amount'], limit: 5 })
    ]);

    res.json({
      success: true,
      data: { customers, gardeners, bookings, orders, total: customers.length + gardeners.length + bookings.length + orders.length }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ADMIN EXPORT REPORTS (CSV) ────────────────────────────────────────────────
router.get('/admin/reports/export', authenticate, authorize('admin'), async (req, res) => {
  try {
    const db = require('../config/database');
    const { type = 'bookings', format = 'csv' } = req.query;

    let query = '';
    let filename = '';
    switch (type) {
      case 'bookings':
        query = `SELECT b.id, b.booking_number, b.status, b.scheduled_date, b.scheduled_time,
          b.total_amount, b.payment_status, b.plant_count, b.service_address,
          c.name as customer_name, c.phone as customer_phone,
          g.name as gardener_name, b.created_at, b.completed_at
          FROM bookings b
          LEFT JOIN users c ON b.customer_id = c.id
          LEFT JOIN users g ON b.gardener_id = g.id
          ORDER BY b.created_at DESC`;
        filename = 'bookings_report';
        break;
      case 'orders':
        query = `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount,
          o.shipping_address, o.shipping_city, o.tracking_number,
          u.name as customer_name, u.phone as customer_phone, o.created_at
          FROM orders o LEFT JOIN users u ON o.customer_id = u.id
          ORDER BY o.created_at DESC`;
        filename = 'orders_report';
        break;
      case 'earnings':
        query = `SELECT u.id, u.name, u.phone, u.city,
          gp.total_earnings, gp.pending_earnings, gp.completed_jobs, gp.total_jobs, gp.rating
          FROM users u JOIN gardener_profiles gp ON u.id = gp.user_id
          WHERE u.role='gardener' ORDER BY gp.total_earnings DESC`;
        filename = 'gardener_earnings';
        break;
      case 'customers':
        query = `SELECT id, name, phone, email, city, state, wallet_balance, total_spent, created_at
          FROM users WHERE role='customer' ORDER BY created_at DESC`;
        filename = 'customers_report';
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid report type. Use: bookings, orders, earnings, customers' });
    }

    const rows = await db.query(query, { type: db.QueryTypes.SELECT });
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'No data found' });

    // Generate CSV
    const headers = Object.keys(rows[0]);
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push(headers.map(h => {
        const val = row[h] !== null && row[h] !== undefined ? String(row[h]).replace(/"/g, '""') : '';
        return `"${val}"`;
      }).join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvLines.join('\n'));
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── SOCIAL PROOF ──────────────────────────────────────────────────────────────
router.get('/social-proof', async (req, res) => {
  try {
    const { SystemSetting } = require('../models');
    const db = require('../config/database');

    // Check if social proof is enabled
    const setting = await SystemSetting.findOne({ where: { key: 'social_proof_enabled' } });
    if (setting && setting.value === 'false') {
      return res.json({ success: true, data: { enabled: false, items: [] } });
    }

    // Get config settings
    const [intervalSetting, delaySetting, durationSetting, maxItemsSetting, bookingTemplateSetting, visitorTemplateSetting] = await Promise.all([
      SystemSetting.findOne({ where: { key: 'social_proof_interval' } }),
      SystemSetting.findOne({ where: { key: 'social_proof_delay' } }),
      SystemSetting.findOne({ where: { key: 'social_proof_duration' } }),
      SystemSetting.findOne({ where: { key: 'social_proof_max_items' } }),
      SystemSetting.findOne({ where: { key: 'social_proof_booking_template' } }),
      SystemSetting.findOne({ where: { key: 'social_proof_visitor_template' } }),
    ]);

    const interval = intervalSetting ? parseInt(intervalSetting.value) || 8000 : 8000;
    const delay = delaySetting ? parseInt(delaySetting.value) || 5000 : 5000;
    const duration = durationSetting ? parseInt(durationSetting.value) || 5000 : 5000;
    const maxItems = maxItemsSetting ? parseInt(maxItemsSetting.value) || 10 : 10;
    const bookingTemplate = bookingTemplateSetting ? bookingTemplateSetting.value : '{name} from {city} just booked {service}';
    const visitorTemplate = visitorTemplateSetting ? visitorTemplateSetting.value : '10+ people are viewing this page right now';

    // Fetch recent bookings
    const rows = await db.query(`
      SELECT 
        SUBSTRING_INDEX(u.name, ' ', 1) as first_name,
        u.city,
        COALESCE(sp.name, 'Gardening Visit') as service,
        b.status,
        b.created_at,
        TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) as mins_ago,
        TIMESTAMPDIFF(HOUR, b.created_at, NOW()) as hours_ago
      FROM bookings b
      JOIN users u ON b.customer_id = u.id
      LEFT JOIN subscriptions sub ON b.subscription_id = sub.id
      LEFT JOIN service_plans sp ON sub.plan_id = sp.id
      WHERE b.status IN ('completed','assigned','in_progress','en_route')
        AND u.city IS NOT NULL AND u.city != ''
        AND b.created_at >= DATE_SUB(NOW(), INTERVAL 72 HOUR)
      ORDER BY b.created_at DESC
      LIMIT :limit
    `, { 
      replacements: { limit: maxItems },
      type: db.QueryTypes.SELECT 
    });

    const items = rows.map(r => {
      let timeAgo;
      if (r.mins_ago < 2) timeAgo = 'just now';
      else if (r.mins_ago < 60) timeAgo = `${r.mins_ago}m ago`;
      else if (r.hours_ago < 24) timeAgo = `${r.hours_ago}h ago`;
      else timeAgo = 'yesterday';

      // Format message
      let message = bookingTemplate
        .replace('{name}', r.first_name || 'Someone')
        .replace('{city}', r.city)
        .replace('{service}', r.service)
        .replace('{time}', timeAgo);

      return {
        type: 'booking',
        message,
        time_ago: timeAgo,
        data: {
          name: r.first_name,
          city: r.city,
          service: r.service
        }
      };
    });

    // Add visitor count notification if template is set
    if (visitorTemplate && visitorTemplate.trim() !== '') {
      items.push({
        type: 'visitor',
        message: visitorTemplate,
        time_ago: 'live'
      });
    }

    res.json({ 
      success: true, 
      data: { 
        enabled: true, 
        interval, 
        delay, 
        duration, 
        items: items.sort(() => Math.random() - 0.5) // Randomize order for variety
      } 
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── CONTACT FORM ──────────────────────────────────────────────────────────────
router.post('/contact', async (req, res) => {
  try {
    const { ContactMessage } = require('../models');
    const { name, email, phone, message } = req.body;
    if (!name || !message) return res.status(400).json({ success: false, message: 'Name and message are required' });
    const msg = await ContactMessage.create({ name, email, phone, message });
    res.status(201).json({ success: true, message: 'Message received! We will get back to you soon.', data: { id: msg.id } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/admin/contacts', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { ContactMessage } = require('../models');
    const { page = 1, limit = 20 } = req.query;
    const { count, rows } = await ContactMessage.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit: parseInt(limit), offset: (page - 1) * limit
    });
    res.json({ success: true, data: { messages: rows, total: count } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── SYSTEM SETTINGS ───────────────────────────────────────────────────────────
router.get('/settings/:key', async (req, res) => {
  try {
    const { SystemSetting } = require('../models');
    const setting = await SystemSetting.findOne({ where: { key: req.params.key } });
    res.json({ success: true, data: setting ? setting.value : null });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/admin/settings', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { SystemSetting } = require('../models');
    const settings = await SystemSetting.findAll({ order: [['key', 'ASC']] });
    res.json({ success: true, data: settings });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/admin/settings/:key', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { SystemSetting } = require('../models');
    const { value } = req.body;
    const [setting, created] = await SystemSetting.findOrCreate({
      where: { key: req.params.key },
      defaults: { value, updated_by: req.user.id }
    });
    if (!created) await setting.update({ value, updated_by: req.user.id });
    res.json({ success: true, message: `Setting '${req.params.key}' updated`, data: setting });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── SHOP ORDER TRACKING ENHANCEMENT ──────────────────────────────────────────
router.put('/admin/shop/orders/:id/tracking', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { Order } = require('../models');
    const { tracking_number, tracking_url, status } = req.body;
    const updates = {};
    if (tracking_number !== undefined) updates.tracking_number = tracking_number;
    if (tracking_url !== undefined) updates.tracking_url = tracking_url;
    if (status) updates.status = status;
    await Order.update(updates, { where: { id: req.params.id } });
    const order = await Order.findByPk(req.params.id);
    res.json({ success: true, message: 'Order tracking updated', data: order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── LOCATION-BASED PRODUCT AVAILABILITY ──────────────────────────────────────
router.get('/admin/product-zone-prices', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { ProductZonePrice, Product, Geofence } = require('../models');
    const prices = await ProductZonePrice.findAll({
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name', 'price'] },
        { model: Geofence, as: 'zone', attributes: ['id', 'name', 'city'] }
      ],
      order: [['product_id', 'ASC'], ['geofence_id', 'ASC']]
    });
    res.json({ success: true, data: prices });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/admin/product-zone-prices', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { ProductZonePrice } = require('../models');
    const { product_id, geofence_id, price, mrp, is_available } = req.body;
    const [pzp, created] = await ProductZonePrice.findOrCreate({
      where: { product_id, geofence_id },
      defaults: { price, mrp, is_available: is_available !== false }
    });
    if (!created) await pzp.update({ price, mrp, is_available: is_available !== false });
    res.json({ success: true, data: pzp });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/admin/product-zone-prices/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { ProductZonePrice } = require('../models');
    await ProductZonePrice.destroy({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Zone price removed' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── SUPERVISOR-GARDENER ASSIGNMENT ───────────────────────────────────────────
router.post('/admin/supervisors/:id/gardeners', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { GardenerProfile, User } = require('../models');
    const { gardener_ids } = req.body; // Array of gardener user IDs to assign
    if (!Array.isArray(gardener_ids)) return res.status(400).json({ success: false, message: 'gardener_ids must be an array' });

    // Verify supervisor exists
    const supervisor = await User.findOne({ where: { id: req.params.id, role: 'supervisor' } });
    if (!supervisor) return res.status(404).json({ success: false, message: 'Supervisor not found' });

    const { Op } = require('sequelize');
    // Assign gardeners to this supervisor
    await GardenerProfile.update({ supervisor_id: parseInt(req.params.id) }, { where: { user_id: { [Op.in]: gardener_ids } } });

    res.json({ success: true, message: `${gardener_ids.length} gardener(s) assigned to ${supervisor.name}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/admin/supervisors/:id/gardeners/:gardener_id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { GardenerProfile } = require('../models');
    await GardenerProfile.update({ supervisor_id: null }, { where: { user_id: req.params.gardener_id, supervisor_id: req.params.id } });
    res.json({ success: true, message: 'Gardener removed from supervisor' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
