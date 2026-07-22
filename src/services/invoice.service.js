// ─────────────────────────────────────────────────────────────────────────────
// Invoice service — THE single source of truth for every GharKaMali tax invoice.
//
// Admin dashboard, the customer website, and the mobile app all download the PDF
// produced here, so there is exactly one invoice implementation and zero drift.
//
// Layout follows the approved GST tax-invoice design: logo + company block,
// boxed invoice meta, Bill To / Service Details panels, an HSN/SAC line-item
// table with per-line CGST/SGST (or IGST), amount in words, bank details,
// terms & conditions, signatory, and footer badges.
//
// Company constants, HSN mapping, state codes and number-to-words live in
// src/config/invoice.config.js.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const {
  Booking, Subscription, Order, OrderItem, Product, ProductCategory, User,
  ServicePlan, Geofence, BookingAddOn, AddOnService, ManualInvoice,
} = require('../models');
const {
  COMPANY, BANK, TERMS, FOOTER_BADGES, SERVICE_SAC, hsnForProduct,
  placeOfSupply, amountInWords,
} = require('../config/invoice.config');
const { getOrCreateInvoiceNumber } = require('./invoiceNumber.service');

const ASSETS = path.join(__dirname, '..', 'assets');
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

const LOGO_PATH = path.join(ASSETS, 'logo.png');
const HAS_LOGO = exists(LOGO_PATH);
// Handwritten signature, embedded above the "Authorised Signatory" line.
// Accepts sign.png or signature.png; if neither exists the line renders alone.
const SIGN_PATH = [path.join(ASSETS, 'sign.png'), path.join(ASSETS, 'signature.png')].find(exists) || null;
const HAS_SIGN = !!SIGN_PATH;

// Bundled DejaVu Sans (SIL Open Font License) — PDFKit's built-in Helvetica has
// no Rupee glyph, so the whole document uses these to render "₹" correctly.
const FONT_DIR = path.join(ASSETS, 'fonts');
const FONT_REG_PATH = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD_PATH = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');
const HAS_UNICODE_FONT = exists(FONT_REG_PATH) && exists(FONT_BOLD_PATH);
// Font aliases used throughout the renderer.
const F = HAS_UNICODE_FONT ? 'Body' : 'Helvetica';
const FB = HAS_UNICODE_FONT ? 'BodyBold' : 'Helvetica-Bold';
// Rupee sign only when we have a font that can draw it.
const RS = HAS_UNICODE_FONT ? '₹' : 'Rs.';

// ── Formatting helpers ───────────────────────────────────────────────────────
const num = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dLong = (d) => (d ? new Date(d) : new Date()).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
const dShort = (d) => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Intra-state (home state) → CGST+SGST; otherwise IGST.
const HOME_STATE_KEYWORDS = ['uttar pradesh', 'noida', 'greater noida', 'ghaziabad'];
const isIntraState = (...parts) => {
  const addr = parts.filter(Boolean).join(' ').toLowerCase();
  return HOME_STATE_KEYWORDS.some((k) => addr.includes(k));
};

/**
 * Turn raw line inputs into fully-taxed invoice rows.
 * Each input: { description, hsn, qty, unit, unitPrice, gstRate, taxableOverride? }
 * `inclusive` = the unitPrice already contains GST (bookings/subscriptions).
 */
function buildLineRows(inputs, { inclusive, intra }) {
  return inputs.map((it) => {
    const qty = Number(it.qty) || 1;
    const gstRate = Number(it.gstRate) || 0;
    const gross = it.taxableOverride != null
      ? Number(it.taxableOverride)
      : round2((Number(it.unitPrice) || 0) * qty);
    // For GST-inclusive pricing, back out the taxable value.
    const taxable = inclusive && gstRate
      ? round2(gross / (1 + gstRate / 100))
      : gross;
    const tax = round2(taxable * (gstRate / 100));
    const half = round2(tax / 2);
    const unitPrice = it.unitPrice != null
      ? round2(inclusive && gstRate ? Number(it.unitPrice) / (1 + gstRate / 100) : Number(it.unitPrice))
      : round2(taxable / qty);
    return {
      description: it.description,
      hsn: it.hsn || SERVICE_SAC,
      qty,
      unit: it.unit || 'Nos',
      unitPrice,
      taxable,
      gstRate,
      cgst: intra ? half : 0,
      sgst: intra ? half : 0,
      igst: intra ? 0 : tax,
      total: round2(taxable + tax),
    };
  });
}

