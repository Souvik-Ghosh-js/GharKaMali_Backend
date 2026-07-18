// ─────────────────────────────────────────────────────────────────────────────
// Invoice service — the single source of truth for GharKaMali tax invoices.
//
// This mirrors the CUSTOMER WEBSITE invoices EXACTLY (the website is the
// reference design). Admin dashboard and the mobile app both call the same
// /invoice endpoints, so every channel produces an identical document:
//   - website:  GharKaMali_Website/src/app/shop/orders/[id]/page.tsx (downloadBill)
//   - website:  GharKaMali_Website/src/app/bookings/[id]/page.tsx    (downloadBill)
//
// Legal identity, GSTIN, and the SGST+CGST (intra-state UP) vs IGST (inter-state)
// split all match the website. Keep the three builders below in sync with those
// two website files if the invoice ever changes.
// ─────────────────────────────────────────────────────────────────────────────
const PDFDocument = require('pdfkit');
const {
  Booking, Subscription, Order, OrderItem, Product, User, ServicePlan, Geofence,
  BookingAddOn, AddOnService,
} = require('../models');

// Legal seller identity — must match the website invoice header.
const SELLER = {
  name: process.env.INVOICE_COMPANY || 'Plantura Care Pvt Ltd',
  tagline: process.env.INVOICE_TAGLINE || 'Trusted plant care and gardening services',
  gstin: process.env.INVOICE_GSTIN || '09AAQCP7633P1ZD',
  address: process.env.INVOICE_ADDRESS || 'Noida, Uttar Pradesh — 201301',
  supportEmail: process.env.INVOICE_SUPPORT_EMAIL || 'support@gharkamali.com',
  site: process.env.INVOICE_SITE || 'gharkamali.com',
};

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dLong = (d) => (d ? new Date(d) : new Date()).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
const dShort = (d) => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

// Mirrors the website's intra-state test: UP addresses (Noida / Greater Noida /
// Ghaziabad / "uttar pradesh") get SGST+CGST; everything else gets IGST.
const isUPAddress = (...parts) => {
  const addr = parts.filter(Boolean).join(' ').toLowerCase();
  return addr.includes('uttar pradesh') || addr.includes('noida') ||
    addr.includes('greater noida') || addr.includes('ghaziabad');
};

// ── DATA BUILDERS — each returns a normalized invoice object ──────────────────
// { kind, reference, dateLong, dateShort, statusBadge, seller(fixed),
//   billTo{name,lines[]}, meta{label:value}, items[{name,qty?,price?,amount}],
//   hasQty, subtotalLabel, subtotal, taxRows[{label,value}], shippingFree,
//   total, gstNote }

async function buildBookingInvoice(id) {
  const b = await Booking.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
      { model: Subscription, as: 'subscription', include: [{ model: ServicePlan, as: 'plan', attributes: ['name'] }] },
      { model: BookingAddOn, as: 'addons', include: [{ model: AddOnService, as: 'addon', attributes: ['name', 'price'] }] },
      { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city'] },
    ],
  });
  if (!b) return null;
  const c = b.customer;
  const total = Number(b.total_amount) || 0;
  // Booking totals are GST-INCLUSIVE (× 1.18) — derive taxable + GST like website.
  const subtotal = Math.round((total / 1.18) * 100) / 100;
  const gstAmt = Math.round((total - subtotal) * 100) / 100;
  const halfGst = gstAmt / 2;
  const baseAmt = Number(b.base_amount) || subtotal;
  const isUP = isUPAddress(b.service_address);
  // A booking's plan name comes via its subscription (bookings have no direct plan).
  const planName = b.subscription?.plan?.name;

  // Line items mirror the website: the visit line + one line per add-on.
  const items = [
    { name: `Gardener Visit${planName ? ` — ${planName}` : ''} (${b.plant_count || 0} plants)`, amount: baseAmt },
    ...(Array.isArray(b.addons) ? b.addons : []).map((a) => ({
      name: a.addon?.name || 'Add-on',
      amount: (Number(a.price) || Number(a.addon?.price) || 0) * (a.quantity || 1),
    })),
  ];

  const taxRows = isUP
    ? [
        { label: 'SGST (9%)', value: money(halfGst) },
        { label: 'CGST (9%)', value: money(halfGst) },
      ]
    : [{ label: 'IGST (18%)', value: money(gstAmt) }];

  return {
    kind: 'Booking',
    reference: b.booking_number || `BKG-${b.id}`,
    dateLong: dLong(b.created_at || b.createdAt),
    statusBadge: (b.payment_status || 'PAID').toUpperCase(),
    billTo: { name: c?.name || 'Customer', lines: [b.service_address || '—'] },
    meta: {
      'Booking No': b.booking_number || `BKG-${b.id}`,
      'Date': `${dShort(b.scheduled_date)} ${b.scheduled_time || ''}`.trim(),
      'Payment': b.payment_status || 'Paid',
    },
    items,
    hasQty: false,
    subtotalLabel: 'Subtotal (excl. GST)',
    subtotal,
    taxRows,
    shippingFree: false,
    total,
    gstNote: isUP
      ? 'SGST @ 9% + CGST @ 9% applied (intra-state — Uttar Pradesh). This is a computer-generated invoice and does not require a physical signature.'
      : 'IGST @ 18% applied (inter-state supply). This is a computer-generated invoice and does not require a physical signature.',
  };
}

