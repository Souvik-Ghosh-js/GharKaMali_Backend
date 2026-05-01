const { Op } = require('sequelize');
const { User, GardenerProfile, Booking, Geofence, GardenerZone, RewardPenalty, Complaint } = require('../models');
const { sendWhatsApp, templates } = require('../services/otp.service');

// Helper: ids of gardeners assigned to the current supervisor
async function myGardenerIds(supervisorId) {
  const profiles = await GardenerProfile.findAll({
    where: { supervisor_id: supervisorId },
    attributes: ['user_id'],
  });
  return profiles.map(p => p.user_id);
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const ids = await myGardenerIds(req.user.id);
    const today = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));

    const [team, todayBookings, completedToday, pendingBookings, inProgress, recentBookings] = await Promise.all([
      User.findAll({
        where: { id: { [Op.in]: ids.length ? ids : [0] }, role: 'gardener' },
        attributes: ['id', 'name', 'phone', 'city', 'is_active', 'is_approved', 'profile_image'],
        include: [{ model: GardenerProfile, as: 'gardenerProfile' }],
      }),
      ids.length ? Booking.count({ where: { gardener_id: { [Op.in]: ids }, scheduled_date: today } }) : 0,
      ids.length ? Booking.count({ where: { gardener_id: { [Op.in]: ids }, status: 'completed', completed_at: { [Op.gte]: startOfDay } } }) : 0,
      ids.length ? Booking.count({ where: { gardener_id: { [Op.in]: ids }, status: { [Op.in]: ['pending', 'assigned'] } } }) : 0,
      ids.length ? Booking.count({ where: { gardener_id: { [Op.in]: ids }, status: 'in_progress' } }) : 0,
      ids.length ? Booking.findAll({
        where: { gardener_id: { [Op.in]: ids } },
        order: [['created_at', 'DESC']], limit: 8,
        include: [
          { model: User, as: 'customer', attributes: ['name', 'phone'] },
          { model: User, as: 'gardener', attributes: ['name', 'phone'] },
        ],
      }) : [],
    ]);

    const pending = team.filter(g => !g.is_approved).length;
    const active = team.filter(g => g.is_approved && g.is_active).length;

    res.json({
      success: true,
      data: {
        stats: {
          totalGardeners: team.length,
          activeGardeners: active,
          pendingGardeners: pending,
          todayBookings, completedToday, pendingBookings, inProgress,
        },
        team,
        recentBookings,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── LIST GARDENERS ASSIGNED TO ME ──────────────────────────────────────────────
exports.getMyGardeners = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const ids = await myGardenerIds(req.user.id);
    if (!ids.length) return res.json({ success: true, data: { gardeners: [], total: 0, page: 1, pages: 0 } });

    const where = { id: { [Op.in]: ids }, role: 'gardener' };
    if (status === 'pending') where.is_approved = false;
    else if (status === 'active') { where.is_approved = true; where.is_active = true; }
    else if (status === 'inactive') where.is_active = false;
    if (search) where[Op.and] = [{ [Op.or]: [{ name: { [Op.like]: `%${search}%` } }, { phone: { [Op.like]: `%${search}%` } }] }];

    const { count, rows } = await User.findAndCountAll({
      where,
      include: [
        { model: GardenerProfile, as: 'gardenerProfile' },
        { model: GardenerZone, as: 'assignedGeofences', include: [{ model: Geofence, as: 'geofence', attributes: ['id', 'name', 'city'] }] },
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit), offset: (page - 1) * limit,
    });
    res.json({ success: true, data: { gardeners: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Helper: ensure gardener belongs to current supervisor
async function assertOwned(supervisorId, gardenerId) {
  const profile = await GardenerProfile.findOne({ where: { user_id: gardenerId, supervisor_id: supervisorId } });
  return !!profile;
}

// ── GARDENER DETAIL ────────────────────────────────────────────────────────────
exports.getGardenerDetail = async (req, res) => {
  try {
    if (!await assertOwned(req.user.id, req.params.id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    const gardener = await User.findOne({
      where: { id: req.params.id, role: 'gardener' },
      attributes: { exclude: ['password', 'otp', 'otp_expires_at'] },
      include: [
        { model: GardenerProfile, as: 'gardenerProfile' },
        { model: GardenerZone, as: 'assignedGeofences', include: [{ model: Geofence, as: 'geofence' }] },
      ],
    });
    if (!gardener) return res.status(404).json({ success: false, message: 'Gardener not found' });

    const [totalBookings, completed, cancelled, recent] = await Promise.all([
      Booking.count({ where: { gardener_id: gardener.id } }),
      Booking.count({ where: { gardener_id: gardener.id, status: 'completed' } }),
      Booking.count({ where: { gardener_id: gardener.id, status: 'cancelled' } }),
      Booking.findAll({
        where: { gardener_id: gardener.id }, order: [['created_at', 'DESC']], limit: 10,
        include: [{ model: User, as: 'customer', attributes: ['name', 'phone'] }],
      }),
    ]);

    res.json({ success: true, data: { gardener, stats: { totalBookings, completed, cancelled }, recentBookings: recent } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── APPROVE GARDENER ───────────────────────────────────────────────────────────
exports.approveGardener = async (req, res) => {
  try {
    if (!await assertOwned(req.user.id, req.params.id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    const gardener = await User.findOne({ where: { id: req.params.id, role: 'gardener' } });
    if (!gardener) return res.status(404).json({ success: false, message: 'Gardener not found' });
    await gardener.update({ is_approved: true, is_active: true });
    try { await sendWhatsApp(gardener.phone, templates.welcomeGardener(gardener.name)); } catch (e) { /* swallow */ }
    res.json({ success: true, message: 'Gardener approved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── REJECT GARDENER ────────────────────────────────────────────────────────────
exports.rejectGardener = async (req, res) => {
  try {
    if (!await assertOwned(req.user.id, req.params.id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    await User.update({ is_active: false }, { where: { id: req.params.id, role: 'gardener' } });
    res.json({ success: true, message: 'Gardener rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── TOGGLE ACTIVE STATUS ───────────────────────────────────────────────────────
exports.toggleGardener = async (req, res) => {
  try {
    if (!await assertOwned(req.user.id, req.params.id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    const { is_active } = req.body;
    const gardener = await User.findOne({ where: { id: req.params.id, role: 'gardener' } });
    if (!gardener) return res.status(404).json({ success: false, message: 'Gardener not found' });
    await gardener.update({ is_active: !!is_active });
    res.json({ success: true, message: `Gardener ${is_active ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── UPDATE GARDENER (limited fields) ───────────────────────────────────────────
exports.updateGardener = async (req, res) => {
  try {
    if (!await assertOwned(req.user.id, req.params.id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    const gardener = await User.findOne({ where: { id: req.params.id, role: 'gardener' } });
    if (!gardener) return res.status(404).json({ success: false, message: 'Gardener not found' });

    const { name, email, city, is_active } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (city !== undefined) updates.city = city;
    if (is_active !== undefined) updates.is_active = !!is_active;
    await gardener.update(updates);

    const { bio, experience_years, is_available } = req.body;
    const profileUpdates = {};
    if (bio !== undefined) profileUpdates.bio = bio;
    if (experience_years !== undefined) profileUpdates.experience_years = parseInt(experience_years) || 0;
    if (is_available !== undefined) profileUpdates.is_available = !!is_available;
    if (Object.keys(profileUpdates).length) await GardenerProfile.update(profileUpdates, { where: { user_id: gardener.id } });

    res.json({ success: true, message: 'Gardener updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ASSIGN AN EXISTING UNASSIGNED GARDENER TO ME ───────────────────────────────
exports.assignGardener = async (req, res) => {
  try {
    const gardenerId = req.params.id;
    const gardener = await User.findOne({ where: { id: gardenerId, role: 'gardener' } });
    if (!gardener) return res.status(404).json({ success: false, message: 'Gardener not found' });
    const profile = await GardenerProfile.findOne({ where: { user_id: gardenerId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Gardener profile missing' });
    if (profile.supervisor_id && profile.supervisor_id !== req.user.id) {
      return res.status(400).json({ success: false, message: 'Gardener is already assigned to another supervisor' });
    }
    await profile.update({ supervisor_id: req.user.id });
    res.json({ success: true, message: 'Gardener added to your team' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── REMOVE A GARDENER FROM MY TEAM ─────────────────────────────────────────────
exports.unassignGardener = async (req, res) => {
  try {
    if (!await assertOwned(req.user.id, req.params.id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    await GardenerProfile.update({ supervisor_id: null }, { where: { user_id: req.params.id } });
    res.json({ success: true, message: 'Gardener removed from your team' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── LIST UNASSIGNED GARDENERS (so supervisor can pick from pool) ───────────────
exports.getUnassignedGardeners = async (req, res) => {
  try {
    const profiles = await GardenerProfile.findAll({
      where: { supervisor_id: null },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'phone', 'city', 'is_active', 'is_approved'], where: { role: 'gardener' } }],
      limit: 100,
    });
    res.json({ success: true, data: profiles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ASSIGN GEOFENCES TO A GARDENER ─────────────────────────────────────────────
exports.assignGeofences = async (req, res) => {
  try {
    if (!await assertOwned(req.user.id, req.params.id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    const { geofence_ids } = req.body;
    await GardenerZone.destroy({ where: { gardener_id: req.params.id } });
    for (const gid of geofence_ids || []) {
      await GardenerZone.create({ gardener_id: req.params.id, geofence_id: gid });
    }
    res.json({ success: true, message: 'Geofences assigned' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── BOOKINGS OF MY GARDENERS ───────────────────────────────────────────────────
exports.getBookings = async (req, res) => {
  try {
    const { status, gardener_id, page = 1, limit = 20 } = req.query;
    const ids = await myGardenerIds(req.user.id);
    if (!ids.length) return res.json({ success: true, data: { bookings: [], total: 0 } });

    const where = { gardener_id: { [Op.in]: ids } };
    if (status) where.status = status;
    if (gardener_id && ids.includes(parseInt(gardener_id))) where.gardener_id = parseInt(gardener_id);

    const { count, rows } = await Booking.findAndCountAll({
      where, order: [['created_at', 'DESC']],
      include: [
        { model: User, as: 'customer', attributes: ['name', 'phone'] },
        { model: User, as: 'gardener', attributes: ['name', 'phone'] },
      ],
      limit: parseInt(limit), offset: (page - 1) * limit,
    });
    res.json({ success: true, data: { bookings: rows, total: count, page: parseInt(page), pages: Math.ceil(count / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GIVE REWARD / PENALTY TO MY GARDENER ───────────────────────────────────────
exports.giveReward = async (req, res) => {
  try {
    const { gardener_id, type, amount, reason } = req.body;
    if (!await assertOwned(req.user.id, gardener_id)) return res.status(403).json({ success: false, message: 'Gardener not under your supervision' });
    const rp = await RewardPenalty.create({
      gardener_id, type, amount: parseFloat(amount) || 0, reason: reason || (type === 'reward' ? 'Reward' : 'Penalty'),
    });
    res.status(201).json({ success: true, data: rp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── LIST REWARDS / PENALTIES FOR MY TEAM ───────────────────────────────────────
exports.getRewards = async (req, res) => {
  try {
    const ids = await myGardenerIds(req.user.id);
    if (!ids.length) return res.json({ success: true, data: [] });
    const list = await RewardPenalty.findAll({
      where: { gardener_id: { [Op.in]: ids } },
      order: [['created_at', 'DESC']],
      include: [{ model: User, as: 'gardener', attributes: ['name', 'phone'] }],
      limit: 100,
    });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── COMPLAINTS ABOUT MY GARDENERS ──────────────────────────────────────────────
exports.getMyComplaints = async (req, res) => {
  try {
    const ids = await myGardenerIds(req.user.id);
    if (!ids.length) return res.json({ success: true, data: [] });
    const list = await Complaint.findAll({
      where: { gardener_id: { [Op.in]: ids } },
      order: [['created_at', 'DESC']],
      include: [
        { model: User, as: 'customer', attributes: ['name', 'phone'] },
        { model: User, as: 'gardener', attributes: ['name', 'phone'] },
      ],
    });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
