// ─────────────────────────────────────────────────────────────────────────────
// Invoice service — turns a booking / subscription / order into a branded PDF
// tax invoice. The data-building logic mirrors financeMail.js (same GST split,
// same line items) so the admin's downloadable invoice matches the finance email
// the customer/finance team already receive.
//
// Usage:
//   const { streamInvoice } = require('./invoice.service');
//   await streamInvoice('booking', id, res);   // pipes a PDF to an Express res
// ─────────────────────────────────────────────────────────────────────────────
const PDFDocument = require('pdfkit');
const {
  Booking, Subscription, Order, OrderItem, Product, User, ServicePlan, Geofence,
} = require('../models');

const BRAND = {
  name: process.env.BRAND_NAME || 'GharKaMali',
  tagline: process.env.BRAND_TAGLINE || 'Your Garden, Our Care',
  site: process.env.BRAND_SITE || 'https://gharkamali.com',
  email: process.env.FINANCE_EMAIL || 'finance@gharkamali.com',
};

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (d) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const dOnly = (d) => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

// ── DATA BUILDERS ────────────────────────────────────────────────────────────
// Each returns a normalized invoice object: { kind, reference, date, customer,
// details{}, items[], breakdown[] (label,value), total }.

async function buildBookingInvoice(id) {
  const b = await Booking.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
      { model: User, as: 'gardener', attributes: ['name', 'phone'] },
      { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city'] },
    ],
  });
  if (!b) return null;
  const c = b.customer;
  const base = Number(b.base_amount) || 0;
  const total = Number(b.total_amount) || 0;
  // total is GST-inclusive (× 1.18); derive the tax split for the breakdown.
  const taxable = +(total / 1.18).toFixed(2);
  const gst = +(total - taxable).toFixed(2);

  return {
    kind: 'Booking',
    reference: b.booking_number || `BKG-${b.id}`,
    date: b.created_at,
    customer: { name: c?.name || `#${b.customer_id}`, phone: c?.phone || '—', email: c?.email || '—' },
    details: {
      'Booking Type': b.booking_type === 'subscription' ? 'Subscription Visit' : 'On-Demand',
      'Status': b.status,
      'Payment Status': b.payment_status,
      'Service Date': dOnly(b.scheduled_date),
      'Service Time': b.scheduled_time || 'Flexible',
      'Zone / Area': b.geofenceRef ? `${b.geofenceRef.name}${b.geofenceRef.city ? ', ' + b.geofenceRef.city : ''}` : '—',
      'Service Address': b.service_address || '—',
      'Plants Serviced': b.plant_count ?? '—',
      'Assigned Gardener': b.gardener ? `${b.gardener.name} (${b.gardener.phone})` : 'Not yet assigned',
    },
    items: [{ description: b.booking_type === 'subscription' ? 'Subscription gardening visit' : 'On-demand gardening service', amount: base }],
    breakdown: [
      { label: 'Base Amount', value: money(base) },
      { label: 'Taxable Value', value: money(taxable) },
      { label: 'GST (18%)', value: money(gst) },
    ],
    total,
  };
}