function totalsFrom(rows) {
  const taxable = round2(rows.reduce((s, r) => s + r.taxable, 0));
  const cgst = round2(rows.reduce((s, r) => s + r.cgst, 0));
  const sgst = round2(rows.reduce((s, r) => s + r.sgst, 0));
  const igst = round2(rows.reduce((s, r) => s + r.igst, 0));
  const grand = round2(taxable + cgst + sgst + igst);
  return { taxable, cgst, sgst, igst, totalGst: round2(cgst + sgst + igst), grand };
}

// ── BUILDERS ─────────────────────────────────────────────────────────────────

async function buildBookingInvoice(id) {
  const b = await Booking.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email', 'address', 'city', 'state', 'pincode'] },
      { model: User, as: 'gardener', attributes: ['name'] },
      { model: Subscription, as: 'subscription', include: [{ model: ServicePlan, as: 'plan', attributes: ['name', 'visits_per_month', 'max_plants'] }] },
      { model: BookingAddOn, as: 'addons', include: [{ model: AddOnService, as: 'addon', attributes: ['name', 'price'] }] },
      { model: Geofence, as: 'geofenceRef', attributes: ['name', 'city', 'state'] },
    ],
  });
  if (!b) return null;

  const c = b.customer;
  const state = c?.state || b.geofenceRef?.state || '';
  const intra = isIntraState(b.service_address, state, b.geofenceRef?.city);
  const plan = b.subscription?.plan;
  const total = Number(b.total_amount) || 0;
  const base = Number(b.base_amount) || total;

  const inputs = [{
    description: `Gardening & Plant Maintenance Service${plan ? ` (${plan.name}${plan.max_plants ? ` - Up to ${plan.max_plants} Plants` : ''})` : ''}`,
    hsn: SERVICE_SAC, qty: 1, unit: plan ? 'Plan' : 'Visit',
    unitPrice: base, gstRate: 18,
  }];
  for (const a of (b.addons || [])) {
    inputs.push({
      description: a.addon?.name || 'Add-on', hsn: SERVICE_SAC,
      qty: a.quantity || 1, unit: 'Nos',
      unitPrice: Number(a.price) || Number(a.addon?.price) || 0, gstRate: 18,
    });
  }

  const rows = buildLineRows(inputs, { inclusive: true, intra });
  const invoiceNumber = await getOrCreateInvoiceNumber('booking', b.id, b.created_at || b.createdAt);

  return {
    invoiceNumber,
    invoiceDate: dLong(b.created_at || b.createdAt),
    referenceLabel: 'Booking ID', referenceValue: b.booking_number || `BKG-${b.id}`,
    placeOfSupply: placeOfSupply(state),
    paymentMode: 'Online', paymentStatus: (b.payment_status || 'PAID').toUpperCase(),
    billTo: {
      name: c?.name || 'Customer',
      lines: [b.service_address, [c?.city, c?.state].filter(Boolean).join(', '), c?.pincode].filter(Boolean),
      phone: c?.phone, gstin: null,
    },
    serviceDetails: {
      'Service Date': dShort(b.scheduled_date),
      'Service Type': plan ? 'Plan Visit' : 'On-Demand Visit',
      'No. of Plants': b.plant_count ? `${b.plant_count} Plants` : '—',
      ...(plan?.visits_per_month ? { 'Visit Count': `${plan.visits_per_month} Visits` } : {}),
      ...(plan ? { 'Membership Plan': plan.name } : {}),
      'Technician': b.gardener?.name || 'To be assigned',
    },
    rows, totals: totalsFrom(rows), intra,
  };
}

