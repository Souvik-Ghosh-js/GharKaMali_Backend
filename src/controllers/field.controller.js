// ─────────────────────────────────────────────────────────────────────────────
// Field-service MVP — gardener app visit documentation (photos, plant health,
// materials), upsell leads, escalations, attendance and leave, plus the
// admin/supervisor review endpoints for all of it.
// ─────────────────────────────────────────────────────────────────────────────
const { Op } = require('sequelize');
const {
  Booking, User, GardenerProfile,
  VisitPhoto, PlantHealthReport, ServiceLead, VisitMaterial,
  Attendance, LeaveRequest, Escalation, ChecklistTemplate
} = require('../models');
const notificationService = require('../services/notification.service');
const { notify, sendMulticast } = require('../services/push.service');
const { todayIST } = require('../utils/time');

const BASE_URL = () => process.env.BASE_URL || 'http://localhost:3000';

const PHOTO_TYPES = ['before', 'after', 'problem', 'health'];
const MAX_PHOTOS_PER_TYPE = 10;

const HEALTH_CONDITIONS = [
  'healthy', 'needs_attention', 'pest_attack', 'overwatering', 'underwatering',
  'yellow_leaves', 'root_problem', 'fungus', 'plant_dying', 'repotting_required'
];

const LEAD_TYPES = [
  'repotting', 'new_plants', 'pots', 'vermicompost', 'pest_control',
  'lawn_service', 'balcony_makeover', 'terrace_garden', 'plant_replacement', 'other'
];

const ESCALATION_TYPES = [
  'customer_unavailable', 'access_problem', 'plant_emergency', 'accident_damage',
  'material_required', 'customer_complaint', 'need_assistance'
];

