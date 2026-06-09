// ─────────────────────────────────────────────────────────────────────────────
// Finance email builders — one place that turns a booking / subscription / order
// into a fully-detailed, branded finance notification. Used by both the online
// payment fulfilment path (payment.controller) and the paid-at-creation paths
// (wallet bookings, wallet subscriptions, COD orders).
//
// Every function is fire-and-forget / best-effort: it loads the entity with all
// associations, formats every available detail, and sends. It never throws — a
// mail failure must never block a payment.
// ─────────────────────────────────────────────────────────────────────────────
const {
  Booking, Subscription, Order, OrderItem, Product, User, ServicePlan, Geofence,
} = require('../models');
const { sendFinanceNotification } = require('./email.service');

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (d) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

// ── BOOKING ──────────────────────────────────────────────────────────────────
async function notifyBooking(id, paymentLabel) {
  try {
    const b = await Booking.findByPk(id, {
      include: [
        { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
        { model: User, as: 'gardener', attributes: ['name', 'phone'] },
        { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city'] },
      ],
    });
    if (!b) return;
    const c = b.customer;
    const base = Number(b.base_amount) || 0;
    const total = Number(b.total_amount) || 0;
    // total is GST-inclusive (× 1.18). Derive the tax split for the breakdown.
    const taxable = +(total / 1.18).toFixed(2);
    const gst = +(total - taxable).toFixed(2);

    await sendFinanceNotification({
      kind: 'Booking',
      reference: b.booking_number,
      amount: total,
      summary: {
        'Booking Number': b.booking_number,
        'Booking Type': b.booking_type === 'subscription' ? 'Subscription Visit' : 'On-Demand',
        'Status': b.status,
        'Payment Method': paymentLabel,
        'Payment Status': b.payment_status,
        'Booked At (IST)': dt(b.created_at),
      },
      customer: {
        'Name': c ? c.name : `#${b.customer_id}`,
        'Phone': c ? c.phone : '—',
        'Email': c ? c.email : '—',
      },
      details: {
        'Service Date': b.scheduled_date,
        'Service Time': b.scheduled_time || 'Flexible',
        'Zone / Area': b.geofenceRef ? `${b.geofenceRef.name}${b.geofenceRef.city ? ', ' + b.geofenceRef.city : ''}` : '—',
        'Service Address': b.service_address,
        'Plants Covered': b.plant_count,
        'Assigned Gardener': b.gardener ? `${b.gardener.name} (${b.gardener.phone})` : 'Not yet assigned',
        'Customer Notes': b.customer_notes || '—',
      },
      breakdown: {
        'Base Amount': money(base),
        'Taxable Value': money(taxable),
        'GST (18%)': money(gst),
        'Total Paid': money(total),
      },
    });
  } catch (err) {
    console.error('[financeMail] notifyBooking failed:', err.message);
  }
}

// ── SUBSCRIPTION ─────────────────────────────────────────────────────────────
async function notifySubscription(id, paymentLabel) {
  try {
    const s = await Subscription.findByPk(id, {
      include: [
        { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
        { model: ServicePlan, as: 'plan', attributes: ['name', 'price', 'visits_per_month', 'duration_days'] },
        { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city'] },
      ],
    });
    if (!s) return;
    const c = s.customer;
    const total = Number(s.amount_paid) || 0;
    const taxable = +(total / 1.18).toFixed(2);
    const gst = +(total - taxable).toFixed(2);

    await sendFinanceNotification({
      kind: 'Subscription',
      reference: `SUB-${s.id}`,
      amount: total,
      summary: {
        'Subscription ID': `SUB-${s.id}`,
        'Plan': s.plan ? s.plan.name : '—',
        'Status': s.status,
        'Payment Method': paymentLabel,
        'Subscribed At (IST)': dt(s.created_at),
      },
      customer: {
        'Name': c ? c.name : `#${s.customer_id}`,
        'Phone': c ? c.phone : '—',
        'Email': c ? c.email : '—',
      },
      details: {
        'Start Date': s.start_date,
        'End Date': s.end_date,
        'Visits / Month': s.plan ? s.plan.visits_per_month : '—',
        'Duration (days)': s.plan ? s.plan.duration_days : '—',
        'Zone / Area': s.geofenceRef ? `${s.geofenceRef.name}${s.geofenceRef.city ? ', ' + s.geofenceRef.city : ''}` : '—',
        'Service Address': s.service_address || '—',
        'Plants Covered': s.plant_count,
        'Auto Renew': s.auto_renew ? 'Yes' : 'No',
      },
      breakdown: {
        'Plan Value': money(s.plan ? s.plan.price : taxable),
        'Taxable Value': money(taxable),
        'GST (18%)': money(gst),
        'Total Paid': money(total),
      },
    });
  } catch (err) {
    console.error('[financeMail] notifySubscription failed:', err.message);
  }
}

// ── ORDER ────────────────────────────────────────────────────────────────────
async function notifyOrder(id, paymentLabel) {
  try {
    const o = await Order.findByPk(id, {
      include: [
        { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
        { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city'] },
        { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['name'] }] },
      ],
    });
    if (!o) return;
    const c = o.customer;
    const total = Number(o.total_amount) || 0;
    const gst = Number(o.gst_amount) || 0;
    const discount = Number(o.discount_amount) || 0;
    const items = (o.items || []).map((it) => ({
      name: it.product ? it.product.name : `Product #${it.product_id}`,
      quantity: it.quantity,
      price: it.price,
    }));
    const itemsSubtotal = items.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);

    const breakdown = { 'Items Subtotal': money(itemsSubtotal) };
    if (discount > 0) breakdown[`Discount${o.coupon_code ? ' (' + o.coupon_code + ')' : ''}`] = `- ${money(discount)}`;
    if (o.apply_gst) breakdown['GST (18%)'] = money(gst);
    breakdown['Total Paid'] = money(total);

    const details = {
      'Shipping Address': o.shipping_address,
      'City': o.shipping_city || '—',
      'State': o.shipping_state || '—',
      'Pincode': o.shipping_pincode || '—',
      'Zone / Area': o.geofenceRef ? `${o.geofenceRef.name}${o.geofenceRef.city ? ', ' + o.geofenceRef.city : ''}` : '—',
      'Notes': o.notes || '—',
    };
    if (o.apply_gst) {
      details['Billing Business'] = o.billing_business_name || '—';
      details['Billing GSTIN'] = o.billing_gstin || '—';
    }

    await sendFinanceNotification({
      kind: 'Order',
      reference: o.order_number,
      amount: total,
      summary: {
        'Order Number': o.order_number,
        'Status': o.status,
        'Payment Method': paymentLabel,
        'Payment Status': o.payment_status,
        'GST Invoice': o.apply_gst ? 'Yes' : 'No',
        'Coupon': o.coupon_code || '—',
        'Ordered At (IST)': dt(o.created_at),
      },
      customer: {
        'Name': c ? c.name : `#${o.customer_id}`,
        'Phone': c ? c.phone : '—',
        'Email': c ? c.email : '—',
      },
      details,
      items,
      breakdown,
    });
  } catch (err) {
    console.error('[financeMail] notifyOrder failed:', err.message);
  }
}

module.exports = { notifyBooking, notifySubscription, notifyOrder };