async function buildSubscriptionInvoice(id) {
  const s = await Subscription.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email', 'city', 'state', 'pincode'] },
      { model: ServicePlan, as: 'plan', attributes: ['name', 'price', 'visits_per_month', 'max_plants', 'duration_days'] },
      { model: User, as: 'gardener', attributes: ['name'] },
    ],
  });
  if (!s) return null;

  const c = s.customer;
  const state = c?.state || '';
  const intra = isIntraState(s.service_address, state);
  const total = Number(s.amount_paid) || 0;
  const plan = s.plan;

  const inputs = [{
    description: `Gardening & Plant Maintenance Service${plan ? ` (${plan.name}${plan.max_plants ? ` - Up to ${plan.max_plants} Plants` : ''})` : ''}`,
    hsn: SERVICE_SAC, qty: 1, unit: 'Plan',
    taxableOverride: total, gstRate: 18,
  }];

  const rows = buildLineRows(inputs, { inclusive: true, intra });
  const invoiceNumber = await getOrCreateInvoiceNumber('subscription', s.id, s.created_at || s.createdAt);

  return {
    invoiceNumber,
    invoiceDate: dLong(s.created_at || s.createdAt),
    referenceLabel: 'Subscription ID', referenceValue: `SUB-${s.id}`,
    placeOfSupply: placeOfSupply(state),
    paymentMode: 'Online', paymentStatus: (s.status || 'ACTIVE').toUpperCase(),
    billTo: {
      name: c?.name || 'Customer',
      lines: [s.service_address, [c?.city, c?.state].filter(Boolean).join(', '), c?.pincode].filter(Boolean),
      phone: c?.phone, gstin: null,
    },
    serviceDetails: {
      'Start Date': dShort(s.start_date),
      'End Date': dShort(s.end_date),
      'Service Type': 'Plan Subscription',
      'No. of Plants': plan?.max_plants ? `Up to ${plan.max_plants} Plants` : '—',
      'Visit Count': plan?.visits_per_month ? `${plan.visits_per_month} Visits / month` : '—',
      'Membership Plan': plan?.name || '—',
    },
    rows, totals: totalsFrom(rows), intra,
  };
}

async function buildOrderInvoice(id) {
  const o = await Order.findByPk(id, {
    include: [
      { model: User, as: 'customer', attributes: ['name', 'phone', 'email'] },
      {
        model: OrderItem, as: 'items',
        include: [{ model: Product, as: 'product', attributes: ['name', 'gst_rate', 'category_id'], include: [{ model: ProductCategory, as: 'category', attributes: ['name'] }] }],
      },
    ],
  });
  if (!o) return null;

  const c = o.customer;
  const intra = isIntraState(o.shipping_state, o.shipping_city, o.shipping_address);

  const inputs = (o.items || []).map((it) => {
    const pName = it.product?.name || 'Product';
    const cName = it.product?.category?.name || '';
    const { hsn, unit } = hsnForProduct(pName, cName);
    return {
      description: pName, hsn, unit,
      qty: it.quantity, unitPrice: Number(it.price),
      // Shop prices are GST-exclusive; apply_gst decides whether tax is charged.
      gstRate: o.apply_gst ? (Number(it.product?.gst_rate) || 0) : 0,
    };
  });

  const rows = buildLineRows(inputs, { inclusive: false, intra });
  const invoiceNumber = await getOrCreateInvoiceNumber('order', o.id, o.created_at || o.createdAt);

  return {
    invoiceNumber,
    invoiceDate: dLong(o.created_at || o.createdAt),
    referenceLabel: 'Order ID', referenceValue: o.order_number || `ORD-${o.id}`,
    placeOfSupply: placeOfSupply(o.shipping_state),
    paymentMode: 'Online', paymentStatus: (o.payment_status || 'PAID').toUpperCase(),
    billTo: {
      name: c?.name || o.billing_business_name || 'Customer',
      lines: [o.shipping_address, [o.shipping_city, o.shipping_state].filter(Boolean).join(', '), o.shipping_pincode].filter(Boolean),
      phone: c?.phone, gstin: o.billing_gstin || null,
    },
    serviceDetails: {
      'Order Date': dShort(o.created_at || o.createdAt),
      'Order Status': o.status || '—',
      'Items': String((o.items || []).length),
      ...(o.coupon_code ? { 'Coupon': o.coupon_code } : {}),
      'Shipping': 'FREE',
    },
    rows, totals: totalsFrom(rows), intra,
    discount: Number(o.discount_amount) || 0,
  };
}