// The standard 10-task garden visit checklist (seeded on first read; admin can
// edit per service type via /admin/checklist-templates).
const DEFAULT_CHECKLIST_ITEMS = [
  { key: 'watering', label: 'Watering', required: false },
  { key: 'soil_loosening', label: 'Soil Loosening', required: false },
  { key: 'pruning', label: 'Pruning', required: false },
  { key: 'cleaning_leaves', label: 'Cleaning Leaves', required: false },
  { key: 'removing_dry_leaves', label: 'Removing Dry Leaves', required: false },
  { key: 'fertiliser_application', label: 'Fertiliser Application', required: false },
  { key: 'pest_control_treatment', label: 'Pest Control Treatment', required: false },
  { key: 'repotting', label: 'Repotting', required: false },
  { key: 'plant_positioning', label: 'Plant Positioning', required: false },
  { key: 'balcony_terrace_cleaning', label: 'Balcony/Terrace Cleaning', required: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Booking owned by the requesting gardener (or null).
const findOwnBooking = async (bookingId, gardenerId) => {
  const booking = await Booking.findByPk(bookingId);
  if (!booking || booking.gardener_id !== gardenerId) return null;
  return booking;
};

// The supervisor User assigned to a gardener (or null).
const getSupervisorOf = async (gardenerId) => {
  const profile = await GardenerProfile.findOne({ where: { user_id: gardenerId } });
  if (!profile?.supervisor_id) return null;
  return User.findByPk(profile.supervisor_id);
};

// FCM tokens of all active admins (for pushes that must reach the office).
const getAdminFcmTokens = async () => {
  const admins = await User.findAll({
    where: { role: 'admin', is_active: true, fcm_token: { [Op.not]: null } },
    attributes: ['fcm_token']
  });
  return admins.map(a => a.fcm_token).filter(Boolean);
};

// Everything recorded on a visit — shared by the gardener report endpoint and
// the admin booking-detail report.
const buildVisitReport = async (bookingId) => {
  const [photos, healthReports, materials, lead] = await Promise.all([
    VisitPhoto.findAll({ where: { booking_id: bookingId }, order: [['created_at', 'ASC']] }),
    PlantHealthReport.findAll({ where: { booking_id: bookingId }, order: [['created_at', 'DESC']] }),
    VisitMaterial.findAll({ where: { booking_id: bookingId }, order: [['created_at', 'ASC']] }),
    ServiceLead.findOne({ where: { booking_id: bookingId }, order: [['created_at', 'DESC']] }),
  ]);
  return { photos, health_reports: healthReports, materials, lead };
};

// ── GARDENER: CHECKLIST ───────────────────────────────────────────────────────
exports.getChecklist = async (req, res) => {
  try {
    const service_type = String(req.query.service_type || 'ondemand');
    if (!['ondemand', 'subscription'].includes(service_type)) {
      return res.status(400).json({ success: false, message: 'service_type must be ondemand or subscription' });
    }
    const [template] = await ChecklistTemplate.findOrCreate({
      where: { service_type },
      defaults: { items: DEFAULT_CHECKLIST_ITEMS }
    });
    res.json({ success: true, data: { service_type: template.service_type, items: template.items || [] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: VISIT PHOTOS ────────────────────────────────────────────────────
exports.uploadVisitPhoto = async (req, res) => {
  try {
    const booking = await findOwnBooking(req.params.bookingId, req.user.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const { type, latitude, longitude } = req.body;
    if (!PHOTO_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of: ${PHOTO_TYPES.join(', ')}` });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'No photo uploaded' });

    const count = await VisitPhoto.count({ where: { booking_id: booking.id, type } });
    if (count >= MAX_PHOTOS_PER_TYPE) {
      return res.status(400).json({ success: false, message: `Maximum ${MAX_PHOTOS_PER_TYPE} '${type}' photos per visit` });
    }

    const url = `${BASE_URL()}/uploads/visits/${req.file.filename}`;
    const lat = parseFloat(latitude), lng = parseFloat(longitude);
    const photo = await VisitPhoto.create({
      booking_id: booking.id,
      gardener_id: req.user.id,
      type,
      url,
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lng) ? null : lng,
      taken_at: new Date()
    });

    // Keep the legacy single-image columns in sync so existing admin/customer
    // displays (before/after strip) keep working.
    if (type === 'before' && !booking.before_image) await booking.update({ before_image: url });
    if (type === 'after' && !booking.after_image) await booking.update({ after_image: url });

    res.json({ success: true, message: 'Photo uploaded', data: photo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: VISIT REPORT (aggregate) ────────────────────────────────────────
exports.getVisitReport = async (req, res) => {
  try {
    const booking = await findOwnBooking(req.params.bookingId, req.user.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    const report = await buildVisitReport(booking.id);
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: PLANT HEALTH ────────────────────────────────────────────────────
exports.createHealthReport = async (req, res) => {
  try {
    const booking = await findOwnBooking(req.params.bookingId, req.user.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const { conditions, remarks, photo_url } = req.body;
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return res.status(400).json({ success: false, message: 'conditions must be a non-empty array' });
    }
    const invalid = conditions.filter(c => !HEALTH_CONDITIONS.includes(c));
    if (invalid.length) {
      return res.status(400).json({ success: false, message: `Invalid condition(s): ${invalid.join(', ')}` });
    }

    const report = await PlantHealthReport.create({
      booking_id: booking.id,
      gardener_id: req.user.id,
      conditions,
      remarks: remarks || null,
      photo_url: photo_url || null
    });
    res.json({ success: true, message: 'Health report saved', data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: MATERIALS USED ──────────────────────────────────────────────────
exports.addMaterials = async (req, res) => {
  try {
    const booking = await findOwnBooking(req.params.bookingId, req.user.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items must be a non-empty array of { item, quantity, unit? }' });
    }
    for (const it of items) {
      if (!it || typeof it.item !== 'string' || !it.item.trim()) {
        return res.status(400).json({ success: false, message: 'Every material needs an item name' });
      }
    }

    const rows = await VisitMaterial.bulkCreate(items.map(it => ({
      booking_id: booking.id,
      gardener_id: req.user.id,
      item: it.item.trim().slice(0, 100),
      quantity: it.quantity != null ? String(it.quantity).slice(0, 50) : null,
      unit: it.unit != null ? String(it.unit).slice(0, 20) : null
    })));
    res.json({ success: true, message: 'Materials recorded', data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: SERVICE LEADS (upsell) ──────────────────────────────────────────
exports.createLead = async (req, res) => {
  try {
    const { booking_id, type, note } = req.body;
    if (!LEAD_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of: ${LEAD_TYPES.join(', ')}` });
    }

    let customer_id = null;
    if (booking_id) {
      const booking = await findOwnBooking(booking_id, req.user.id);
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
      customer_id = booking.customer_id;
    }

    const lead = await ServiceLead.create({
      booking_id: booking_id || null,
      customer_id,
      gardener_id: req.user.id,
      type,
      note: note || null
    });

    // Notify the office: all admins (in-app) + the gardener's supervisor (in-app + push).
    const title = '🌱 New Service Lead';
    const body = `🌱 New service lead from ${req.user.name}: ${type}`;
    const data = { lead_id: lead.id, gardener_id: req.user.id, type };
    await notificationService.notifyAdmins({ title, body, type: 'service_lead', data });
    const supervisor = await getSupervisorOf(req.user.id);
    if (supervisor) {
      await notificationService.notifyUser(supervisor.id, { title, body, type: 'service_lead', data });
      if (supervisor.fcm_token) await notify.custom(supervisor.fcm_token, title, body, data);
    }

    res.json({ success: true, message: 'Lead submitted', data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMyLeads = async (req, res) => {
  try {
    const leads = await ServiceLead.findAll({
      where: { gardener_id: req.user.id },
      order: [['created_at', 'DESC']],
      include: [{ model: Booking, as: 'booking', attributes: ['id', 'booking_number', 'scheduled_date'] }]
    });
    res.json({ success: true, data: leads });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: ESCALATIONS ─────────────────────────────────────────────────────
exports.createEscalation = async (req, res) => {
  try {
    const { booking_id, type, note } = req.body;
    if (!ESCALATION_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of: ${ESCALATION_TYPES.join(', ')}` });
    }

    let booking = null;
    if (booking_id) {
      booking = await findOwnBooking(booking_id, req.user.id);
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const photo_url = req.file ? `${BASE_URL()}/uploads/visits/${req.file.filename}` : null;
    const escalation = await Escalation.create({
      booking_id: booking ? booking.id : null,
      gardener_id: req.user.id,
      type,
      note: note || null,
      photo_url
    });

    // Alert supervisor + admins immediately (in-app + push where tokens exist).
    const title = '⚠️ Escalation';
    const body = `⚠️ Escalation: ${type} — ${req.user.name}${booking ? `, booking #${booking.booking_number || booking.id}` : ''}`;
    const data = { escalation_id: escalation.id, gardener_id: req.user.id, type, booking_id: booking ? booking.id : '' };
    await notificationService.notifyAdmins({ title, body, type: 'escalation', data });
    const supervisor = await getSupervisorOf(req.user.id);
    if (supervisor) {
      await notificationService.notifyUser(supervisor.id, { title, body, type: 'escalation', data });
      if (supervisor.fcm_token) await notify.custom(supervisor.fcm_token, title, body, data);
    }
    const adminTokens = await getAdminFcmTokens();
    if (adminTokens.length) await sendMulticast(adminTokens, title, body, data);

    res.json({ success: true, message: 'Escalation raised', data: escalation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: ATTENDANCE ──────────────────────────────────────────────────────
exports.checkin = async (req, res) => {
  try {
    const date = todayIST();
    const existing = await Attendance.findOne({ where: { gardener_id: req.user.id, date } });
    if (existing?.checkin_at) {
      return res.status(409).json({ success: false, message: 'Already checked in today' });
    }
    const lat = parseFloat(req.body?.latitude), lng = parseFloat(req.body?.longitude);
    const values = {
      checkin_at: new Date(),
      checkin_lat: isNaN(lat) ? null : lat,
      checkin_lng: isNaN(lng) ? null : lng
    };
    const row = existing
      ? await existing.update(values)
      : await Attendance.create({ gardener_id: req.user.id, date, ...values });
    res.json({ success: true, message: 'Checked in', data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.checkout = async (req, res) => {
  try {
    const date = todayIST();
    const row = await Attendance.findOne({ where: { gardener_id: req.user.id, date } });
    if (!row?.checkin_at) return res.status(400).json({ success: false, message: 'Not checked in today' });
    if (row.checkout_at) return res.status(409).json({ success: false, message: 'Already checked out today' });

    const lat = parseFloat(req.body?.latitude), lng = parseFloat(req.body?.longitude);
    const checkout_at = new Date();
    const hours = Math.max(0, (checkout_at - new Date(row.checkin_at)) / 3600000);
    await row.update({
      checkout_at,
      checkout_lat: isNaN(lat) ? null : lat,
      checkout_lng: isNaN(lng) ? null : lng,
      hours: hours.toFixed(2)
    });
    res.json({ success: true, message: 'Checked out', data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMyAttendance = async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : todayIST().slice(0, 7);
    const rows = await Attendance.findAll({
      where: { gardener_id: req.user.id, date: { [Op.between]: [`${month}-01`, `${month}-31`] } },
      order: [['date', 'ASC']]
    });
    const summary = {
      days_present: rows.filter(r => r.checkin_at).length,
      total_hours: +rows.reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0).toFixed(2)
    };
    res.json({ success: true, data: { month, rows, summary } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTodayAttendance = async (req, res) => {
  try {
    const row = await Attendance.findOne({ where: { gardener_id: req.user.id, date: todayIST() } });
    res.json({ success: true, data: row || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: LEAVES ──────────────────────────────────────────────────────────
exports.createLeave = async (req, res) => {
  try {
    const { from_date, to_date, reason } = req.body;
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    if (!isDate(from_date) || !isDate(to_date)) {
      return res.status(400).json({ success: false, message: 'from_date and to_date are required (YYYY-MM-DD)' });
    }
    if (to_date < from_date) return res.status(400).json({ success: false, message: 'to_date must be on/after from_date' });

    const leave = await LeaveRequest.create({
      gardener_id: req.user.id,
      from_date,
      to_date,
      reason: String(reason || '').slice(0, 300)
    });

    // Let the supervisor + admins know a leave needs review.
    const title = '🗓️ Leave Request';
    const body = `${req.user.name} requested leave ${from_date} → ${to_date}`;
    const data = { leave_id: leave.id, gardener_id: req.user.id };
    await notificationService.notifyAdmins({ title, body, type: 'leave_request', data });
    const supervisor = await getSupervisorOf(req.user.id);
    if (supervisor) {
      await notificationService.notifyUser(supervisor.id, { title, body, type: 'leave_request', data });
      if (supervisor.fcm_token) await notify.custom(supervisor.fcm_token, title, body, data);
    }

    res.json({ success: true, message: 'Leave request submitted', data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMyLeaves = async (req, res) => {
  try {
    const leaves = await LeaveRequest.findAll({ where: { gardener_id: req.user.id }, order: [['created_at', 'DESC']] });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GARDENER: MY SUPERVISOR ───────────────────────────────────────────────────
exports.getMySupervisor = async (req, res) => {
  try {
    const supervisor = await getSupervisorOf(req.user.id);
    res.json({ success: true, data: supervisor ? { name: supervisor.name, phone: supervisor.phone } : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ADMIN/SUPERVISOR: LEADS ───────────────────────────────────────────────────
exports.adminGetLeads = async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const leads = await ServiceLead.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone'] },
        { model: Booking, as: 'booking', attributes: ['id', 'booking_number', 'scheduled_date', 'service_address'] }
      ]
    });
    res.json({ success: true, data: leads });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminReviewLead = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be approved or rejected' });
    }
    const lead = await ServiceLead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    await lead.update({ status, reviewed_by: req.user.id, reviewed_at: new Date() });

    // Tell the gardener the outcome (in-app + push).
    const title = status === 'approved' ? '✅ Lead Approved' : '❌ Lead Rejected';
    const body = `Your lead was ${status}`;
    const data = { lead_id: lead.id, status };
    await notificationService.notifyUser(lead.gardener_id, { title, body, type: 'service_lead', data });
    const gardener = await User.findByPk(lead.gardener_id);
    if (gardener?.fcm_token) await notify.custom(gardener.fcm_token, title, body, data);

    res.json({ success: true, message: `Lead ${status}`, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ADMIN/SUPERVISOR: ESCALATIONS ─────────────────────────────────────────────
exports.adminGetEscalations = async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const escalations = await Escalation.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
        { model: Booking, as: 'booking', attributes: ['id', 'booking_number', 'scheduled_date', 'service_address'] }
      ]
    });
    res.json({ success: true, data: escalations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminResolveEscalation = async (req, res) => {
  try {
    const escalation = await Escalation.findByPk(req.params.id);
    if (!escalation) return res.status(404).json({ success: false, message: 'Escalation not found' });
    if (escalation.status === 'resolved') return res.status(409).json({ success: false, message: 'Escalation already resolved' });

    await escalation.update({ status: 'resolved', resolved_by: req.user.id, resolved_at: new Date() });
    await notificationService.notifyUser(escalation.gardener_id, {
      title: '✅ Escalation Resolved',
      body: `Your escalation (${escalation.type}) has been resolved.`,
      type: 'escalation',
      data: { escalation_id: escalation.id }
    });
    res.json({ success: true, message: 'Escalation resolved', data: escalation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ADMIN/SUPERVISOR: ATTENDANCE ──────────────────────────────────────────────
exports.adminGetAttendance = async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : todayIST();
    const where = { date };
    // Supervisors only see their own team.
    if (req.user.role === 'supervisor') {
      const team = await GardenerProfile.findAll({ where: { supervisor_id: req.user.id }, attributes: ['user_id'] });
      where.gardener_id = { [Op.in]: team.length ? team.map(p => p.user_id) : [0] };
    }
    const rows = await Attendance.findAll({
      where,
      order: [['checkin_at', 'ASC']],
      include: [{ model: User, as: 'gardener', attributes: ['id', 'name', 'phone', 'profile_image'] }]
    });
    res.json({ success: true, data: { date, rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ADMIN/SUPERVISOR: LEAVES ──────────────────────────────────────────────────
exports.adminGetLeaves = async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.user.role === 'supervisor') {
      const team = await GardenerProfile.findAll({ where: { supervisor_id: req.user.id }, attributes: ['user_id'] });
      where.gardener_id = { [Op.in]: team.length ? team.map(p => p.user_id) : [0] };
    }
    const leaves = await LeaveRequest.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [{ model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] }]
    });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminReviewLeave = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be approved or rejected' });
    }
    const leave = await LeaveRequest.findByPk(req.params.id);
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found' });

    await leave.update({ status, reviewed_by: req.user.id, reviewed_at: new Date() });

    const title = status === 'approved' ? '✅ Leave Approved' : '❌ Leave Rejected';
    const body = `Your leave request (${leave.from_date} → ${leave.to_date}) was ${status}.`;
    const data = { leave_id: leave.id, status };
    await notificationService.notifyUser(leave.gardener_id, { title, body, type: 'leave_request', data });
    const gardener = await User.findByPk(leave.gardener_id);
    if (gardener?.fcm_token) await notify.custom(gardener.fcm_token, title, body, data);

    res.json({ success: true, message: `Leave ${status}`, data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ADMIN/SUPERVISOR: CHECKLIST TEMPLATES ─────────────────────────────────────
exports.adminGetChecklistTemplates = async (req, res) => {
  try {
    const templates = await ChecklistTemplate.findAll({ order: [['service_type', 'ASC']] });
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.adminUpdateChecklistTemplate = async (req, res) => {
  try {
    const { service_type } = req.params;
    if (!['ondemand', 'subscription'].includes(service_type)) {
      return res.status(400).json({ success: false, message: 'service_type must be ondemand or subscription' });
    }
    const { items } = req.body;
    const valid = Array.isArray(items) && items.length > 0 && items.every(it =>
      it && typeof it === 'object'
      && typeof it.key === 'string' && it.key.trim()
      && typeof it.label === 'string' && it.label.trim()
      && typeof it.required === 'boolean'
    );
    if (!valid) {
      return res.status(400).json({ success: false, message: 'items must be a non-empty array of { key, label, required: boolean }' });
    }
    const clean = items.map(it => ({ key: it.key.trim(), label: it.label.trim(), required: it.required }));
    const [template, created] = await ChecklistTemplate.findOrCreate({
      where: { service_type },
      defaults: { items: clean }
    });
    if (!created) await template.update({ items: clean });
    res.json({ success: true, message: 'Checklist template saved', data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ADMIN/SUPERVISOR: VISIT REPORT ────────────────────────────────────────────
exports.adminGetVisitReport = async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    const report = await buildVisitReport(booking.id);
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