async function buildSubscriptionInvoice(id) {
  const s = await Subscription.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
      { model: ServicePlan, as: 'plan', attributes: ['name', 'price', 'visits_per_month'] },
    ],
  });
  if (!s) return null;
  const c = s.customer;
  const total = Number(s.amount_paid) || 0;
  const subtotal = Math.round((total / 1.18) * 100) / 100;
  const gstAmt = Math.round((total - subtotal) * 100) / 100;
  const halfGst = gstAmt / 2;
  const isUP = isUPAddress(s.service_address);

  const items = [
    { name: `${s.plan?.name || 'Subscription'} Plan${s.plan?.visits_per_month ? ` — ${s.plan.visits_per_month} visits/month` : ''}`, amount: subtotal },
  ];

  const taxRows = isUP
    ? [
        { label: 'SGST (9%)', value: money(halfGst) },
        { label: 'CGST (9%)', value: money(halfGst) },
      ]
    : [{ label: 'IGST (18%)', value: money(gstAmt) }];

  return {
    kind: 'Subscription',
    reference: `SUB-${s.id}`,
    dateLong: dLong(s.created_at || s.createdAt),
    statusBadge: (s.status || 'ACTIVE').toUpperCase(),
    billTo: { name: c?.name || 'Customer', lines: [s.service_address || '—'] },
    meta: {
      'Subscription No': `SUB-${s.id}`,
      'Start Date': dShort(s.start_date),
      'End Date': dShort(s.end_date),
    },
    items,
    hasQty: false,
    subtotalLabel: 'Subtotal (excl. GST)',
    subtotal,
    taxRows,
    shippingFree: false,
    total,
    gstNote: isUP
      ? 'SGST @ 9% + CGST @ 9% applied (intra-state — Uttar Pradesh). This is a computer-generated invoice and does not require a physical signature.'
      : 'IGST @ 18% applied (inter-state supply). This is a computer-generated invoice and does not require a physical signature.',
  };
}