async function buildManualInvoice(id) {
  const m = await ManualInvoice.findByPk(id, {
    include: [{ model: ServicePlan, as: 'plan', attributes: ['name', 'visits_per_month', 'max_plants'] }],
  });
  if (!m) return null;

  const intra = m.is_up;
  const inputs = (Array.isArray(m.line_items) ? m.line_items : []).map((l) => ({
    description: l.name, hsn: l.hsn || SERVICE_SAC,
    qty: l.qty || 1, unit: l.unit || (m.invoice_type === 'plan' ? 'Plan' : 'Visit'),
    taxableOverride: Number(l.amount) || 0, gstRate: 18,
  }));
  // Fall back to a single line from the stored total if no items were captured.
  if (!inputs.length) {
    inputs.push({
      description: 'Gardening & Plant Maintenance Service', hsn: SERVICE_SAC,
      qty: 1, unit: 'Visit', taxableOverride: Number(m.total_amount) || 0, gstRate: 18,
    });
  }

  const rows = buildLineRows(inputs, { inclusive: true, intra });
  const invoiceNumber = await getOrCreateInvoiceNumber('manual', m.id, m.created_at || m.createdAt);

  return {
    invoiceNumber,
    invoiceDate: dLong(m.created_at || m.createdAt),
    referenceLabel: 'Reference', referenceValue: m.invoice_number,
    placeOfSupply: placeOfSupply(m.state),
    paymentMode: 'Offline', paymentStatus: 'PAID',
    billTo: {
      name: m.customer_name,
      lines: [m.service_address, [m.city, m.state].filter(Boolean).join(', '), m.pincode].filter(Boolean),
      phone: m.customer_phone, gstin: null,
    },
    serviceDetails: {
      ...(m.scheduled_date ? { 'Service Date': dShort(m.scheduled_date) } : {}),
      'Service Type': m.invoice_type === 'plan' ? 'Plan' : 'On-Demand Visit',
      'No. of Plants': m.plant_count ? `${m.plant_count} Plants` : '—',
      ...(m.plan ? { 'Membership Plan': m.plan.name } : {}),
    },
    rows, totals: totalsFrom(rows), intra,
  };
}

const BUILDERS = {
  booking: buildBookingInvoice,
  subscription: buildSubscriptionInvoice,
  order: buildOrderInvoice,
  manual: buildManualInvoice,
};

// ── PDF RENDERER ─────────────────────────────────────────────────────────────
const GREEN = '#1a6b3c';
const DARK = '#14532d';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const PANEL = '#f9fafb';

