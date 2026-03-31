const bcrypt = require('bcryptjs');
const { Op, fn, col, literal, sequelize } = require('sequelize');
const db = require('../config/database');
const { User, GardenerProfile, ServiceZone, ServicePlan, Booking, Subscription, RewardPenalty, Blog, CityPage, Payment, PriceHikeLog, Product, ProductCategory, Order, OrderItem } = require('../models');
const { sendWhatsApp, templates } = require('../services/otp.service');

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const [
      totalCustomers, totalGardeners, totalSupervisors,
      activeSubscriptions, pendingGardeners,
      todayBookings, completedToday, pendingBookings,
      totalRevenue, recentBookings
    ] = await Promise.all([
      User.count({ where: { role: 'customer', is_active: true } }),
      User.count({ where: { role: 'gardener', is_active: true, is_approved: true } }),
      User.count({ where: { role: 'supervisor', is_active: true } }),
      Subscription.count({ where: { status: 'active' } }),
      User.count({ where: { role: 'gardener', is_approved: false } }),
      Booking.count({ where: { scheduled_date: new Date().toISOString().split('T')[0] } }),
      Booking.count({ where: { status: 'completed', completed_at: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
      Booking.count({ where: { status: { [Op.in]: ['pending', 'assigned'] } } }),
      Booking.sum('total_amount', { where: { status: 'completed' } }),
      Booking.findAll({
        limit: 5,
        order: [['created_at', 'DESC']],
        include: [
          { model: User, as: 'customer', attributes: ['name', 'phone'] },
          { model: User, as: 'gardener', attributes: ['name', 'phone'] }
        ]
      })
    ]);

    res.json({
      success: true, data: {
        stats: { totalCustomers, totalGardeners, totalSupervisors, activeSubscriptions, pendingGardeners, todayBookings, completedToday, pendingBookings, totalRevenue: totalRevenue || 0 },
        recentBookings
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
exports.getAnalytics = async (req, res) => {
  try {
    const { period = '30', zone_id } = req.query;
    const days = parseInt(period);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const bookingWhere = { created_at: { [Op.gte]: since } };
    if (zone_id) bookingWhere.zone_id = zone_id;

    // Revenue by day (with booking count)
    const revenueByDay = await db.query(`
      SELECT DATE(created_at) as date, SUM(total_amount) as revenue, COUNT(*) as bookings
      FROM bookings WHERE status='completed' AND created_at >= :since ${zone_id ? 'AND zone_id = :zone_id' : ''}
      GROUP BY DATE(created_at) ORDER BY date ASC
    `, { replacements: { since, zone_id }, type: db.QueryTypes.SELECT });

    // Bookings by day (all statuses, for volume chart)
    const bookingsByDay = await db.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM bookings WHERE created_at >= :since ${zone_id ? 'AND zone_id = :zone_id' : ''}
      GROUP BY DATE(created_at) ORDER BY date ASC
    `, { replacements: { since, zone_id }, type: db.QueryTypes.SELECT });

    // Bookings by zone
    const bookingsByZone = await db.query(`
      SELECT sz.name as zone, sz.city, COUNT(b.id) as total, SUM(b.total_amount) as revenue
      FROM bookings b LEFT JOIN service_zones sz ON b.zone_id = sz.id
      WHERE b.created_at >= :since GROUP BY b.zone_id ORDER BY total DESC
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // Bookings by city
    const bookingsByCity = await db.query(`
      SELECT sz.city, COUNT(b.id) as total, SUM(b.total_amount) as revenue
      FROM bookings b LEFT JOIN service_zones sz ON b.zone_id = sz.id
      WHERE b.created_at >= :since GROUP BY sz.city ORDER BY total DESC
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // Customer locations
    const customerLocations = await db.query(`
      SELECT u.city, u.state, COUNT(*) as count FROM users u
      WHERE u.role='customer' AND u.city IS NOT NULL GROUP BY u.city, u.state ORDER BY count DESC LIMIT 20
    `, { type: db.QueryTypes.SELECT });

    // Booking status distribution
    const bookingStatusDist = await db.query(`
      SELECT status, COUNT(*) as count FROM bookings WHERE created_at >= :since GROUP BY status
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // Subscription plan distribution
    const planDist = await db.query(`
      SELECT sp.name, COUNT(s.id) as count, SUM(s.amount_paid) as revenue
      FROM subscriptions s LEFT JOIN service_plans sp ON s.plan_id = sp.id
      WHERE s.created_at >= :since GROUP BY s.plan_id ORDER BY count DESC
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // Top gardeners
    const topGardeners = await db.query(`
      SELECT u.name, gp.rating, gp.completed_jobs, gp.total_earnings
      FROM users u JOIN gardener_profiles gp ON u.id = gp.user_id
      ORDER BY gp.completed_jobs DESC LIMIT 10
    `, { type: db.QueryTypes.SELECT });

    // New users trend
    const newUsersTrend = await db.query(`
      SELECT DATE(created_at) as date, role, COUNT(*) as count
      FROM users WHERE created_at >= :since GROUP BY DATE(created_at), role ORDER BY date ASC
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // Repeat customers
    const repeatCustomers = await db.query(`
      SELECT COUNT(*) as count FROM (
        SELECT customer_id FROM bookings WHERE status='completed' GROUP BY customer_id HAVING COUNT(*) > 1
      ) as rc
    `, { type: db.QueryTypes.SELECT });

    // Average rating by zone
    const ratingByZone = await db.query(`
      SELECT sz.name, sz.city, AVG(b.rating) as avg_rating, COUNT(b.rating) as rated_count
      FROM bookings b LEFT JOIN service_zones sz ON b.zone_id = sz.id
      WHERE b.rating IS NOT NULL GROUP BY b.zone_id
    `, { type: db.QueryTypes.SELECT });

    // ── NEW: Completion rate & avg rating ─────────────────────────────────
    const completionStats = await db.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
      FROM bookings WHERE created_at >= :since
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    const avgRatingRow = await db.query(`
      SELECT AVG(rating) as avg_rating FROM bookings
      WHERE rating IS NOT NULL AND created_at >= :since
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    const completionRate = completionStats[0]?.total > 0
      ? parseFloat(((completionStats[0].completed / completionStats[0].total) * 100).toFixed(1))
      : 0;

    // ── NEW: Shop order analytics ──────────────────────────────────────────
    const shopOrdersStats = await db.query(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COALESCE(AVG(total_amount), 0) as avg_order_value,
        SUM(CASE WHEN status='delivered'   THEN 1 ELSE 0 END) as delivered_orders,
        SUM(CASE WHEN status='cancelled'   THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(CASE WHEN status='processing'  THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status='shipped'     THEN 1 ELSE 0 END) as shipped_orders,
        SUM(CASE WHEN status='pending'     THEN 1 ELSE 0 END) as pending_orders
      FROM orders WHERE created_at >= :since
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // ── NEW: Top selling products ──────────────────────────────────────────
    const topProducts = await db.query(`
      SELECT p.name, p.icon_key,
        SUM(oi.quantity) as total_sold,
        SUM(oi.price * oi.quantity) as revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= :since AND o.payment_status = 'paid'
      GROUP BY oi.product_id ORDER BY total_sold DESC LIMIT 10
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // ── NEW: Active subscriptions by plan ──────────────────────────────────
    const subscriptionsByPlan = await db.query(`
      SELECT sp.name, sp.price,
        COUNT(s.id) as active_count,
        SUM(s.amount_paid) as total_revenue
      FROM subscriptions s
      JOIN service_plans sp ON s.plan_id = sp.id
      WHERE s.status = 'active'
      GROUP BY s.plan_id ORDER BY active_count DESC
    `, { type: db.QueryTypes.SELECT });

    // ── NEW: Revenue breakdown ─────────────────────────────────────────────
    const revenueBreakdown = await db.query(`
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0) FROM bookings
          WHERE status='completed' AND created_at >= :since) as booking_revenue,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders
          WHERE payment_status='paid' AND created_at >= :since) as shop_revenue,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM subscriptions
          WHERE created_at >= :since) as subscription_revenue
    `, { replacements: { since }, type: db.QueryTypes.SELECT });

    // ── NEW: Active counts ─────────────────────────────────────────────────
    const activeGardeners = await db.query(`
      SELECT COUNT(*) as count FROM users WHERE role='gardener' AND is_active=1 AND is_approved=1
    `, { type: db.QueryTypes.SELECT });

    const activeSubscriptions = await db.query(`
      SELECT COUNT(*) as count FROM subscriptions WHERE status='active'
    `, { type: db.QueryTypes.SELECT });

    res.json({
      success: true, data: {
        revenueByDay, bookingsByDay, bookingsByZone, bookingsByCity, customerLocations,
        bookingStatusDist, planDist, topGardeners, newUsersTrend,
        repeatCustomers: repeatCustomers[0]?.count || 0, ratingByZone,
        // ── New fields ──────────────────────────────────────────────────────
        completionRate,
        avgRating: avgRatingRow[0]?.avg_rating || null,
        shopOrdersStats: shopOrdersStats[0] || {},
        topProducts,
        subscriptionsByPlan,
        revenueBreakdown: revenueBreakdown[0] || {},
        activeGardeners: activeGardeners[0]?.count || 0,
        activeSubscriptions: activeSubscriptions[0]?.count || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── GARDENER MANAGEMENT ───────────────────────────────────────────────────────
exports.getGardeners = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, city, search } = req.query;
    const where = { role: 'gardener' };
    if (status === 'pending') where.is_approved = false;
    else if (status === 'active') { where.is_approved = true; where.is_active = true; }
    else if (status === 'inactive') where.is_active = false;
    if (city) where.city = city;
    if (search) where[Op.or] = [{ name: { [Op.like]: `%${search}%` } }, { phone: { [Op.like]: `%${search}%` } }];

    const { count, rows } = await User.findAndCountAll({
      where,
      include: [{ model: GardenerProfile, as: 'gardenerProfile' }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { gardeners: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.approveGardener = async (req, res) => {
  try {
    const { user_id, supervisor_id } = req.body;
    const user = await User.findOne({ where: { id: user_id, role: 'gardener' } });
    if (!user) return res.status(404).json({ success: false, message: 'Gardener not found' });

    await user.update({ is_approved: true, is_active: true });
    if (supervisor_id) await GardenerProfile.update({ supervisor_id }, { where: { user_id } });

    await sendWhatsApp(user.phone, templates.welcomeGardener(user.name));
    res.json({ success: true, message: 'Gardener approved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.rejectGardener = async (req, res) => {
  try {
    const { user_id, reason } = req.body;
    await User.update({ is_active: false }, { where: { id: user_id } });
    res.json({ success: true, message: 'Gardener rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteGardener = async (req, res) => {
  try {
    const { GardenerProfile, GardenerZone } = require('../models');
    const user = await User.findOne({ where: { id: req.params.id, role: 'gardener' } });
    if (!user) return res.status(404).json({ success: false, message: 'Gardener not found' });

    // Safety check: block deletion if gardener has active/pending bookings
    const activeBookings = await Booking.count({
      where: { gardener_id: req.params.id, status: { [Op.in]: ['pending', 'assigned', 'in_progress'] } }
    });
    if (activeBookings > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete gardener with ${activeBookings} active/pending booking(s). Reassign or cancel them first.`
      });
    }

    // Cascade delete profile and zone assignments first
    await GardenerZone.destroy({ where: { gardener_id: req.params.id } });
    await GardenerProfile.destroy({ where: { user_id: req.params.id } });
    await user.destroy();

    res.json({ success: true, message: `Gardener "${user.name}" has been permanently deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUPERVISOR MANAGEMENT ─────────────────────────────────────────────────────
exports.createSupervisor = async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    const existing = await User.findOne({ where: { phone } });
    if (existing) return res.status(400).json({ success: false, message: 'Phone already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, phone, email, password: hashed, role: 'supervisor', is_active: true, is_approved: true, referral_code: `SUP${phone.slice(-6)}` });
    const u = user.toJSON(); delete u.password;
    res.status(201).json({ success: true, data: u });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSupervisors = async (req, res) => {
  try {
    const supervisors = await User.findAll({
      where: { role: 'supervisor', is_active: true },
      attributes: { exclude: ['password', 'otp'] },
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: supervisors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SERVICE ZONE MANAGEMENT ───────────────────────────────────────────────────
exports.getZones = async (req, res) => {
  try {
    const zones = await ServiceZone.findAll({ order: [['city', 'ASC'], ['name', 'ASC']] });
    res.json({ success: true, data: zones });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createZone = async (req, res) => {
  try {
    const zone = await ServiceZone.create(req.body);
    res.status(201).json({ success: true, data: zone });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateZone = async (req, res) => {
  try {
    await ServiceZone.update(req.body, { where: { id: req.params.id } });
    const zone = await ServiceZone.findByPk(req.params.id);
    res.json({ success: true, data: zone });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PLAN MANAGEMENT ───────────────────────────────────────────────────────────
exports.createPlan = async (req, res) => {
  try {
    const plan = await ServicePlan.create(req.body);
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const oldPlan = await ServicePlan.findByPk(req.params.id);
    if (req.body.price && req.body.price !== oldPlan.price) {
      await PriceHikeLog.create({ plan_id: req.params.id, old_price: oldPlan.price, new_price: req.body.price, reason: req.body.price_reason || 'Manual update', applied_by: req.user.id });
    }
    await ServicePlan.update(req.body, { where: { id: req.params.id } });
    const plan = await ServicePlan.findByPk(req.params.id);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── REWARD/PENALTY ────────────────────────────────────────────────────────────
exports.createRewardPenalty = async (req, res) => {
  try {
    const { gardener_id, type, amount, reason, description, booking_id } = req.body;
    const rp = await RewardPenalty.create({ gardener_id, type, amount, reason, description, booking_id });
    // Update gardener earnings
    if (type === 'reward') await GardenerProfile.increment({ total_earnings: amount }, { where: { user_id: gardener_id } });
    else await GardenerProfile.decrement({ total_earnings: amount }, { where: { user_id: gardener_id } });
    await rp.update({ status: 'applied', applied_at: new Date() });
    res.status(201).json({ success: true, data: rp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRewardPenalties = async (req, res) => {
  try {
    const { gardener_id, type, page = 1, limit = 20 } = req.query;
    const where = {};
    if (gardener_id) where.gardener_id = gardener_id;
    if (type) where.type = type;
    const { count, rows } = await RewardPenalty.findAndCountAll({
      where,
      include: [{ model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { items: rows, total: count } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── CUSTOMERS ─────────────────────────────────────────────────────────────────
exports.getCustomers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, city } = req.query;
    const where = { role: 'customer' };
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ];
      if (!isNaN(search)) where[Op.or].push({ id: search });
    }
    if (city) where.city = city;
    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password', 'otp'] },
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });
    res.json({ success: true, data: { customers: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ALL BOOKINGS ──────────────────────────────────────────────────────────────
exports.getAllBookings = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, zone_id, date, gardener_id, customer_id, subscription_id, search } = req.query;
    const where = {};
    if (status) where.status = status;
    if (zone_id) where.zone_id = zone_id;
    if (date) where.scheduled_date = date;
    if (gardener_id) where.gardener_id = gardener_id;
    if (customer_id) where.customer_id = customer_id;
    if (subscription_id) where.subscription_id = subscription_id;

    if (search) {
      where[Op.or] = [
        { booking_number: { [Op.like]: `%${search}%` } },
        { '$customer.name$': { [Op.like]: `%${search}%` } },
        { '$customer.phone$': { [Op.like]: `%${search}%` } },
        { '$gardener.name$': { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Booking.findAndCountAll({
      where,
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'profile_image', 'city', 'address'] },
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone', 'profile_image'] },
        { model: ServiceZone, as: 'zone', attributes: ['id', 'name', 'city', 'center_latitude', 'center_longitude'] },
        { model: Subscription, as: 'subscription', include: [{ model: ServicePlan, as: 'plan', attributes: ['name'] }] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
      distinct: true
    });
    res.json({ success: true, data: { bookings: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PRICE HIKE CRON ───────────────────────────────────────────────────────────
exports.triggerPriceHike = async (req, res) => {
  try {
    const { percentage, reason, zone_ids, plan_ids } = req.body;
    const results = [];

    if (zone_ids && zone_ids.length > 0) {
      for (const zid of zone_ids) {
        const zone = await ServiceZone.findByPk(zid);
        if (zone) {
          const newPrice = parseFloat((zone.base_price * (1 + percentage / 100)).toFixed(2));
          await PriceHikeLog.create({ zone_id: zid, old_price: zone.base_price, new_price: newPrice, hike_percentage: percentage, reason, applied_by: req.user.id });
          await zone.update({ base_price: newPrice });
          results.push({ type: 'zone', id: zid, name: zone.name, old: zone.base_price, new: newPrice });
        }
      }
    }

    if (plan_ids && plan_ids.length > 0) {
      for (const pid of plan_ids) {
        const plan = await ServicePlan.findByPk(pid);
        if (plan) {
          const newPrice = parseFloat((plan.price * (1 + percentage / 100)).toFixed(2));
          await PriceHikeLog.create({ plan_id: pid, old_price: plan.price, new_price: newPrice, hike_percentage: percentage, reason, applied_by: req.user.id });
          await plan.update({ price: newPrice });
          results.push({ type: 'plan', id: pid, name: plan.name, old: plan.price, new: newPrice });
        }
      }
    }

    res.json({ success: true, message: `Price hike applied`, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER UTILIZATION RATE ─────────────────────────────────────────────────
exports.getUtilizationReport = async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Max possible jobs: assume 6 jobs/day, 6 days/week
    const maxJobsPerDay = 6;
    const workingDays = Math.round(days * (6 / 7));
    const maxPossibleJobs = maxJobsPerDay * workingDays;

    const utilization = await db.query(`
      SELECT
        u.id,
        u.name,
        u.phone,
        u.city,
        gp.rating,
        gp.is_available,
        COUNT(b.id) AS total_assigned,
        SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN b.status = 'failed'    THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN b.status = 'completed' THEN b.total_amount ELSE 0 END) AS earnings,
        ROUND(
          SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) / :maxJobs * 100, 1
        ) AS utilization_pct,
        ROUND(
          SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) /
          NULLIF(COUNT(b.id), 0) * 100, 1
        ) AS completion_pct
      FROM users u
      JOIN gardener_profiles gp ON u.id = gp.user_id
      LEFT JOIN bookings b ON b.gardener_id = u.id AND b.created_at >= :since
      WHERE u.role = 'gardener' AND u.is_active = 1 AND u.is_approved = 1
      GROUP BY u.id, u.name, u.phone, u.city, gp.rating, gp.is_available
      ORDER BY utilization_pct DESC
    `, {
      replacements: { maxJobs: maxPossibleJobs, since },
      type: db.QueryTypes.SELECT
    });

    // Summary stats
    const avgUtilization = utilization.length > 0
      ? (utilization.reduce((s, g) => s + Number(g.utilization_pct || 0), 0) / utilization.length).toFixed(1)
      : 0;

    const overloaded   = utilization.filter(g => Number(g.utilization_pct) > 80).length;
    const underutilized = utilization.filter(g => Number(g.utilization_pct) < 30).length;
    const optimal      = utilization.filter(g => Number(g.utilization_pct) >= 30 && Number(g.utilization_pct) <= 80).length;

    res.json({
      success: true,
      data: {
        gardeners: utilization,
        summary: {
          avg_utilization_pct: avgUtilization,
          overloaded,
          underutilized,
          optimal,
          total_gardeners: utilization.length,
          max_possible_jobs_per_gardener: maxPossibleJobs,
          period_days: days,
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GEOFENCE MANAGEMENT ───────────────────────────────────────────────────────
exports.updateGardener = async (req, res) => {
  try {
    const { supervisor_id, is_active } = req.body;
    const gardener = await User.findByPk(req.params.id);
    if (!gardener || gardener.role !== 'gardener') return res.status(404).json({ success: false, message: 'Gardener not found' });
    
    if (is_active !== undefined) await gardener.update({ is_active });
    
    if (supervisor_id !== undefined) {
      await GardenerProfile.update({ supervisor_id: supervisor_id || null }, { where: { user_id: gardener.id } });
    }
    
    res.json({ success: true, message: 'Gardener updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getGeofences = async (req, res) => {
  try {
    const { Geofence } = require('../models');
    const geofences = await Geofence.findAll({ order: [['city', 'ASC'], ['name', 'ASC']] });
    res.json({ success: true, data: geofences });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createGeofence = async (req, res) => {
  try {
    const { Geofence } = require('../models');
    const { name, city, state, polygon_coords, is_active, base_price, price_per_plant, min_plants, product_markup } = req.body;
    if (!polygon_coords || !Array.isArray(polygon_coords) || polygon_coords.length < 3) {
      return res.status(400).json({ success: false, message: 'polygon_coords must be an array of at least 3 [lat, lng] points' });
    }
    const geofence = await Geofence.create({
      name, city, state: state || '',
      polygon_coords: JSON.stringify(polygon_coords),
      is_active: is_active !== false,
      base_price: parseFloat(base_price) || 0,
      price_per_plant: parseFloat(price_per_plant) || 0,
      min_plants: parseInt(min_plants) || 1,
      product_markup: parseFloat(product_markup) || 0,
      created_by: req.user.id
    });
    res.status(201).json({ success: true, data: geofence });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateGeofence = async (req, res) => {
  try {
    const { Geofence } = require('../models');
    const geofence = await Geofence.findByPk(req.params.id);
    if (!geofence) return res.status(404).json({ success: false, message: 'Geofence not found' });
    const { name, city, state, polygon_coords, is_active, base_price, price_per_plant, min_plants, product_markup } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (is_active !== undefined) updates.is_active = is_active;
    if (base_price !== undefined) updates.base_price = parseFloat(base_price) || 0;
    if (price_per_plant !== undefined) updates.price_per_plant = parseFloat(price_per_plant) || 0;
    if (min_plants !== undefined) updates.min_plants = parseInt(min_plants) || 1;
    if (product_markup !== undefined) updates.product_markup = parseFloat(product_markup) || 0;
    if (polygon_coords && Array.isArray(polygon_coords) && polygon_coords.length >= 3) {
      updates.polygon_coords = JSON.stringify(polygon_coords);
    }
    await geofence.update(updates);
    res.json({ success: true, data: geofence });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteGeofence = async (req, res) => {
  try {
    const { Geofence } = require('../models');
    const geofence = await Geofence.findByPk(req.params.id);
    if (!geofence) return res.status(404).json({ success: false, message: 'Geofence not found' });
    await geofence.destroy();
    res.json({ success: true, message: 'Geofence deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SHOP MANAGEMENT ─────────────────────────────────────────────────────────

// Categories
exports.getAdminCategories = async (req, res) => {
  try {
    const categories = await ProductCategory.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: categories });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createCategory = async (req, res) => {
  try {
    const category = await ProductCategory.create(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateCategory = async (req, res) => {
  try {
    await ProductCategory.update(req.body, { where: { id: req.params.id } });
    const category = await ProductCategory.findByPk(req.params.id);
    res.json({ success: true, data: category });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteCategory = async (req, res) => {
  try {
    await ProductCategory.update({ is_active: false }, { where: { id: req.params.id } });
    res.json({ success: true, message: 'Category deactivated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Products
exports.getAdminProducts = async (req, res) => {
  try {
    const products = await Product.findAll({
      include: [{ model: ProductCategory, as: 'category', attributes: ['name'] }],
      order: [['created_at', 'DESC']]
    });
    res.json({ success: true, data: products });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateProduct = async (req, res) => {
  try {
    await Product.update(req.body, { where: { id: req.params.id } });
    const product = await Product.findByPk(req.params.id);
    res.json({ success: true, data: product });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteProduct = async (req, res) => {
  try {
    await Product.update({ is_active: false }, { where: { id: req.params.id } });
    res.json({ success: true, message: 'Product deactivated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Orders
exports.getAdminOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const where = {};
    if (status) where.status = status;
    
    if (search) {
      const searchConditions = [
        { order_number: { [Op.like]: `%${search}%` } },
        { '$customer.name$': { [Op.like]: `%${search}%` } },
        { '$customer.phone$': { [Op.like]: `%${search}%` } }
      ];
      // Only search by ID if it's a reasonably small positive integer
      const searchId = parseInt(search);
      if (!isNaN(searchId) && searchId > 0 && searchId < 2147483647) {
        searchConditions.push({ id: searchId });
      }
      where[Op.or] = searchConditions;
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      attributes: {
        include: [
          [
            sequelize.literal(`(
              SELECT COUNT(*) FROM orders AS o2 
              WHERE o2.customer_id = Order.customer_id AND o2.id <= Order.id
            )`),
            'order_sequence'
          ]
        ]
      },
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'city', 'address'] },
        { 
          model: OrderItem, 
          as: 'items',
          include: [{ model: Product, as: 'product', attributes: ['name', 'icon_key', 'price', 'mrp'] }]
        }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
      distinct: true
    });
    res.json({ success: true, data: { orders: rows, total: count } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    await Order.update({ status }, { where: { id: req.params.id } });
    const order = await Order.findByPk(req.params.id);
    res.json({ success: true, data: order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
