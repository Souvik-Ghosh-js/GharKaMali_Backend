const {
  Complaint, ComplaintDepartment, ComplaintComment, ComplaintAttachment,
  ComplaintStatusHistory, User, Booking, GardenerProfile, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { sendWhatsApp } = require('../services/otp.service');

const BASE_URL = () => process.env.BASE_URL || 'http://localhost:3000';

const buildAttachments = (files = [], { complaint_id, comment_id = null, uploaded_by }) =>
  files.map(f => ({
    complaint_id,
    comment_id,
    uploaded_by,
    file_url: `${BASE_URL()}/uploads/complaints/${f.filename}`,
    file_name: f.originalname,
    file_type: f.mimetype,
    file_size: f.size,
  }));

const ticketNo = (id) => `TKT-${String(id).padStart(6, '0')}`;

// Detail include set (used in several places)
const detailInclude = (showInternal = true) => [
  { model: User, as: 'customer', attributes: ['id', 'name', 'phone'] },
  { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
  { model: User, as: 'assignedTo', attributes: ['id', 'name', 'role'] },
  { model: Booking, as: 'booking', attributes: ['booking_number', 'scheduled_date'] },
  { model: ComplaintDepartment, as: 'department', attributes: ['id', 'name'] },
  {
    model: ComplaintComment, as: 'comments',
    ...(showInternal ? {} : { where: { is_internal: false }, required: false }),
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'role'] },
      { model: ComplaintAttachment, as: 'attachments' },
    ],
  },
  { model: ComplaintAttachment, as: 'attachments', where: { comment_id: null }, required: false },
  {
    model: ComplaintStatusHistory, as: 'history',
    include: [{ model: User, as: 'changedBy', attributes: ['id', 'name', 'role'] }],
  },
];

