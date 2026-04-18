const bcrypt = require('bcryptjs');
const { Op, fn, col, literal, sequelize } = require('sequelize');
const db = require('../config/database');
const { User, GardenerProfile, ServiceZone, ServicePlan, Booking, Subscription, RewardPenalty, Blog, CityPage, Payment, PriceHikeLog, Product, ProductCategory, Order, OrderItem, Faq } = require('../models');
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
    const { period = '30', zone_id, geofence_id } = req.query;
    const days = parseInt(period);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Define shared filters for hybrid logic (Explicit Geofence ID OR Resolved City Fallback)
    const gfId = geofence_id || zone_id;
    let cityFilter = null;
    let bookingCond = '';
    let subscriptionCond = '';
    let orderCond = '';
    let userCond = '';

    if (gfId) {
      const { Geofence } = require('../models');
      const gf = await Geofence.findByPk(gfId);
      if (gf) cityFilter = gf.city;
      
      // Hybrid logic: Match explicit geofence_id OR match city for legacy records
      bookingCond = `AND (b.geofence_id = :gfId OR (b.geofence_id IS NULL AND cu.city = :city))`;
      subscriptionCond = `AND (s.geofence_id = :gfId OR (s.geofence_id IS NULL AND cu.city = :city))`;
      orderCond = `AND (o.geofence_id = :gfId OR (o.geofence_id IS NULL AND o.shipping_city = :city))`;
      userCond = `AND (u.geofence_id = :gfId OR (u.geofence_id IS NULL AND u.city = :city))`;
    }

    const rp = { since, city: cityFilter, gfId };

    // 1. Revenue & Bookings over time
    const revenueByDay = await db.query(`
      SELECT DATE(b.created_at) as date, SUM(b.total_amount) as revenue
      FROM bookings b JOIN users cu ON cu.id = b.customer_id
      WHERE b.status = 'completed' AND b.created_at >= :since ${bookingCond}
      GROUP BY DATE(b.created_at) ORDER BY date ASC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const bookingsByDay = await db.query(`
      SELECT DATE(b.created_at) as date, COUNT(b.id) as count
      FROM bookings b JOIN users cu ON cu.id = b.customer_id
      WHERE b.created_at >= :since ${bookingCond}
      GROUP BY DATE(b.created_at) ORDER BY date ASC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    // 2. Geographic Distribution
    const bookingsByZone = await db.query(`
      SELECT 
        COALESCE(g.name, cu.city) as zone,
        cu.city, 
        COUNT(b.id) as total, 
        SUM(b.total_amount) as revenue
      FROM bookings b 
      JOIN users cu ON cu.id = b.customer_id
      LEFT JOIN geofences g ON b.geofence_id = g.id
      WHERE b.created_at >= :since AND (cu.city IS NOT NULL OR b.geofence_id IS NOT NULL) ${bookingCond}
      GROUP BY g.id, g.name, cu.city ORDER BY total DESC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const bookingsByCity = await db.query(`
      SELECT cu.city, cu.state, COUNT(b.id) as total, SUM(b.total_amount) as revenue
      FROM bookings b JOIN users cu ON cu.id = b.customer_id
      WHERE b.created_at >= :since AND cu.city IS NOT NULL ${bookingCond}
      GROUP BY cu.city, cu.state ORDER BY total DESC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const customerLocations = await db.query(`
      SELECT city, state, COUNT(*) as count FROM users u
      WHERE role = 'customer' AND city IS NOT NULL ${userCond}
      GROUP BY city, state ORDER BY count DESC LIMIT 20
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    // 3. Subscription & Booking distribution
    const planDist = await db.query(`
      SELECT sp.name, COUNT(s.id) as count, SUM(s.amount_paid) as revenue
      FROM subscriptions s
      LEFT JOIN service_plans sp ON s.plan_id = sp.id
      JOIN users cu ON cu.id = s.customer_id
      WHERE s.created_at >= :since ${subscriptionCond}
      GROUP BY s.plan_id, sp.name ORDER BY count DESC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const bookingStatusDist = await db.query(`
      SELECT b.status, COUNT(b.id) as count FROM bookings b
      JOIN users cu ON cu.id = b.customer_id
      WHERE b.created_at >= :since ${bookingCond} GROUP BY b.status
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    // 4. Performance & Rankings
    const topGardeners = await db.query(`
      SELECT u.name, gp.rating, gp.completed_jobs, gp.total_earnings
      FROM users u JOIN gardener_profiles gp ON u.id = gp.user_id
      WHERE u.role = 'gardener' AND u.is_active = 1
      ${gfId ? 'AND (u.geofence_id = :gfId OR (u.geofence_id IS NULL AND u.city = :city))' : ''}
      ORDER BY gp.rating DESC, gp.completed_jobs DESC LIMIT 5
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const newUsersTrend = await db.query(`
      SELECT DATE(created_at) as date, role, COUNT(*) as count FROM users u
      WHERE created_at >= :since ${userCond}
      GROUP BY DATE(created_at), role ORDER BY date ASC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const repeatCustomersCount = await db.query(`
      SELECT COUNT(*) as count FROM (
        SELECT b.customer_id FROM bookings b
        JOIN users cu ON cu.id = b.customer_id
        WHERE b.status = 'completed' ${bookingCond}
        GROUP BY b.customer_id HAVING COUNT(b.id) > 1
      ) as repeats
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    // 5. Detailed Rating & Completion
    const ratingByZone = await db.query(`
      SELECT COALESCE(g.name, cu.city) as zone, AVG(b.rating) as avg_rating
      FROM bookings b 
      JOIN users cu ON cu.id = b.customer_id
      LEFT JOIN geofences g ON b.geofence_id = g.id
      WHERE b.rating IS NOT NULL ${bookingCond} GROUP BY g.id, g.name, cu.city
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const completionStats = await db.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) as completed,
        AVG(b.rating) as avg_rating
      FROM bookings b JOIN users cu ON cu.id = b.customer_id
      WHERE b.created_at >= :since ${bookingCond}
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    // 6. Shop Order Analytics
    const shopOrdersStats = await db.query(`
      SELECT
        COUNT(id) as total_orders,
        SUM(total_amount) as total_revenue,
        AVG(total_amount) as avg_order_value,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status = 'shipped'    THEN 1 ELSE 0 END) as shipped_orders,
        SUM(CASE WHEN status = 'pending'    THEN 1 ELSE 0 END) as pending_orders
      FROM orders o WHERE o.created_at >= :since ${gfId ? 'AND (o.geofence_id = :gfId OR (o.geofence_id IS NULL AND o.shipping_city = :city))' : ''}
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const topProducts = await db.query(`
      SELECT p.name, p.icon_key, SUM(oi.quantity) as total_sold, SUM(oi.quantity * oi.price) as revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= :since AND o.payment_status = 'paid' ${orderCond}
      GROUP BY oi.product_id, p.name, p.icon_key ORDER BY total_sold DESC LIMIT 5
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const shopOrdersByZone = await db.query(`
      SELECT
        COALESCE(g.name, o.shipping_city, 'Unknown') as zone,
        COALESCE(o.shipping_city, 'Unknown') as city,
        COUNT(o.id) as total,
        SUM(o.total_amount) as revenue
      FROM orders o 
      LEFT JOIN geofences g ON o.geofence_id = g.id
      WHERE o.created_at >= :since ${orderCond}
      GROUP BY g.id, g.name, o.shipping_city ORDER BY total DESC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const shopOrdersByCity = await db.query(`
      SELECT shipping_city as city, COUNT(id) as total, SUM(total_amount) as revenue
      FROM orders o WHERE o.created_at >= :since ${gfId ? 'AND (o.geofence_id = :gfId OR (o.geofence_id IS NULL AND o.shipping_city = :city))' : ''}
      GROUP BY shipping_city ORDER BY total DESC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const subscriptionsByPlan = await db.query(`
      SELECT sp.name, sp.price, COUNT(s.id) as active_count, SUM(s.amount_paid) as total_revenue
      FROM subscriptions s
      JOIN service_plans sp ON s.plan_id = sp.id
      JOIN users cu ON cu.id = s.customer_id
      WHERE s.status = 'active' ${subscriptionCond}
      GROUP BY s.plan_id, sp.name, sp.price ORDER BY active_count DESC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const subscriptionsByZone = await db.query(`
      SELECT
        COALESCE(g.name, cu.city, 'Unknown') as zone,
        COUNT(s.id) as count,
        SUM(s.amount_paid) as revenue
      FROM subscriptions s
      JOIN users cu ON cu.id = s.customer_id
      LEFT JOIN geofences g ON s.geofence_id = g.id
      WHERE s.created_at >= :since ${subscriptionCond}
      GROUP BY g.id, g.name, cu.city ORDER BY count DESC
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    // 7. Financial Summary
    const revenueBreakdown = await db.query([
      'SELECT',
      `  (SELECT COALESCE(SUM(b.total_amount), 0) FROM bookings b JOIN users cu ON cu.id = b.customer_id`,
      `    WHERE b.status="completed" AND b.created_at >= :since ${bookingCond}) as booking_revenue,`,
      `  (SELECT COALESCE(SUM(total_amount), 0) FROM orders o`,
      `    WHERE payment_status="paid" AND created_at >= :since ${gfId ? 'AND (o.geofence_id = :gfId OR (o.geofence_id IS NULL AND o.shipping_city = :city))' : ''}) as shop_revenue,`,
      `  (SELECT COALESCE(SUM(s.amount_paid), 0) FROM subscriptions s JOIN users cu ON cu.id = s.customer_id`,
      `    WHERE s.created_at >= :since ${subscriptionCond}) as subscription_revenue`,
    ].filter(Boolean).join('\n'), { replacements: rp, type: db.QueryTypes.SELECT });

    const activeGardeners = await db.query(`
      SELECT COUNT(*) as count FROM users u
      WHERE u.role = "gardener" AND u.is_active = 1 AND u.is_approved = 1
      ${gfId ? 'AND (u.geofence_id = :gfId OR (u.geofence_id IS NULL AND u.city = :city))' : ''}
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    const activeSubscriptions = await db.query(`
      SELECT COUNT(*) as count FROM subscriptions s
      JOIN users cu ON cu.id = s.customer_id
      WHERE s.status = "active" ${subscriptionCond}
    `, { replacements: rp, type: db.QueryTypes.SELECT });

    res.json({
      success: true,
      data: {
        revenueByDay,
        bookingsByDay,
        bookingsByZone,
        bookingsByCity,
        customerLocations,
        bookingStatusDist,
        planDist,
        topGardeners,
        newUsersTrend,
        repeatCustomers: repeatCustomersCount[0]?.count || 0,
        ratingByZone,
        completionRate: completionStats[0]?.total > 0 ? (completionStats[0].completed / completionStats[0].total * 100).toFixed(1) : 0,
        avgRating: completionStats[0]?.avg_rating ? Number(completionStats[0].avg_rating).toFixed(1) : null,
        shopOrdersStats: shopOrdersStats[0] || {},
        topProducts,
        shopOrdersByZone,
        shopOrdersByCity,
        subscriptionsByPlan,
        subscriptionsByZone,
        revenueBreakdown: revenueBreakdown[0] || { booking_revenue: 0, shop_revenue: 0, subscription_revenue: 0 },
        activeGardeners: activeGardeners[0]?.count || 0,
        activeSubscriptions: activeSubscriptions[0]?.count || 0,
        selectedCity: cityFilter || null,
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
      include: [
        { model: GardenerProfile, as: 'gardenerProfile' },
        { 
          model: GardenerZone, as: 'assignedGeofences',
          include: [{ model: Geofence, as: 'geofence', attributes: ['id', 'name', 'city'] }]
        }
      ],
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

exports.updateSupervisor = async (req, res) => {
  try {
    const { name, phone, email, password, gardener_ids } = req.body;
    const user = await User.findByPk(req.params.id);
    if (!user || user.role !== 'supervisor') return res.status(404).json({ success: false, message: 'Supervisor not found' });

    const updates = { name, phone, email };
    if (password) updates.password = await bcrypt.hash(password, 10);
    await user.update(updates);

    if (Array.isArray(gardener_ids)) {
      // Clear old assignments and set new ones for the selected gardeners
      await GardenerProfile.update({ supervisor_id: null }, { where: { supervisor_id: user.id } });
      if (gardener_ids.length > 0) {
        await GardenerProfile.update({ supervisor_id: user.id }, { where: { user_id: { [Op.in]: gardener_ids } } });
      }
    }

    res.json({ success: true, message: 'Supervisor updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSupervisors = async (req, res) => {
  try {
    const supervisors = await User.findAll({
      where: { role: 'supervisor', is_active: true },
      attributes: { exclude: ['password', 'otp'] },
      include: [
        {
          model: GardenerProfile,
          as: 'team',
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone'] }]
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // Virtual field for team size
    const results = supervisors.map(s => {
      const data = s.toJSON();
      data.team_size = s.team?.length || 0;
      return data;
    });

    res.json({ success: true, data: results });
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
    const { page = 1, limit = 20, status, zone_id, geofence_id, date, gardener_id, customer_id, subscription_id, search } = req.query;
    const where = {};
    if (status) where.status = status;
    if (geofence_id) where.geofence_id = geofence_id;
    else if (zone_id) where.zone_id = zone_id;
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
        { model: Geofence, as: 'geofence', attributes: ['id', 'name', 'city'] },
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
    const { period = '30', zone_id, geofence_id } = req.query;
    const days = parseInt(period);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Resolve city from geofence/zone
    let cityFilter = null;
    const gfId = geofence_id || zone_id;
    let gardenerCond = '';
    if (gfId) {
      const { Geofence } = require('../models');
      const gf = await Geofence.findByPk(gfId);
      if (gf) cityFilter = gf.city;
      gardenerCond = `AND (u.geofence_id = :gfId OR (u.geofence_id IS NULL AND u.city = :city))`;
    }

    // Max possible jobs: assume 6 jobs/day, 6 days/week
    const maxJobsPerDay = 6;
    const workingDays = Math.round(days * (6 / 7));
    const maxPossibleJobs = maxJobsPerDay * workingDays;

    const utilization = await db.query(`
      SELECT
        u.id, u.name, u.phone, u.city,
        gp.rating, gp.is_available,
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
      WHERE u.role = 'gardener' AND u.is_active = 1 AND u.is_approved = 1 ${gardenerCond}
      GROUP BY u.id, u.name, u.phone, u.city, gp.rating, gp.is_available
      ORDER BY utilization_pct DESC
    `, {
      replacements: { maxJobs: maxPossibleJobs, since, city: cityFilter, gfId },
      type: db.QueryTypes.SELECT
    });

    const avgUtilization = utilization.length > 0
      ? (utilization.reduce((s, g) => s + Number(g.utilization_pct || 0), 0) / utilization.length).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        gardeners: utilization,
        summary: {
          avg_utilization_pct: avgUtilization,
          overloaded: utilization.filter(g => Number(g.utilization_pct) > 80).length,
          underutilized: utilization.filter(g => Number(g.utilization_pct) < 30).length,
          optimal: utilization.filter(g => Number(g.utilization_pct) >= 30 && Number(g.utilization_pct) <= 80).length,
          total_gardeners: utilization.length,
          max_possible_jobs_per_gardener: maxPossibleJobs,
          period_days: days,
        },
        selectedCity: cityFilter || null
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

exports.getAdminFaqs = async (req, res) => {
  try {
    const faqs = await Faq.findAll({ order: [['display_order', 'ASC'], ['category', 'ASC']] });
    res.json({ success: true, data: faqs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getPublicFaqs = async (req, res) => {
  try {
    const faqs = await Faq.findAll({ where: { is_active: true }, order: [['display_order', 'ASC'], ['category', 'ASC']] });
    res.json({ success: true, data: faqs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createFaq = async (req, res) => {
  try {
    const faq = await Faq.create(req.body);
    res.status(201).json({ success: true, data: faq });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateFaq = async (req, res) => {
  try {
    await Faq.update(req.body, { where: { id: req.params.id } });
    const faq = await Faq.findByPk(req.params.id);
    res.json({ success: true, data: faq });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteFaq = async (req, res) => {
  try {
    await Faq.destroy({ where: { id: req.params.id } });
    res.json({ success: true, message: 'FAQ deleted permanently' });
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
    const data = { ...req.body };
    if (req.file) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      data.image_url = `${baseUrl}/uploads/shop/${req.file.filename}`;
    }
    const category = await ProductCategory.create(data);
    res.status(201).json({ success: true, data: category });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateCategory = async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.file) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      data.image_url = `${baseUrl}/uploads/shop/${req.file.filename}`;
    }
    await ProductCategory.update(data, { where: { id: req.params.id } });
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
    const data = { ...req.body };
    if (req.file) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      data.images = [`${baseUrl}/uploads/shop/${req.file.filename}`];
    }
    const product = await Product.create(data);
    res.status(201).json({ success: true, data: product });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateProduct = async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.file) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      data.images = [`${baseUrl}/uploads/shop/${req.file.filename}`];
    }
    await Product.update(data, { where: { id: req.params.id } });
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
    const { status, page = 1, limit = 20, search, geofence_id } = req.query;
    const where = {};
    if (status) where.status = status;
    if (geofence_id) where.geofence_id = geofence_id;

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
            literal(`(
              SELECT COUNT(*) FROM orders AS o2 
              WHERE o2.customer_id = Order.customer_id AND o2.id <= Order.id
            )`),
            'order_sequence'
          ]
        ]
      },
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone', 'city', 'address'] },
        { model: Geofence, as: 'geofence', attributes: ['id', 'name', 'city'] },
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
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    
    await order.update({ status });
    
    // Notify User
    const notificationService = require('../services/notification.service');
    await notificationService.notifyUser(order.customer_id, {
      title: '📦 Order Updated',
      body: `Your order ${order.order_number} status changed to ${status}.`,
      type: 'info',
      data: { order_id: order.id, status }
    });

    res.json({ success: true, data: order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.sendBroadcastNotification = async (req, res) => {
  try {
    const { title, body, type, geofence_id, target_role } = req.body;
    const notificationService = require('../services/notification.service');

    let result;
    if (geofence_id) {
      result = await notificationService.notifyGeofence(geofence_id, { title, body, type, targetRole: target_role || 'customer' });
    } else if (target_role && target_role !== 'all') {
      // Role-based broadcast (need to implement in service)
      // For now, let's just use notifyAll but it's fine for GKM
      result = await notificationService.notifyAll({ title, body, type });
    } else {
      result = await notificationService.notifyAll({ title, body, type });
    }

    res.json({ success: true, message: 'Broadcast sent successfully', data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
