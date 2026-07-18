// ─────────────────────────────────────────────────────────────────────────────
// Manual Invoice / Booking — admin-driven flow for offline customers.
//
// One form → three possible outcomes (chosen via `outcome`):
//   • invoice_only  : save a ManualInvoice + generate PDF. No booking. No user.
//   • booking       : find/create the customer, create a real Booking (normal
//                     flow — assigned or pending), link a ManualInvoice to it.
//   • subscription  : create a real Subscription (+ optionally schedule visits),
//                     link a ManualInvoice to it.
//
// GST is computed the SAME way as the invoice service (GST-inclusive total; the
// split is total/1.18), so the generated invoice matches every other channel.
// ─────────────────────────────────────────────────────────────────────────────
const { Op } = require('sequelize');
const {
  ManualInvoice, Booking, Subscription, ServicePlan, Geofence, GardenerZone,
  GardenerProfile, User, sequelize,
} = require('../models');
const { nowIST, todayIST } = require('../utils/time');

const GST_RATE = 0.18;
const ADDITIONAL_PLANT_RATE = 25;

const genInvoiceNumber = () => `INV${Date.now().toString().slice(-8)}`;
const genBookingNumber = () => `GKM${Date.now().toString().slice(-8)}`;
const genVisitOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

// Same intra-state test as invoice.service.js / the website.
const isUPAddress = (...parts) => {
  const addr = parts.filter(Boolean).join(' ').toLowerCase();
  return addr.includes('uttar pradesh') || addr === 'up' || addr.includes('noida') ||
    addr.includes('greater noida') || addr.includes('ghaziabad');
};

// Find a customer by phone, or create a lightweight one (walk-in / offline).
async function findOrCreateCustomer({ phone, name, email, city, state, pincode, address }, t) {
  if (!phone) return null;
  let user = await User.findOne({ where: { phone }, transaction: t });
  if (!user) {
    user = await User.create({
      name: name || 'Customer', phone, email: email || null,
      role: 'customer', is_active: true, is_approved: true,
      city: city || null, state: state || null, pincode: pincode || null,
      address: address || null,
    }, { transaction: t });
  }
  return user;
}

// Build the priced line items + GST-inclusive total for the form.
// If `override_total` is provided (> 0), it becomes the GST-INCLUSIVE total and
// the base is back-computed; otherwise the total is derived from the items.
function priceInvoice({ items, override_total }) {
  const baseSum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  let total;
  if (override_total != null && Number(override_total) > 0) {
    total = Math.round(Number(override_total) * 100) / 100;
  } else {
    total = Math.round(baseSum * (1 + GST_RATE) * 100) / 100;
  }
  const subtotal = Math.round((total / (1 + GST_RATE)) * 100) / 100;
  const gst_amount = Math.round((total - subtotal) * 100) / 100;
  return { total, subtotal, gst_amount };
}