function renderInvoicePDF(inv, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const L = 36;                 // left margin
  const R = 559;                // right edge (595 - 36)
  const W = R - L;

  // Register the bundled Unicode fonts so "₹" renders (Helvetica lacks the glyph).
  if (HAS_UNICODE_FONT) {
    try {
      doc.registerFont('Body', FONT_REG_PATH);
      doc.registerFont('BodyBold', FONT_BOLD_PATH);
    } catch { /* fall back to Helvetica aliases */ }
  }
  doc.pipe(res);

  let y = 30;

  // ═══ HEADER ═══
  if (HAS_LOGO) {
    try { doc.image(LOGO_PATH, L, y, { fit: [110, 58] }); } catch { /* ignore */ }
  }
  const coX = L + 118;
  // The right-hand meta box starts at R-250; keep the company block clear of it
  // (with an 8pt gutter) so no header text can ever run into it.
  const META_X = R - 250;
  const coW = META_X - 8 - coX;
  // Header lines FLOW from measured heights so a wrapping company name can never
  // be overlapped by the lines beneath it.
  let hY = y;
  const coNameH = doc.font(FB).fontSize(11).heightOfString(COMPANY.legalName, { width: coW });
  doc.fillColor(DARK).text(COMPANY.legalName, coX, hY, { width: coW });
  hY += Math.max(14, coNameH + 1);
  doc.fillColor(TEXT).font(F).fontSize(7.2).text(`(Brand Name: ${COMPANY.brand})`, coX, hY, { width: coW, lineBreak: false, ellipsis: true });
  hY += 11;
  doc.fillColor(TEXT).font(FB).fontSize(7.2).text(`CIN: ${COMPANY.cin}`, coX, hY, { width: coW, lineBreak: false, ellipsis: true });
  hY += 13;
  doc.font(FB).fontSize(7.2).text('Registered Office:', coX, hY, { width: coW });
  let addrY = hY + 11;
  doc.font(F).fontSize(7).fillColor(TEXT);
  COMPANY.addressLines.forEach((ln) => { doc.text(ln, coX, addrY, { width: coW, lineBreak: false, ellipsis: true }); addrY += 9.5; });
  addrY += 3;
  const clip = { width: coW, lineBreak: false, ellipsis: true };
  doc.fillColor(TEXT).fontSize(7)
    .text(`Phone:  ${COMPANY.phone}`, coX, addrY, clip)
    .text(`Email:  ${COMPANY.email}`, coX, addrY + 10, clip)
    .text(`Web:    ${COMPANY.website}`, coX, addrY + 20, clip);

  // TAX INVOICE title
  doc.fillColor(GREEN).font(FB).fontSize(19).text('TAX INVOICE', R - 200, y, { width: 200, align: 'right' });

  // Meta box
  const boxX = R - 250, boxY = y + 32, boxW = 250;
  const meta = [
    ['Invoice No.', inv.invoiceNumber],
    ['Invoice Date', inv.invoiceDate],
    [inv.referenceLabel, inv.referenceValue],
    ['Place of Supply', inv.placeOfSupply],
    ['Invoice Type', 'Original for Recipient'],
    ['Payment Mode', inv.paymentMode],
    ['Payment Status', inv.paymentStatus],
  ];
  const boxH = meta.length * 15 + 12;
  doc.roundedRect(boxX, boxY, boxW, boxH, 8).lineWidth(0.8).strokeColor(LINE).stroke();
  let mY = boxY + 8;
  meta.forEach(([k, v]) => {
    doc.font(F).fontSize(8).fillColor(MUTED).text(k, boxX + 10, mY, { width: 88 });
    doc.fillColor(MUTED).text(':', boxX + 100, mY);
    const isPaid = k === 'Payment Status';
    doc.font(isPaid ? FB : F).fillColor(isPaid ? GREEN : TEXT)
      .text(String(v), boxX + 108, mY, { width: boxW - 118 });
    mY += 15;
  });

  y = Math.max(addrY + 40, boxY + boxH + 14);

  // ═══ BILL TO / SERVICE DETAILS ═══
  const panelH = 118;
  doc.roundedRect(L, y, W, panelH, 8).lineWidth(0.8).strokeColor(LINE).stroke();
  const midX = L + W / 2;
  doc.moveTo(midX, y + 10).lineTo(midX, y + panelH - 10).strokeColor(LINE).lineWidth(0.6).stroke();

  doc.fillColor(GREEN).font(FB).fontSize(8.5).text('BILL TO', L + 14, y + 12);
  doc.fillColor(GREEN).text('SERVICE DETAILS', midX + 14, y + 12);

  let bY = y + 28;
  // Advance by the name's ACTUAL height — long names wrap to 2+ lines and would
  // otherwise be overlapped by the address block.
  const nameW = W / 2 - 28;
  const nameH = doc.font(FB).fontSize(9.5).heightOfString(inv.billTo.name, { width: nameW });
  doc.fillColor(TEXT).text(inv.billTo.name, L + 14, bY, { width: nameW });
  bY += Math.max(14, nameH + 2);
  doc.font(F).fontSize(8).fillColor(TEXT);
  inv.billTo.lines.forEach((ln) => {
    const h = doc.heightOfString(ln, { width: W / 2 - 28 });
    doc.text(ln, L + 14, bY, { width: W / 2 - 28 });
    bY += Math.max(10, h);
  });
  if (inv.billTo.phone) { doc.font(FB).text(`Phone: ${inv.billTo.phone}`, L + 14, bY); bY += 11; }
  if (inv.billTo.gstin) { doc.font(FB).text(`GSTIN: ${inv.billTo.gstin}`, L + 14, bY); }

  let sY = y + 28;
  Object.entries(inv.serviceDetails).forEach(([k, v]) => {
    doc.font(F).fontSize(8).fillColor(MUTED).text(k, midX + 14, sY, { width: 92 });
    doc.text(':', midX + 108, sY);
    doc.fillColor(TEXT).text(String(v), midX + 116, sY, { width: W / 2 - 130 });
    sY += 13;
  });

  y += panelH + 16;

  // ═══ LINE ITEMS TABLE ═══
  const intra = inv.intra;
  // Column widths — must sum to W.
  // Column widths MUST sum to exactly W (523pt) or the table overflows the page.
  const cols = intra
    ? [18, 116, 50, 21, 26, 46, 54, 40, 50, 50, 52]   // #, Desc, HSN, Qty, Unit, Unit Price, Taxable, GST%, CGST, SGST, Total = 523
    : [20, 150, 58, 26, 30, 56, 62, 42, 0, 0, 79];    // IGST variant (CGST/SGST columns collapsed) = 523
  const CUR = `(${RS})`;
  const headers = intra
    ? ['#', 'Description of\nGoods / Services', 'HSN / SAC\nCode', 'Qty', 'Unit', `Unit Price\n${CUR}`, `Taxable\nValue ${CUR}`, 'GST\nRate (%)', `CGST\n${CUR}`, `SGST\n${CUR}`, `Total\n${CUR}`]
    : ['#', 'Description of\nGoods / Services', 'HSN / SAC\nCode', 'Qty', 'Unit', `Unit Price\n${CUR}`, `Taxable\nValue ${CUR}`, 'GST\nRate (%)', '', '', `IGST +\nTotal ${CUR}`];

  const xs = [];
  let acc = L;
  cols.forEach((w) => { xs.push(acc); acc += w; });

  const headH = 30;
  const drawTableHeader = () => {
    doc.roundedRect(L, y, W, headH, 6).fill(GREEN);
    doc.fillColor('#fff').font(FB).fontSize(6.8);
    headers.forEach((h, i) => {
      if (!cols[i]) return;
      const align = i === 1 ? 'left' : (i >= 5 ? 'right' : 'center');
      doc.text(h, xs[i] + 3, y + 6, { width: cols[i] - 6, align, lineGap: 1 });
    });
    y += headH;
  };
  drawTableHeader();

  // Reserve room for the summary block (words + totals + bank + terms + footer)
  // so the table breaks to a new page instead of colliding with it.
  const PAGE_BOTTOM = 812;
  // Measured height of everything that follows the table (words/totals + bank +
  // terms/signatory + footer). Kept tight so short invoices stay on one page.
  const SUMMARY_RESERVE = 290;

  doc.font(F).fontSize(7.4);
  inv.rows.forEach((r, idx) => {
    const descH = doc.font(F).fontSize(7.4).heightOfString(r.description, { width: cols[1] - 6 });
    const rowH = Math.max(26, descH + 12);

    // Page-break when this row would run into the reserved summary area.
    if (y + rowH > PAGE_BOTTOM - SUMMARY_RESERVE && idx < inv.rows.length) {
      doc.addPage();
      y = 40;
      drawTableHeader();
      doc.font(F).fontSize(7.4);
    }

    if (idx % 2 === 1) doc.rect(L, y, W, rowH).fill(PANEL);
    const cells = intra
      ? [String(idx + 1), r.description, r.hsn, String(r.qty), r.unit, num(r.unitPrice), num(r.taxable), `${r.gstRate}%`, num(r.cgst), num(r.sgst), num(r.total)]
      : [String(idx + 1), r.description, r.hsn, String(r.qty), r.unit, num(r.unitPrice), num(r.taxable), `${r.gstRate}%`, '', '', num(r.total)];
    cells.forEach((c, i) => {
      if (!cols[i]) return;
      const align = i === 1 ? 'left' : (i >= 5 ? 'right' : 'center');
      const bold = i === cells.length - 1;
      doc.font(bold ? FB : F).fontSize(7.4).fillColor(TEXT)
        .text(c, xs[i] + 3, y + 6, { width: cols[i] - 6, align });
    });
    doc.moveTo(L, y + rowH).lineTo(R, y + rowH).strokeColor(LINE).lineWidth(0.5).stroke();
    y += rowH;
  });

  y += 14;

  // If the summary block wouldn't fit below the table, start a fresh page.
  if (y + SUMMARY_RESERVE > PAGE_BOTTOM) {
    doc.addPage();
    y = 40;
  }

  // ═══ AMOUNT IN WORDS + TOTALS ═══
  const leftW = W * 0.52;
  const rightX = L + leftW + 12;
  const rightW = R - rightX;

  const words = amountInWords(inv.totals.grand);
  const wordsH = doc.font(F).fontSize(8.5).heightOfString(words, { width: leftW - 60 }) + 34;

  const totalRows = [
    ['Total Taxable Value', inv.totals.taxable],
    ...(intra
      ? [['Total CGST', inv.totals.cgst], ['Total SGST', inv.totals.sgst]]
      : [['Total IGST', inv.totals.igst]]),
    ['Total GST', inv.totals.totalGst],
  ];
  const totalsH = totalRows.length * 17 + 40;
  const blockH = Math.max(wordsH, totalsH);

  // Amount in words panel
  doc.roundedRect(L, y, leftW, blockH, 8).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.circle(L + 22, y + 20, 11).fill(GREEN);
  doc.fillColor('#fff').font(FB).fontSize(11).text(RS, L + 16, y + 14);
  doc.fillColor(GREEN).font(FB).fontSize(8.5).text('Amount in Words', L + 40, y + 12);
  doc.fillColor(TEXT).font(F).fontSize(8.5).text(words, L + 40, y + 26, { width: leftW - 54 });

  // Totals — label and value get separate, non-overlapping columns so a long
  // label or a large amount can never collide (the "Total AmouRst" bug).
  const tLabelX = rightX + 10;
  const tLabelW = rightW * 0.52;
  const tValX = tLabelX + tLabelW + 6;
  const tValW = R - tValX - 6;
  let tY = y;
  totalRows.forEach(([label, val]) => {
    doc.fillColor(TEXT).font(F).fontSize(8.5).text(label, tLabelX, tY + 4, { width: tLabelW });
    doc.font(FB).text(`${RS} ${num(val)}`, tValX, tY + 4, { width: tValW, align: 'right' });
    tY += 17;
  });
  const gtY = tY + 4;
  doc.roundedRect(rightX, gtY, rightW, 30, 6).fill(GREEN);
  doc.fillColor('#fff').font(FB).fontSize(10.5)
    .text('GRAND TOTAL', rightX + 12, gtY + 11, { width: tLabelW - 6 });
  doc.fontSize(12.5).text(`${RS} ${num(inv.totals.grand)}`, tValX, gtY + 9, { width: tValW, align: 'right' });

  y += blockH + 16;

  // ═══ BANK DETAILS (+ Scan & Pay QR) ═══
  // Two columns inside one rounded card: account details | UPI QR code.
  const bank = [
    ['Bank Name', BANK.name], ['A/C Name', BANK.accountName],
    ['A/C Number', BANK.accountNumber], ['IFSC Code', BANK.ifsc],
  ];
  const BANK_ROW_H = 12;
  const QR_SIZE = 62;
  const hasQR = !!inv.qrBuffer;
  const bankRowsH = 26 + bank.length * BANK_ROW_H;
  const bankH = Math.max(bankRowsH, hasQR ? QR_SIZE + 34 : 0) + 14;
  const qrColW = hasQR ? QR_SIZE + 26 : 0;
  const detailW = leftW - qrColW;

  doc.roundedRect(L, y, leftW, bankH, 8).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.fillColor(GREEN).font(FB).fontSize(8).text('BANK DETAILS', L + 12, y + 10);
  let kY = y + 26;
  bank.forEach(([k, v]) => {
    doc.font(F).fontSize(6.6).fillColor(MUTED).text(k, L + 12, kY, { width: 52 });
    doc.text(':', L + 66, kY);
    // lineBreak:false keeps long values (e.g. the legal name) on one line so the
    // next row can never be overlapped.
    doc.fillColor(TEXT).text(v, L + 74, kY, { width: detailW - 86, lineBreak: false, ellipsis: true });
    kY += BANK_ROW_H;
  });

  if (hasQR) {
    const qrX = L + detailW + 4;
    // Divider between details and the QR column.
    doc.moveTo(qrX - 6, y + 10).lineTo(qrX - 6, y + bankH - 10)
      .strokeColor(LINE).lineWidth(0.6).stroke();
    doc.fillColor(GREEN).font(FB).fontSize(7.2).text('Scan & Pay', qrX, y + 10, { width: QR_SIZE, align: 'left' });
    try { doc.image(inv.qrBuffer, qrX, y + 22, { fit: [QR_SIZE, QR_SIZE] }); } catch { /* ignore */ }
    // Keep the UPI caption inside the card (right edge = L + leftW − 8pt padding).
    const upiX = qrX - 6;
    doc.font(F).fontSize(5.4).fillColor(MUTED)
      .text(`UPI ID: ${BANK.upi}`, upiX, y + 26 + QR_SIZE, {
        width: (L + leftW - 8) - upiX, lineBreak: false, ellipsis: true,
      });
  } else {
    doc.font(F).fontSize(6.8).fillColor(MUTED)
      .text(`UPI ID: ${BANK.upi}`, L + 12, kY + 3, { width: leftW - 24 });
  }

  y += bankH + 14;

  // ═══ TERMS + THANK YOU + SIGNATORY ═══
  // Three non-overlapping columns across the page width:
  //   terms | thank-you | signatory
  const termsW = W * 0.44;
  const thanksX = L + termsW + 10;
  const thanksW = W * 0.26;
  const sigX = thanksX + thanksW + 10;
  const sigW = R - sigX;

  doc.fillColor(GREEN).font(FB).fontSize(8.5).text('Terms & Conditions', L, y);
  let tcY = y + 14;
  doc.font(F).fontSize(7).fillColor(TEXT);
  TERMS.forEach((t) => {
    const h = doc.heightOfString(`•  ${t}`, { width: termsW });
    doc.text(`•  ${t}`, L, tcY, { width: termsW });
    tcY += Math.max(11, h + 2);
  });

  doc.fillColor(GREEN).font('Helvetica-BoldOblique').fontSize(13)
    .text('Thank You!', thanksX, y + 2, { width: thanksW, align: 'center' });
  doc.fillColor(TEXT).font(F).fontSize(7.4)
    .text('For choosing GharKaMali.', thanksX, y + 22, { width: thanksW, align: 'center' })
    .text('We grow happiness at your home.', thanksX, y + 33, { width: thanksW, align: 'center' });

  // Handwritten signature (optional asset) sits just above the ruled line.
  if (HAS_SIGN) {
    // Sits just above the ruled line (line is at y+28), bottom-aligned to it so
    // the pen stroke visually rests on the line as in the approved design.
    const SIG_H = 32, SIG_W = 74;
    try {
      doc.image(SIGN_PATH, sigX + 6, y + 28 - SIG_H, { fit: [SIG_W, SIG_H], align: 'left', valign: 'bottom' });
    } catch { /* asset unreadable — fall through to the plain line */ }
  }
  // Signature line sits above the caption, inside its own column.
  doc.moveTo(sigX, y + 28).lineTo(R, y + 28).strokeColor(TEXT).lineWidth(0.7).stroke();
  doc.fillColor(TEXT).font(FB).fontSize(8)
    .text('Authorised Signatory', sigX, y + 34, { width: sigW });
  doc.font(F).fontSize(6.8).fillColor(MUTED)
    .text(`For ${COMPANY.legalName}`, sigX, y + 46, { width: sigW })
    .text(`(Brand Name: ${COMPANY.brand})`, sigX, y + 56, { width: sigW });

  y = Math.max(tcY, y + 70) + 12;

  // ═══ FOOTER BADGES ═══
  // Pinned to the bottom of the page (as in the approved design). Content above
  // is kept clear of it by SUMMARY_RESERVE, so it never overlaps.
  const footH = 26;
  const footY = 842 - footH;
  doc.rect(0, footY, 595, footH).fill(PANEL);
  const seg = 595 / FOOTER_BADGES.length;
  FOOTER_BADGES.forEach((b, i) => {
    doc.fillColor(GREEN).font(FB).fontSize(6.4)
      .text(b, i * seg, footY + 10, { width: seg, align: 'center' });
    if (i) doc.moveTo(i * seg, footY + 6).lineTo(i * seg, footY + footH - 6).strokeColor(LINE).lineWidth(0.5).stroke();
  });

  doc.end();
}