async function buildOrderInvoice(id) {
  const o = await Order.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
      { model: OrderItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['name', 'gst_rate'] }] },
    ],
  });
  if (!o) return null;
  const c = o.customer;
  const total = Number(o.total_amount) || 0;
  const gstAmt = Number(o.gst_amount) || 0;
  // Order totals are GST-ADDITIVE: subtotal = total − gst (matches website).
  const subtotal = total - gstAmt;
  const halfGst = gstAmt / 2;
  const gstRate = o.items?.[0]?.product?.gst_rate || 0;
  const isUP = isUPAddress(o.shipping_state, o.shipping_city, o.shipping_address);
  const customerName = c?.name || o.billing_business_name || 'Customer';

  const items = (o.items || []).map((it) => ({
    name: it.product?.name || 'Product',
    qty: it.quantity,
    price: Number(it.price),
    amount: Number(it.quantity) * Number(it.price),
  }));

  let taxRows = [];
  if (o.apply_gst && gstAmt > 0) {
    taxRows = isUP
      ? [
          { label: `SGST (${gstRate / 2}%)`, value: money(halfGst) },
          { label: `CGST (${gstRate / 2}%)`, value: money(halfGst) },
        ]
      : [{ label: `IGST (${gstRate}%)`, value: money(gstAmt) }];
  }

  const billToLines = [
    o.shipping_address || '—',
    `${o.shipping_city || ''} ${o.shipping_pincode || ''}`.trim(),
    o.shipping_state || '',
  ].filter((l) => l && l.trim());
  if (o.billing_gstin) billToLines.push(`GSTIN: ${o.billing_gstin}`);

  return {
    kind: 'Order',
    reference: o.order_number || `ORD-${o.id}`,
    dateLong: dLong(o.created_at || o.createdAt),
    statusBadge: (o.payment_status || 'PAID').toUpperCase(),
    billTo: { name: customerName, lines: billToLines },
    meta: {
      'Order Date': dShort(o.created_at || o.createdAt),
      'Order No': o.order_number || `ORD-${o.id}`,
      'Payment': o.payment_status || 'Paid',
    },
    items,
    hasQty: true,
    subtotalLabel: 'Subtotal',
    subtotal,
    taxRows,
    shippingFree: true,
    total,
    gstNote: (o.apply_gst && gstAmt > 0)
      ? (isUP
          ? `SGST @ ${gstRate / 2}% + CGST @ ${gstRate / 2}% applied (intra-state — Uttar Pradesh). Subject to reverse charge: No. This is a computer-generated invoice and does not require a physical signature.`
          : `IGST @ ${gstRate}% applied (inter-state supply). Subject to reverse charge: No. This is a computer-generated invoice and does not require a physical signature.`)
      : null,
  };
}

const BUILDERS = {
  booking: buildBookingInvoice,
  subscription: buildSubscriptionInvoice,
  order: buildOrderInvoice,
};