// ── Customer: raise a complaint ───────────────────────────────────────────────
exports.raiseComplaint = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { booking_id, type, description, priority, subject, department_id, geofence_id } = req.body;
    if (!booking_id) { await t.rollback(); return res.status(400).json({ success: false, message: 'Order ID is required to raise a complaint' }); }

    const booking = await Booking.findByPk(booking_id);
    if (!booking) { await t.rollback(); return res.status(404).json({ success: false, message: 'Booking not found' }); }
    if (booking.customer_id !== req.user.id) { await t.rollback(); return res.status(403).json({ success: false, message: 'Not your booking' }); }

    const complaint = await Complaint.create({
      booking_id,
      customer_id: req.user.id,
      gardener_id: booking.gardener_id,
      geofence_id: geofence_id || null,
      department_id: department_id || null,
      subject: subject || null,
      type, description,
      priority: priority || 'medium',
      status: 'open',
    }, { transaction: t });

    await complaint.update({ ticket_number: ticketNo(complaint.id) }, { transaction: t });

    await ComplaintStatusHistory.create({
      complaint_id: complaint.id, from_status: null, to_status: 'open',
      changed_by: req.user.id, note: 'Ticket opened',
    }, { transaction: t });

    // Auto-assign supervisor if gardener has one
    if (booking.gardener_id) {
      const profile = await GardenerProfile.findOne({ where: { user_id: booking.gardener_id } });
      if (profile?.supervisor_id) {
        await complaint.update({ assigned_to: profile.supervisor_id }, { transaction: t });
      }
    }

    // Save attachments (if any)
    if (req.files?.length) {
      await ComplaintAttachment.bulkCreate(
        buildAttachments(req.files, { complaint_id: complaint.id, uploaded_by: req.user.id }),
        { transaction: t },
      );
    }

    await t.commit();

    // Notifications (best-effort, outside txn)
    try {
      if (complaint.assigned_to) {
        const sup = await User.findByPk(complaint.assigned_to);
        if (sup) await sendWhatsApp(sup.phone, `⚠️ *GharKaMali — New Ticket*\n${complaint.ticket_number} assigned to you.\nType: ${type}\nPriority: ${priority || 'medium'}`);
      }
      const customer = await User.findByPk(req.user.id);
      if (customer) await sendWhatsApp(customer.phone, `✅ *GharKaMali*\nTicket ${complaint.ticket_number} registered. We'll respond within 24 hours.`);
    } catch (e) { /* notification failure should not break flow */ }

    const created = await Complaint.findByPk(complaint.id, { include: detailInclude(false) });
    res.status(201).json({ success: true, message: 'Complaint raised successfully', data: created });
  } catch (err) {
    await t.rollback().catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Customer: my complaints (list) ────────────────────────────────────────────
exports.getMyComplaints = async (req, res) => {
  try {
    const complaints = await Complaint.findAll({
      where: { customer_id: req.user.id },
      include: [
        { model: Booking, as: 'booking', attributes: ['booking_number', 'scheduled_date'] },
        { model: User, as: 'gardener', attributes: ['name', 'phone'] },
        { model: ComplaintDepartment, as: 'department', attributes: ['id', 'name'] },
        { model: User, as: 'assignedTo', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
    });
    res.json({ success: true, data: complaints });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Admin/Supervisor: list all complaints ────────────────────────────────────
exports.getAllComplaints = async (req, res) => {
  try {
    const { status, priority, department_id, assigned_to, search, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (department_id) where.department_id = department_id;
    if (assigned_to) where.assigned_to = assigned_to;
    if (search) {
      where[Op.or] = [
        { ticket_number: { [Op.like]: `%${search}%` } },
        { subject: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }
    if (req.user.role === 'supervisor') where.assigned_to = req.user.id;

    const { count, rows } = await Complaint.findAndCountAll({
      where,
      include: [
        { model: User, as: 'customer', attributes: ['id', 'name', 'phone'] },
        { model: User, as: 'gardener', attributes: ['id', 'name', 'phone'] },
        { model: User, as: 'assignedTo', attributes: ['id', 'name', 'role'] },
        { model: Booking, as: 'booking', attributes: ['booking_number', 'scheduled_date'] },
        { model: ComplaintDepartment, as: 'department', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
      distinct: true,
    });
    res.json({ success: true, data: { complaints: rows, total: count, page: parseInt(page) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Single ticket detail (customer-owned or staff) ───────────────────────────
exports.getComplaintDetail = async (req, res) => {
  try {
    const isStaff = ['admin', 'supervisor'].includes(req.user.role);
    const complaint = await Complaint.findByPk(req.params.id, { include: detailInclude(isStaff) });
    if (!complaint) return res.status(404).json({ success: false, message: 'Ticket not found' });
    if (!isStaff && complaint.customer_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not your ticket' });
    res.json({ success: true, data: complaint });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Add comment (and/or attachments) ─────────────────────────────────────────
exports.addComment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const complaint = await Complaint.findByPk(req.params.id);
    if (!complaint) { await t.rollback(); return res.status(404).json({ success: false, message: 'Ticket not found' }); }
    const isStaff = ['admin', 'supervisor'].includes(req.user.role);
    if (!isStaff && complaint.customer_id !== req.user.id) {
      await t.rollback();
      return res.status(403).json({ success: false, message: 'Not your ticket' });
    }
    const { comment, is_internal } = req.body;
    const text = (comment || '').trim();
    const files = req.files || [];
    if (!text && files.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Comment or attachment is required' });
    }

    let created = null;
    if (text) {
      created = await ComplaintComment.create({
        complaint_id: complaint.id,
        user_id: req.user.id,
        user_role: req.user.role,
        comment: text,
        is_internal: isStaff ? (is_internal === 'true' || is_internal === true) : false,
      }, { transaction: t });
    }
    if (files.length) {
      await ComplaintAttachment.bulkCreate(
        buildAttachments(files, { complaint_id: complaint.id, comment_id: created?.id || null, uploaded_by: req.user.id }),
        { transaction: t },
      );
    }
    // Customer reply moves status back to in_review (if it was awaiting_customer)
    if (!isStaff && complaint.status === 'awaiting_customer') {
      await complaint.update({ status: 'in_review' }, { transaction: t });
      await ComplaintStatusHistory.create({
        complaint_id: complaint.id, from_status: 'awaiting_customer', to_status: 'in_review',
        changed_by: req.user.id, note: 'Customer responded',
      }, { transaction: t });
    }
    await t.commit();

    const full = await Complaint.findByPk(complaint.id, { include: detailInclude(isStaff) });
    res.status(201).json({ success: true, message: 'Comment added', data: full });
  } catch (err) {
    await t.rollback().catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Update complaint (assign / status / dept / priority) ─────────────────────
exports.updateComplaint = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { status, resolution_notes, assigned_to, priority, department_id, subject, due_date } = req.body;
    const complaint = await Complaint.findByPk(req.params.id);
    if (!complaint) { await t.rollback(); return res.status(404).json({ success: false, message: 'Ticket not found' }); }

    const updates = {};
    const prevStatus = complaint.status;
    if (status) updates.status = status;
    if (resolution_notes != null) updates.resolution_notes = resolution_notes;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;
    if (priority) updates.priority = priority;
    if (department_id !== undefined) updates.department_id = department_id || null;
    if (subject !== undefined) updates.subject = subject;
    if (due_date !== undefined) updates.due_date = due_date || null;

    if (status && (status === 'resolved' || status === 'closed')) {
      updates.resolved_at = new Date();
      updates.resolved_by = req.user.id;
    }

    await complaint.update(updates, { transaction: t });

    if (status && status !== prevStatus) {
      await ComplaintStatusHistory.create({
        complaint_id: complaint.id, from_status: prevStatus, to_status: status,
        changed_by: req.user.id, note: resolution_notes || null,
      }, { transaction: t });
    }

    if (status === 'resolved' && complaint.gardener_id) {
      const { RewardPenalty } = require('../models');
      await RewardPenalty.create({
        gardener_id: complaint.gardener_id, type: 'penalty', amount: 50,
        reason: `Complaint resolution: ${complaint.type}`,
        description: `${complaint.ticket_number} resolved against gardener`,
        status: 'applied', applied_at: new Date(),
      }, { transaction: t });
    }

    await t.commit();

    // notifications (best-effort)
    try {
      if (status === 'resolved' || status === 'closed') {
        const customer = await User.findByPk(complaint.customer_id);
        if (customer) await sendWhatsApp(customer.phone, `✅ *GharKaMali*\nTicket ${complaint.ticket_number} has been ${status}.\n${resolution_notes ? `Resolution: ${resolution_notes}` : ''}`);
      }
      if (assigned_to && assigned_to !== complaint.assigned_to) {
        const sup = await User.findByPk(assigned_to);
        if (sup) await sendWhatsApp(sup.phone, `📋 *GharKaMali*\nTicket ${complaint.ticket_number} assigned to you.`);
      }
    } catch (_) {}

    const updated = await Complaint.findByPk(complaint.id, { include: detailInclude(true) });
    res.json({ success: true, data: updated });
  } catch (err) {
    await t.rollback().catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Stats (dashboard widgets) ────────────────────────────────────────────────
exports.getComplaintStats = async (req, res) => {
  try {
    const where = req.user.role === 'supervisor' ? { assigned_to: req.user.id } : {};
    const [open, inProgress, inReview, awaiting, resolved, closed, high] = await Promise.all([
      Complaint.count({ where: { ...where, status: 'open' } }),
      Complaint.count({ where: { ...where, status: 'in_progress' } }),
      Complaint.count({ where: { ...where, status: 'in_review' } }),
      Complaint.count({ where: { ...where, status: 'awaiting_customer' } }),
      Complaint.count({ where: { ...where, status: 'resolved' } }),
      Complaint.count({ where: { ...where, status: 'closed' } }),
      Complaint.count({ where: { ...where, priority: 'high', status: { [Op.in]: ['open', 'in_progress', 'in_review', 'awaiting_customer'] } } }),
    ]);
    res.json({ success: true, data: { open, inProgress, inReview, awaitingCustomer: awaiting, resolved, closed, highPriority: high } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Departments ──────────────────────────────────────────────────────────────
exports.listDepartments = async (req, res) => {
  try {
    const where = req.user?.role === 'admin' ? {} : { is_active: true };
    const depts = await ComplaintDepartment.findAll({ where, order: [['name', 'ASC']] });
    res.json({ success: true, data: depts });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createDepartment = async (req, res) => {
  try {
    const { name, description, is_active } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name required' });
    const dept = await ComplaintDepartment.create({ name, description, is_active: is_active !== false });
    res.status(201).json({ success: true, data: dept });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateDepartment = async (req, res) => {
  try {
    const dept = await ComplaintDepartment.findByPk(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: 'Not found' });
    await dept.update(req.body);
    res.json({ success: true, data: dept });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteDepartment = async (req, res) => {
  try {
    await ComplaintDepartment.update({ is_active: false }, { where: { id: req.params.id } });
    res.json({ success: true, message: 'Department deactivated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Assignable users (admin + supervisor list for assignment dropdown) ───────
exports.getAssignees = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { role: { [Op.in]: ['admin', 'supervisor'] }, is_active: true },
      attributes: ['id', 'name', 'role'],
      order: [['role', 'ASC'], ['name', 'ASC']],
    });
    res.json({ success: true, data: users });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