// Build a UPI deep-link QR ("Scan & Pay"). Returns a PNG Buffer, or null if the
// qrcode package is unavailable — the invoice still renders without it.
async function buildUpiQr(amount) {
  try {
    const QRCode = require('qrcode');
    const params = new URLSearchParams({
      pa: BANK.upi,                       // payee address
      pn: COMPANY.legalName,              // payee name
      cu: 'INR',
    });
    if (amount != null && Number(amount) > 0) params.set('am', Number(amount).toFixed(2));
    const upiUrl = `upi://pay?${params.toString()}`;
    return await QRCode.toBuffer(upiUrl, {
      type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 240,
      color: { dark: '#111111', light: '#ffffff' },
    });
  } catch {
    return null; // qrcode not installed / generation failed — render without QR
  }
}

// ── PUBLIC ───────────────────────────────────────────────────────────────────
async function streamInvoice(type, id, res) {
  const builder = BUILDERS[type];
  if (!builder) { res.status(400).json({ success: false, message: 'Unknown invoice type' }); return; }

  const inv = await builder(id);
  if (!inv) { res.status(404).json({ success: false, message: `${type} not found` }); return; }

  // Pre-generate the UPI "Scan & Pay" QR (async) so the sync renderer can embed it.
  inv.qrBuffer = await buildUpiQr(inv.totals?.grand);

  const safe = String(inv.invoiceNumber).replace(/[^\w.-]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${safe}.pdf"`);
  renderInvoicePDF(inv, res);
}

module.exports = {
  streamInvoice,
  buildBookingInvoice, buildSubscriptionInvoice, buildOrderInvoice, buildManualInvoice,
  // Exported for layout/unit testing.
  renderInvoicePDF, buildLineRows, totalsFrom,
};