// ── PDF RENDERER — layout mirrors the website invoice HTML ────────────────────
function renderInvoicePDF(inv, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const FOREST = '#03411a';
  const SAGE = '#6b8f71';
  const GREY = '#555555';
  const L = 40;              // left margin
  const R = 555;            // right edge (A4 595 − 40)
  const rightW = R - L;

  doc.pipe(res);

  // ── Header ──
  doc.fillColor(FOREST).fontSize(22).font('Helvetica-Bold').text(SELLER.name, L, 40);
  doc.fillColor(SAGE).fontSize(9).font('Helvetica').text(SELLER.tagline, L, 68);
  doc.fillColor(SAGE).fontSize(8)
    .text(`GSTIN: ${SELLER.gstin}`, L, 84)
    .text(SELLER.address, L, 95);

  doc.fillColor(FOREST).fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', 0, 40, { align: 'right', width: R });
  doc.fillColor(SAGE).fontSize(10).font('Helvetica')
    .text(`#${inv.reference}`, 0, 66, { align: 'right', width: R })
    .text(inv.dateLong, 0, 80, { align: 'right', width: R });
  // Status badge
  doc.fillColor('#16a34a').fontSize(9).font('Helvetica-Bold')
    .text(inv.statusBadge, 0, 96, { align: 'right', width: R });

  doc.moveTo(L, 118).lineTo(R, 118).strokeColor(FOREST).lineWidth(2).stroke();

  // ── Bill To + Meta (two columns) ──
  let y = 132;
  doc.fillColor(SAGE).fontSize(9).font('Helvetica-Bold').text('BILL TO', L, y);
  doc.fillColor(SAGE).fontSize(9).font('Helvetica-Bold').text(inv.kind === 'Order' ? 'ORDER INFO' : `${inv.kind.toUpperCase()} INFO`, 320, y);
  y += 14;

  doc.fillColor('#1a2e1a').fontSize(10).font('Helvetica-Bold').text(inv.billTo.name, L, y, { width: 260 });
  let by = y + 14;
  doc.font('Helvetica').fontSize(9);
  inv.billTo.lines.forEach((line) => {
    const h = doc.heightOfString(line, { width: 260 });
    doc.fillColor('#1a2e1a').text(line, L, by, { width: 260 });
    by += Math.max(12, h);
  });

  let my = y;
  doc.fontSize(9).font('Helvetica');
  for (const [k, v] of Object.entries(inv.meta)) {
    doc.fillColor(GREY).text(`${k}: `, 320, my, { continued: true }).fillColor('#1a2e1a').text(String(v));
    my += 13;
  }

  // ── Items table ──
  let ty = Math.max(by, my) + 20;
  const hasQty = inv.hasQty;
  // Column x positions
  const cDesc = L + 8;
  const cQty = 340;
  const cPrice = 420;
  const cAmt = R - 8;

  doc.fillColor(FOREST).rect(L, ty, rightW, 22).fill();
  doc.fillColor('#fff').fontSize(10).font('Helvetica-Bold');
  doc.text(hasQty ? 'Product' : 'Description', cDesc, ty + 6);
  if (hasQty) {
    doc.text('Qty', cQty, ty + 6, { width: 40, align: 'center' });
    doc.text('Unit Price', cPrice - 20, ty + 6, { width: 70, align: 'right' });
  }
  doc.text('Amount', 0, ty + 6, { align: 'right', width: rightW - 8 });
  ty += 22;

  doc.font('Helvetica').fontSize(9.5);
  inv.items.forEach((it) => {
    const descW = hasQty ? 290 : 400;
    const h = Math.max(18, doc.heightOfString(it.name, { width: descW }) + 8);
    doc.fillColor('#1a2e1a').text(it.name, cDesc, ty + 5, { width: descW });
    if (hasQty) {
      doc.text(String(it.qty), cQty, ty + 5, { width: 40, align: 'center' });
      doc.text(money(it.price), cPrice - 20, ty + 5, { width: 70, align: 'right' });
    }
    doc.text(money(it.amount), 0, ty + 5, { align: 'right', width: rightW - 8 });
    doc.moveTo(L, ty + h).lineTo(R, ty + h).strokeColor('#e8f0e8').lineWidth(1).stroke();
    ty += h;
  });

  // ── Subtotal / tax / shipping (right aligned) ──
  ty += 8;
  const putRow = (label, value, opts = {}) => {
    doc.fillColor(opts.color || GREY).fontSize(9.5).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, 300, ty, { width: 150, align: 'right' });
    doc.fillColor(opts.valueColor || '#1a2e1a').text(value, 0, ty, { align: 'right', width: rightW - 8 });
    ty += 16;
  };
  putRow(inv.subtotalLabel, money(inv.subtotal));
  inv.taxRows.forEach((r) => putRow(r.label, r.value));
  if (inv.shippingFree) putRow('Shipping', 'FREE', { valueColor: '#16a34a', bold: true });

  // ── Total ──
  ty += 4;
  doc.moveTo(300, ty).lineTo(R, ty).strokeColor(FOREST).lineWidth(2).stroke();
  ty += 8;
  doc.fillColor(FOREST).fontSize(13).font('Helvetica-Bold')
    .text('Total Amount', 300, ty, { width: 150, align: 'right' })
    .text(money(inv.total), 0, ty, { align: 'right', width: rightW - 8 });
  ty += 30;

  // ── GST note ──
  if (inv.gstNote) {
    const noteH = doc.fontSize(9).heightOfString(inv.gstNote, { width: rightW - 28 }) + 20;
    doc.fillColor('#f0f7f2').rect(L, ty, rightW, noteH).fill();
    doc.fillColor('#3d6147').fontSize(9).font('Helvetica')
      .text(`GST Note: ${inv.gstNote}`, L + 14, ty + 10, { width: rightW - 28 });
    ty += noteH;
  }

  // ── Footer ──
  doc.fillColor(SAGE).fontSize(8.5).font('Helvetica')
    .text(`${SELLER.name} · ${SELLER.supportEmail} · ${SELLER.site}`, L, 790, { align: 'center', width: rightW })
    .text('Thank you for choosing GharKaMali! 🌿', L, 802, { align: 'center', width: rightW });

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
