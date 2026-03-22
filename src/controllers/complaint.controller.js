const { Complaint, User, Booking, GardenerProfile } = require('../models');
const { Op } = require('sequelize');
const { sendWhatsApp } = require('../services/otp.service');

// ── Customer: raise a complaint ───────────────────────────────────────────────
exports.raiseComplaint = async (req, res) => {
  try {
    const { booking_id, type, description, priority } = req.body;

    let gardener_id = null;
    if (booking_id) {
      const booking = await Booking.findByPk(booking_id);
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
      if (booking.customer_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your booking' });
      gardener_id = booking.gardener_id;
    }

    const complaint = await Complaint.create({
      booking_id:  booking_id || null,
      customer_id: req.user.id,
      gardener_id,
      type,
      description,
      priority:    priority || 'medium',
      status:      'open',
    });

    // Auto-assign to a supervisor if one oversees this gardener
    if (gardener_id) {
      const profile = await GardenerProfile.findOne({ where: { user_id: gardener_id } });
      if (profile?.supervisor_id) {
        await complaint.update({ assigned_to: profile.supervisor_id });
        const supervisor = await User.findByPk(profile.supervisor_id);
        if (supervisor) {
          await sendWhatsApp(
            supervisor.phone,
            `⚠️ *Ghar Ka Mali — New Complaint*\nComplaint #${complaint.id} assigned to you.\nType: ${type}\nPriority: ${priority || 'medium'}\nPlease review and resolve in the admin panel.`
          );
        }
      }
    }

    const customer = await User.findByPk(req.user.id);
    if (customer) {
      await sendWhatsApp(
        customer.phone,
        `✅ *Ghar Ka Mali*\nYour complaint #${complaint.id} has been registered. Our team will review and respond within 24 hours.`
      );
    }

    res.status(201).json({ success: true, message: 'Complaint raised successfully', data: complaint });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Customer: get my complaints ───────────────────────────────────────────────
exports.getMyComplaints = async (req, res) => {
  try {
    const complaints = await Complaint.findAll({
      where: { customer_id: req.user.id },
      include: [
        { model: Booking, as: 'booking', attributes: ['booking_number', 'scheduled_date'] },
        { model: User,    as: 'gardener', attributes: ['name', 'phone'] },
      ],
      order: [['created_at', 'DESC']],
    });
    res.json({ success: true, data: complaints });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/Supervisor: get all complaints ──────────────────────────────────────
exports.getAllComplaints = async (req, res) => {
  try {
    const { status, priority, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;

    // Supervisors only see their assigned complaints
    if (req.user.role === 'supervisor') where.assigned_to = req.user.id;

    const { count, rows } = await Complaint.findAndCountAll({
      where,
      include: [
        { model: User,    as: 'customer',   attributes: ['id', 'name', 'phone'] },
        { model: User,    as: 'gardener',   attributes: ['id', 'name', 'phone'] },
        { model: User,    as: 'assignedTo', attributes: ['id', 'name'] },
        { model: Booking, as: 'booking',    attributes: ['booking_number', 'scheduled_date'] },
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
    });

    res.json({ success: true, data: { complaints: rows, total: count, page: parseInt(page) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: update complaint (assign / resolve) ────────────────────────────────
exports.updateComplaint = async (req, res) => {
  try {
    const { status, resolution_notes, assigned_to, priority } = req.body;
    const complaint = await Complaint.findByPk(req.params.id);
    if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found' });

    const updates = {};
    if (status)           updates.status = status;
    if (resolution_notes) updates.resolution_notes = resolution_notes;
    if (assigned_to)      updates.assigned_to = assigned_to;
    if (priority)         updates.priority = priority;

    if (status === 'resolved' || status === 'closed') {
      updates.resolved_at = new Date();
      updates.resolved_by = req.user.id;

      // Notify customer
      const customer = await User.findByPk(complaint.customer_id);
      if (customer) {
        await sendWhatsApp(
          customer.phone,
          `✅ *Ghar Ka Mali*\nYour complaint #${complaint.id} has been resolved.\n${resolution_notes ? `Resolution: ${resolution_notes}` : 'Our team has addressed your concern.'}\nThank you for your patience.`
        );
      }

      // Auto-apply penalty to gardener if complaint is valid
      if (complaint.gardener_id && status === 'resolved') {
        const { RewardPenalty } = require('../models');
        await RewardPenalty.create({
          gardener_id: complaint.gardener_id,
          type:        'penalty',
          amount:      50,
          reason:      `Complaint resolution: ${complaint.type}`,
          description: `Complaint #${complaint.id} resolved against gardener`,
          status:      'applied',
          applied_at:  new Date(),
        });
      }
    }

    // Notify supervisor when assigned
    if (assigned_to && assigned_to !== complaint.assigned_to) {
      const supervisor = await User.findByPk(assigned_to);
      if (supervisor) {
        await sendWhatsApp(
          supervisor.phone,
          `📋 *Ghar Ka Mali*\nComplaint #${complaint.id} has been assigned to you for review. Please address within 24 hours.`
        );
      }
    }

    await complaint.update(updates);
    const updated = await Complaint.findByPk(complaint.id, {
      include: [
        { model: User, as: 'customer',   attributes: ['id', 'name', 'phone'] },
        { model: User, as: 'gardener',   attributes: ['id', 'name'] },
        { model: User, as: 'assignedTo', attributes: ['id', 'name'] },
      ],
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Complaint stats for dashboard ─────────────────────────────────────────────
exports.getComplaintStats = async (req, res) => {
  try {
    const where = req.user.role === 'supervisor' ? { assigned_to: req.user.id } : {};
    const [open, inReview, resolved, high] = await Promise.all([
      Complaint.count({ where: { ...where, status: 'open' } }),
      Complaint.count({ where: { ...where, status: 'in_review' } }),
      Complaint.count({ where: { ...where, status: 'resolved' } }),
      Complaint.count({ where: { ...where, priority: 'high', status: { [Op.in]: ['open', 'in_review'] } } }),
    ]);
    res.json({ success: true, data: { open, inReview, resolved, highPriority: high } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