async function buildSubscriptionInvoice(id) {
  const s = await Subscription.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
      { model: ServicePlan, as: 'plan', attributes: ['name', 'price', 'visits_per_month', 'duration_days'] },
      { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city'] },
    ],
  });
  if (!s) return null;
  const c = s.customer;
  const total = Number(s.amount_paid) || 0;
  const taxable = +(total / 1.18).toFixed(2);
  const gst = +(total - taxable).toFixed(2);

  return {
    kind: 'Subscription',
    reference: `SUB-${s.id}`,
    date: s.created_at,
    customer: { name: c?.name || `#${s.customer_id}`, phone: c?.phone || '—', email: c?.email || '—' },
    details: {
      'Plan': s.plan?.name || '—',
      'Status': s.status,
      'Start Date': dOnly(s.start_date),
      'End Date': dOnly(s.end_date),
      'Visits / Month': s.plan?.visits_per_month ?? '—',
      'Duration (days)': s.plan?.duration_days ?? '—',
      'Zone / Area': s.geofenceRef ? `${s.geofenceRef.name}${s.geofenceRef.city ? ', ' + s.geofenceRef.city : ''}` : '—',
      'Service Address': s.service_address || '—',
      'Plants Covered': s.plant_count ?? '—',
      'Auto Renew': s.auto_renew ? 'Yes' : 'No',
    },
    items: [{ description: `${s.plan?.name || 'Subscription'} plan`, amount: s.plan ? Number(s.plan.price) : taxable }],
    breakdown: [
      { label: 'Plan Value', value: money(s.plan ? s.plan.price : taxable) },
      { label: 'Taxable Value', value: money(taxable) },
      { label: 'GST (18%)', value: money(gst) },
    ],
    total,
  };
}

async function buildOrderInvoice(id) {
  const o = await Order.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
      { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city'] },
      { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['name'] }] },
    ],
  });
  if (!o) return null;
  const c = o.customer;
  const total = Number(o.total_amount) || 0;
  const gst = Number(o.gst_amount) || 0;
  const discount = Number(o.discount_amount) || 0;
  const items = (o.items || []).map((it) => ({
    description: `${it.product ? it.product.name : `Product #${it.product_id}`} × ${it.quantity}`,
    amount: Number(it.price) * Number(it.quantity),
  }));
  const itemsSubtotal = items.reduce((sum, it) => sum + it.amount, 0);

  const breakdown = [{ label: 'Items Subtotal', value: money(itemsSubtotal) }];
  if (discount > 0) breakdown.push({ label: `Discount${o.coupon_code ? ' (' + o.coupon_code + ')' : ''}`, value: `- ${money(discount)}` });
  if (o.apply_gst) breakdown.push({ label: 'GST (18%)', value: money(gst) });

  const details = {
    'Status': o.status,
    'Payment Status': o.payment_status,
    'GST Invoice': o.apply_gst ? 'Yes' : 'No',
    'Coupon': o.coupon_code || '—',
    'Shipping Address': o.shipping_address || '—',
    'City': o.shipping_city || '—',
    'State': o.shipping_state || '—',
    'Pincode': o.shipping_pincode || '—',
    'Zone / Area': o.geofenceRef ? `${o.geofenceRef.name}${o.geofenceRef.city ? ', ' + o.geofenceRef.city : ''}` : '—',
  };
  if (o.apply_gst) {
    details['Billing Business'] = o.billing_business_name || '—';
    details['Billing GSTIN'] = o.billing_gstin || '—';
  }

  return {
    kind: 'Order',
    reference: o.order_number || `ORD-${o.id}`,
    date: o.created_at,
    customer: { name: c?.name || `#${o.customer_id}`, phone: c?.phone || '—', email: c?.email || '—' },
    details,
    items,
    breakdown,
    total,
  };
}

const BUILDERS = {
  booking: buildBookingInvoice,
  subscription: buildSubscriptionInvoice,
  order: buildOrderInvoice,
};