// ── CREATE ───────────────────────────────────────────────────────────────────
exports.createManualInvoice = async (req, res) => {
  const {
    outcome = 'invoice_only',           // invoice_only | booking | subscription
    invoice_type = 'ondemand',          // ondemand | plan
    plan_id,
    // customer
    customer_name, customer_phone, customer_email,
    service_address, city, state, pincode,
    // service details
    scheduled_date, scheduled_time, plant_count, notes,
    zone_id, geofence_id,
    // pricing
    line_items,                          // optional [{name, amount}] custom lines
    override_total,                      // optional GST-inclusive override
    // gardener (booking outcome)
    assign_mode = 'none',                // none | pick | auto
    gardener_id: pickedGardenerId,
    // subscription outcome
    schedule_dates,                      // optional string[] of YYYY-MM-DD
  } = req.body;

  if (!customer_name) {
    return res.status(400).json({ success: false, message: 'customer_name is required' });
  }
  if ((outcome === 'booking' || outcome === 'subscription') && !customer_phone) {
    return res.status(400).json({ success: false, message: 'customer_phone is required to create a record' });
  }

  try {
    // Resolve the plan (for plan invoices / subscriptions).
    const plan = plan_id ? await ServicePlan.findByPk(plan_id) : null;
    if ((invoice_type === 'plan' || outcome === 'subscription') && !plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    // Build line items. Prefer explicit custom lines; else derive from plan/zone.
    let items = Array.isArray(line_items) && line_items.length
      ? line_items.map((l) => ({ name: String(l.name || 'Item'), amount: Number(l.amount) || 0 }))
      : [];

    if (!items.length) {
      if (plan) {
        items = [{ name: `${plan.name} Plan${plan.visits_per_month ? ` — ${plan.visits_per_month} visits/month` : ''}`, amount: Number(plan.price) || 0 }];
      } else {
        // On-demand: zone base + ₹25 per extra plant (matches createBooking).
        const zone = (geofence_id || zone_id) ? await Geofence.findByPk(geofence_id || zone_id) : null;
        const base = zone ? (parseFloat(zone.base_price) || 0) : 0;
        const extra = (parseInt(plant_count) || 0) * ADDITIONAL_PLANT_RATE;
        items = [{ name: `On-Demand Gardener Visit (${plant_count || 0} plants)`, amount: base + extra }];
      }
    }

    const { total, subtotal, gst_amount } = priceInvoice({ items, override_total });
    const isUP = isUPAddress(service_address, city, state);

    // Everything (customer creation + record + invoice) in one transaction.
    const result = await sequelize.transaction(async (t) => {
      let customer = null;
      let booking = null;
      let subscription = null;

      if (outcome === 'booking' || outcome === 'subscription') {
        customer = await findOrCreateCustomer(
          { phone: customer_phone, name: customer_name, email: customer_email, city, state, pincode, address: service_address },
          t
        );
      }

      // ── Create a real Booking ──
      if (outcome === 'booking') {
        let gardener_id = null;
        const activeZoneId = geofence_id || zone_id || customer?.geofence_id || null;

        if (assign_mode === 'pick' && pickedGardenerId) {
          gardener_id = pickedGardenerId;
        } else if (assign_mode === 'auto' && activeZoneId) {
          // Best available gardener in the zone (rating desc). Simplified vs the
          // full slot-locking flow — admin bookings are lower-volume.
          const zoneGardeners = await GardenerZone.findAll({
            where: { geofence_id: activeZoneId }, attributes: ['gardener_id'], transaction: t,
          });
          const ids = zoneGardeners.map((z) => z.gardener_id);
          if (ids.length) {
            const cand = await GardenerProfile.findOne({
              where: { user_id: { [Op.in]: ids }, is_available: true },
              include: [{ model: User, as: 'user', where: { is_active: true, is_approved: true, role: 'gardener' } }],
              order: [['rating', 'DESC']], transaction: t,
            });
            if (cand) gardener_id = cand.user_id;
          }
        }

        booking = await Booking.create({
          booking_number: genBookingNumber(),
          customer_id: customer.id,
          gardener_id,
          zone_id: activeZoneId,
          geofence_id: activeZoneId,
          booking_type: invoice_type === 'plan' ? 'subscription' : 'ondemand',
          status: gardener_id ? 'assigned' : 'pending',
          assigned_at: gardener_id ? new Date() : null,
          scheduled_date: scheduled_date || todayIST(),
          scheduled_time: scheduled_time || '09:00:00',
          otp: genVisitOTP(),
          service_address: service_address || '—',
          service_latitude: 0,
          service_longitude: 0,
          plant_count: parseInt(plant_count) || 0,
          base_amount: subtotal,
          total_amount: total,
          payment_status: 'paid',
          customer_notes: notes || null,
        }, { transaction: t });
      }

      // ── Create a real Subscription ──
      if (outcome === 'subscription') {
        const startDate = todayIST();
        const endDate = nowIST().add(plan.duration_days, 'days').format('YYYY-MM-DD');
        subscription = await Subscription.create({
          customer_id: customer.id,
          plan_id: plan.id,
          zone_id: geofence_id || zone_id || null,
          geofence_id: geofence_id || zone_id || null,
          status: 'active',
          start_date: startDate,
          end_date: endDate,
          auto_renew: false,
          visits_total: plan.visits_per_month,
          visits_used: 0,
          amount_paid: total,
          service_address: service_address || null,
          plant_count: parseInt(plant_count) || 0,
        }, { transaction: t });

        // Optionally schedule the first visits immediately.
        if (Array.isArray(schedule_dates) && schedule_dates.length) {
          const capped = schedule_dates.slice(0, plan.visits_per_month);
          for (const d of capped) {
            await Booking.create({
              booking_number: genBookingNumber(),
              customer_id: customer.id,
              subscription_id: subscription.id,
              zone_id: subscription.zone_id,
              geofence_id: subscription.geofence_id,
              booking_type: 'subscription',
              status: 'pending',
              scheduled_date: d,
              scheduled_time: '09:00:00',
              otp: genVisitOTP(),
              service_address: service_address || '—',
              service_latitude: 0,
              service_longitude: 0,
              plant_count: parseInt(plant_count) || 0,
              base_amount: Math.round((subtotal / plan.visits_per_month) * 100) / 100,
              total_amount: Math.round((total / plan.visits_per_month) * 100) / 100,
              payment_status: 'paid',
            }, { transaction: t });
          }
        }
      }

      // ── Save the ManualInvoice (always) ──
      const invoice = await ManualInvoice.create({
        invoice_number: genInvoiceNumber(),
        invoice_type,
        outcome,
        plan_id: plan?.id || null,
        customer_id: customer?.id || null,
        customer_name,
        customer_phone: customer_phone || null,
        customer_email: customer_email || null,
        service_address: service_address || null,
        city: city || null,
        state: state || null,
        pincode: pincode || null,
        scheduled_date: scheduled_date || null,
        scheduled_time: scheduled_time || null,
        plant_count: parseInt(plant_count) || 0,
        notes: notes || null,
        line_items: items,
        subtotal,
        gst_amount,
        total_amount: total,
        is_up: isUP,
        booking_id: booking?.id || null,
        subscription_id: subscription?.id || null,
        created_by: req.user.id,
      }, { transaction: t });

      return { invoice, booking, subscription };
    });

    res.status(201).json({
      success: true,
      message: `Invoice ${result.invoice.invoice_number} created${result.booking ? ` (booking ${result.booking.booking_number})` : ''}${result.subscription ? ` (subscription SUB-${result.subscription.id})` : ''}`,
      data: {
        invoice_id: result.invoice.id,
        invoice_number: result.invoice.invoice_number,
        booking_id: result.booking?.id || null,
        subscription_id: result.subscription?.id || null,
      },
    });
  } catch (err) {
    console.error('[manualInvoice] create failed:', err.message);
    res.status(err.httpStatus || 500).json({ success: false, message: err.message });
  }
};

// ── LIST (admin history) ─────────────────────────────────────────────────────
exports.listManualInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const where = {};
    if (search) {
      where[Op.or] = [
        { invoice_number: { [Op.like]: `%${search}%` } },
        { customer_name: { [Op.like]: `%${search}%` } },
        { customer_phone: { [Op.like]: `%${search}%` } },
      ];
    }
    const { count, rows } = await ManualInvoice.findAndCountAll({
      where,
      include: [
        { model: ServicePlan, as: 'plan', attributes: ['name'] },
        { model: User, as: 'creator', attributes: ['name'] },
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });
    res.json({ success: true, data: { items: rows, total: count, page: parseInt(page), pages: Math.ceil(count / parseInt(limit)) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
