// ─────────────────────────────────────────────────────────────────────────────
// Payment receipt PDF — a lightweight acknowledgment of money received,
// distinct from the tax invoice (which documents the supply). Streamed from
// GET /admin/payments/:id/receipt.
// Kept separate from invoice.service.js on purpose: receipts are not tax
// documents, need no line items/HSN/GST split, and must never drift the
// invoice layout.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Payment, User, Order } = require('../models');
const { COMPANY, amountInWords } = require('../config/invoice.config');

const ASSETS = path.join(__dirname, '..', 'assets');
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const LOGO_PATH = path.join(ASSETS, 'logo.png');
const FONT_REG = path.join(ASSETS, 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf');
const HAS_FONT = exists(FONT_REG) && exists(FONT_BOLD);
const F = HAS_FONT ? 'Body' : 'Helvetica';
const FB = HAS_FONT ? 'BodyBold' : 'Helvetica-Bold';
const RS = HAS_FONT ? '₹' : 'Rs.';

const GREEN = '#1a6b3c';
const DARK = '#14532d';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const PANEL = '#f0f7f2';

const num = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dLong = (d) => (d ? new Date(d) : new Date()).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Resolve which tax invoice (if any) a payment belongs to.
 * @returns {Promise<{type: 'booking'|'subscription'|'order', id: number}|null>}
 */
async function resolvePaymentInvoiceTarget(payment) {
  if (payment.booking_id) return { type: 'booking', id: payment.booking_id };
  if (payment.subscription_id) return { type: 'subscription', id: payment.subscription_id };
  // Orders: no dedicated column — recover from the gateway payload, the
  // razorpay notes ("order:<id>"), or the payment_for label ("Order-<number>").
  const gw = payment.gateway_response || {};
  if (gw.order_id && Number.isInteger(Number(gw.order_id))) return { type: 'order', id: Number(gw.order_id) };
  const noteMatch = String(payment.notes || '').match(/order:(\d+)/);
  if (noteMatch) return { type: 'order', id: Number(noteMatch[1]) };
  const forMatch = String(payment.payment_for || '').match(/^Order-(.+)$/);
  if (forMatch) {
    const order = await Order.findOne({ where: { order_number: forMatch[1] }, attributes: ['id'] });
    if (order) return { type: 'order', id: order.id };
  }
  return null;
}

/** Stream a one-page payment receipt PDF to `res`. Returns false when not found. */
async function streamPaymentReceipt(paymentId, res) {
  const p = await Payment.findByPk(paymentId, {
    include: [{ model: User, as: 'user', attributes: ['name', 'phone', 'email'] }],
  });
  if (!p) {
    res.status(404).json({ success: false, message: 'Payment not found' });
    return false;
  }

  const txn = p.transaction_id || p.txn_id || `PAY-${p.id}`;
  const safe = String(txn).replace(/[^\w.-]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${safe}.pdf"`);

  const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 0 }); // 595 × 420
  if (HAS_FONT) {
    try { doc.registerFont('Body', FONT_REG); doc.registerFont('BodyBold', FONT_BOLD); } catch { /* fall back */ }
  }
  doc.pipe(res);

  const L = 36, R = 559, W = R - L;

  // Header — brand + company identity (incl. GSTIN) matching the invoice look.
  let y = 26;
  if (exists(LOGO_PATH)) { try { doc.image(LOGO_PATH, L, y, { fit: [84, 44] }); } catch { /* ignore */ } }
  const hx = L + 96;
  doc.fillColor(DARK).font(FB).fontSize(12).text(COMPANY.legalName, hx, y);
  doc.fillColor(TEXT).font(F).fontSize(7).text(`(Brand: ${COMPANY.brand})  ·  GSTIN: ${COMPANY.gstin}  ·  CIN: ${COMPANY.cin}`, hx, y + 15);
  doc.fillColor(MUTED).text(`${COMPANY.addressLines.join(' ')}  ·  ${COMPANY.phone}  ·  ${COMPANY.email}`, hx, y + 26, { width: R - hx - 130, ellipsis: true, lineBreak: false });
  doc.fillColor(GREEN).font(FB).fontSize(15).text('PAYMENT RECEIPT', R - 180, y + 2, { width: 180, align: 'right' });

  y = 84;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.8).stroke();

  // Amount panel.
  y += 14;
  doc.roundedRect(L, y, W, 64, 10).fill(PANEL);
  const paidish = p.status === 'success';
  doc.fillColor(GREEN).font(FB).fontSize(22).text(`${RS} ${num(p.amount)}`, L, y + 12, { width: W, align: 'center' });
  doc.fillColor(paidish ? GREEN : '#b45309').font(FB).fontSize(9)
    .text(String(p.status || '').toUpperCase(), L, y + 40, { width: W, align: 'center' });

  // Details grid.
  y += 78;
  const rows = [
    ['Receipt / Txn ID', txn],
    ['Date & Time', dLong(p.created_at || p.createdAt)],
    ['Received From', `${p.user?.name || 'Customer'}${p.user?.phone ? ` (+91 ${p.user.phone})` : ''}`],
    ['Towards', p.payment_for || (p.type || '').replace(/_/g, ' ')],
    ['Payment Method', (p.payment_method || 'Online').toUpperCase()],
    ['Amount in Words', amountInWords(p.amount)],
  ];
  for (const [k, v] of rows) {
    doc.fillColor(MUTED).font(FB).fontSize(7.5).text(k.toUpperCase(), L + 6, y, { width: 130 });
    doc.fillColor(TEXT).font(F).fontSize(9).text(String(v), L + 146, y - 1, { width: R - L - 152 });
    y += Math.max(16, doc.heightOfString(String(v), { width: R - L - 152 }) + 7);
  }

  // Footer note.
  doc.fillColor(MUTED).font(F).fontSize(6.8)
    .text('This is a computer-generated receipt acknowledging payment received. The corresponding tax invoice is issued separately.', L, 396 - 14, { width: W, align: 'center' });

  doc.end();
  return true;
}

module.exports = { streamPaymentReceipt, resolvePaymentInvoiceTarget };