// ── PDF RENDERER ─────────────────────────────────────────────────────────────
function renderInvoicePDF(inv, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const FOREST = '#03411a';
  const GOLD = '#c9a84c';
  const GREY = '#666666';

  doc.pipe(res);

  // Header
  doc.fillColor(FOREST).fontSize(24).font('Helvetica-Bold').text(BRAND.name, 50, 50);
  doc.fillColor(GOLD).fontSize(10).font('Helvetica').text(BRAND.tagline, 50, 78);
  doc.fillColor(GREY).fontSize(9)
    .text(BRAND.site, 50, 92)
    .text(BRAND.email, 50, 104);

  doc.fillColor(FOREST).fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', 0, 50, { align: 'right' });
  doc.fillColor('#000').fontSize(10).font('Helvetica')
    .text(`Invoice: ${inv.reference}`, 0, 80, { align: 'right' })
    .text(`Date: ${dt(inv.date)}`, 0, 94, { align: 'right' })
    .text(`Type: ${inv.kind}`, 0, 108, { align: 'right' });

  doc.moveTo(50, 130).lineTo(545, 130).strokeColor(GOLD).lineWidth(2).stroke();

  // Bill To
  let y = 145;
  doc.fillColor(FOREST).fontSize(11).font('Helvetica-Bold').text('Bill To', 50, y);
  y += 16;
  doc.fillColor('#000').fontSize(10).font('Helvetica')
    .text(inv.customer.name, 50, y)
    .text(inv.customer.phone, 50, y + 13)
    .text(inv.customer.email, 50, y + 26);

  // Details (right column)
  let dy = 145;
  doc.fillColor(FOREST).fontSize(11).font('Helvetica-Bold').text('Details', 320, dy);
  dy += 16;
  doc.fontSize(8.5).font('Helvetica');
  for (const [k, v] of Object.entries(inv.details)) {
    doc.fillColor(GREY).text(`${k}:`, 320, dy, { width: 90, continued: false });
    doc.fillColor('#000').text(String(v), 412, dy, { width: 133 });
    dy += 13;
  }

  // Line items table
  let ty = Math.max(y + 50, dy + 20);
  doc.fillColor(FOREST).rect(50, ty, 495, 22).fill();
  doc.fillColor('#fff').fontSize(10).font('Helvetica-Bold')
    .text('Description', 58, ty + 6)
    .text('Amount', 0, ty + 6, { align: 'right', width: 537 });
  ty += 22;

  doc.font('Helvetica').fontSize(10);
  inv.items.forEach((it, i) => {
    if (i % 2 === 1) doc.fillColor('#fafcfa').rect(50, ty, 495, 20).fill();
    doc.fillColor('#000')
      .text(it.description, 58, ty + 5, { width: 380 })
      .text(money(it.amount), 0, ty + 5, { align: 'right', width: 537 });
    ty += 20;
  });

  doc.moveTo(50, ty).lineTo(545, ty).strokeColor('#ddd').lineWidth(1).stroke();
  ty += 10;

  // Breakdown (right aligned)
  inv.breakdown.forEach((row) => {
    doc.fillColor(GREY).fontSize(9.5).font('Helvetica').text(row.label, 320, ty, { width: 140 });
    doc.fillColor('#000').text(row.value, 0, ty, { align: 'right', width: 537 });
    ty += 16;
  });

  // Total
  ty += 4;
  doc.fillColor(FOREST).rect(320, ty, 225, 26).fill();
  doc.fillColor('#fff').fontSize(12).font('Helvetica-Bold')
    .text('Total Paid', 328, ty + 7)
    .text(money(inv.total), 0, ty + 7, { align: 'right', width: 537 });

  // Footer
  doc.fillColor(GREY).fontSize(8).font('Helvetica')
    .text('This is a computer-generated tax invoice and does not require a signature.', 50, 760, { align: 'center', width: 495 })
    .text(`${BRAND.name} · ${BRAND.site}`, 50, 772, { align: 'center', width: 495 });

  doc.end();
}

// ── PUBLIC: stream an invoice PDF to an Express response ──────────────────────
async function streamInvoice(type, id, res) {
  const builder = BUILDERS[type];
  if (!builder) { res.status(400).json({ success: false, message: 'Unknown invoice type' }); return; }

  const inv = await builder(id);
  if (!inv) { res.status(404).json({ success: false, message: `${type} not found` }); return; }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.reference}.pdf"`);
  renderInvoicePDF(inv, res);
}

module.exports = { streamInvoice, buildBookingInvoice, buildSubscriptionInvoice, buildOrderInvoice };
