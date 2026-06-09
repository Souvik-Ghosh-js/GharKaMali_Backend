const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'gobt.digital@gmail.com';
const FROM = process.env.SMTP_FROM || `"GharKaMali" <${process.env.SMTP_USER}>`;

async function sendCareerApplication(data) {
  const {
    name, phone, whatsapp, email, experience, cities, bio,
  } = data;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#03411a;padding:24px 28px;">
        <h2 style="color:#fff;margin:0;font-size:1.2rem;">🌿 New Gardener Application — GharKaMali</h2>
      </div>
      <div style="padding:28px;background:#fff;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#6b7280;font-size:0.85rem;width:140px;vertical-align:top;">Full Name</td><td style="padding:8px 0;font-weight:700;color:#111;">${name}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:0.85rem;vertical-align:top;">Phone</td><td style="padding:8px 0;font-weight:600;color:#111;">${phone}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:0.85rem;vertical-align:top;">WhatsApp</td><td style="padding:8px 0;font-weight:600;color:#111;">${whatsapp || phone}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:0.85rem;vertical-align:top;">Email</td><td style="padding:8px 0;color:#111;">${email || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:0.85rem;vertical-align:top;">Experience</td><td style="padding:8px 0;color:#111;">${experience}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:0.85rem;vertical-align:top;">Cities / Areas</td><td style="padding:8px 0;color:#111;">${cities}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:0.85rem;vertical-align:top;">About</td><td style="padding:8px 0;color:#111;white-space:pre-wrap;">${bio || '—'}</td></tr>
        </table>
      </div>
      <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:0.78rem;color:#9ca3af;">
        Submitted on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST via gharkamali.com/careers
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `[Career] New Gardener Application — ${name}`,
    html,
    replyTo: email || undefined,
  });
}

// ─── Finance notifications ───────────────────────────────────────────────────
// Every paid booking / subscription / order is reported to the finance mailbox.
const FINANCE_EMAIL = process.env.FINANCE_EMAIL || 'finance@gharkamali.com';

// Brand config (env-overridable). The logo must be a PUBLIC https URL — email
// clients block relative/localhost paths. Leave EMAIL_LOGO_URL unset to fall
// back to a text wordmark.
const BRAND_NAME = process.env.BRAND_NAME || 'GharKaMali';
const BRAND_TAGLINE = process.env.BRAND_TAGLINE || 'Your Garden, Our Care';
const BRAND_SITE = process.env.BRAND_SITE || 'https://gharkamali.com';
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || '';
const GREEN = '#03411a';
const GOLD = '#c9a24b';

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Branded header with logo (or wordmark fallback) + a coloured title strip.
function brandHeader(title) {
  const logo = EMAIL_LOGO_URL
    ? `<img src="${EMAIL_LOGO_URL}" alt="${esc(BRAND_NAME)}" height="40" style="height:40px;display:block;border:0;" />`
    : `<div style="font-size:1.5rem;font-weight:800;color:#fff;letter-spacing:0.5px;">🌿 ${esc(BRAND_NAME)}</div>`;
  return `
    <div style="background:${GREEN};padding:22px 28px;text-align:center;">
      ${logo}
      <div style="color:${GOLD};font-size:0.8rem;font-weight:600;margin-top:6px;letter-spacing:0.3px;">${esc(BRAND_TAGLINE)}</div>
    </div>
    <div style="background:#06502a;padding:14px 28px;">
      <h2 style="color:#fff;margin:0;font-size:1.1rem;font-weight:700;">${title}</h2>
    </div>`;
}

// A labelled key/value section. `fields` is an ordered {label: value} map.
function fieldSection(heading, fields) {
  const rows = Object.entries(fields)
    .map(([label, value]) => `
      <tr>
        <td style="padding:7px 0;color:#6b7280;font-size:0.83rem;width:170px;vertical-align:top;">${esc(label)}</td>
        <td style="padding:7px 0;font-weight:600;color:#111827;font-size:0.9rem;">${value == null || value === '' ? '—' : esc(value)}</td>
      </tr>`)
    .join('');
  return `
    <div style="padding:6px 28px 4px;">
      ${heading ? `<div style="font-size:0.72rem;font-weight:800;color:${GREEN};text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px;">${esc(heading)}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>`;
}

// Line-items table (for orders). items: [{ name, quantity, price }].
function itemsTable(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const rows = items.map((it) => `
    <tr>
      <td style="padding:9px 8px;border-bottom:1px solid #eef2ee;font-size:0.86rem;color:#111827;">${esc(it.name)}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #eef2ee;font-size:0.86rem;color:#374151;text-align:center;">${esc(it.quantity)}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #eef2ee;font-size:0.86rem;color:#374151;text-align:right;">${inr(it.price)}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #eef2ee;font-size:0.86rem;color:#111827;text-align:right;font-weight:700;">${inr(Number(it.price) * Number(it.quantity))}</td>
    </tr>`).join('');
  return `
    <div style="padding:6px 28px 4px;">
      <div style="font-size:0.72rem;font-weight:800;color:${GREEN};text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px;">Items Ordered</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f5f8f5;">
            <th style="padding:8px;text-align:left;font-size:0.72rem;color:#6b7280;text-transform:uppercase;">Product</th>
            <th style="padding:8px;text-align:center;font-size:0.72rem;color:#6b7280;text-transform:uppercase;">Qty</th>
            <th style="padding:8px;text-align:right;font-size:0.72rem;color:#6b7280;text-transform:uppercase;">Price</th>
            <th style="padding:8px;text-align:right;font-size:0.72rem;color:#6b7280;text-transform:uppercase;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Amount breakdown box (subtotal / discount / gst / total). breakdown is an
// ordered {label: value} map; the LAST entry is rendered as the grand total.
function amountBox(breakdown) {
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return '';
  const lines = entries.map(([label, value], i) => {
    const isTotal = i === entries.length - 1;
    return `
      <tr>
        <td style="padding:${isTotal ? '12px 8px 4px' : '4px 8px'};text-align:right;color:${isTotal ? GREEN : '#6b7280'};font-size:${isTotal ? '0.95rem' : '0.85rem'};font-weight:${isTotal ? '800' : '600'};${isTotal ? `border-top:2px solid ${GREEN};` : ''}">${esc(label)}</td>
        <td style="padding:${isTotal ? '12px 8px 4px' : '4px 8px'};text-align:right;color:${isTotal ? GREEN : '#111827'};font-size:${isTotal ? '1.1rem' : '0.9rem'};font-weight:${isTotal ? '800' : '700'};width:130px;${isTotal ? `border-top:2px solid ${GREEN};` : ''}">${esc(value)}</td>
      </tr>`;
  }).join('');
  return `
    <div style="padding:6px 28px 14px;">
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">${lines}</table>
    </div>`;
}

function brandFooter() {
  return `
    <div style="padding:18px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:0.82rem;color:#374151;font-weight:700;">${esc(BRAND_NAME)} <span style="color:#9ca3af;font-weight:500;">· ${esc(BRAND_TAGLINE)}</span></div>
      <div style="font-size:0.74rem;color:#9ca3af;margin-top:4px;">
        Automated finance notification · ${esc(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST<br>
        <a href="${esc(BRAND_SITE)}" style="color:${GREEN};text-decoration:none;">${esc(BRAND_SITE.replace(/^https?:\/\//, ''))}</a>
      </div>
    </div>`;
}

// Send a richly-formatted, branded new-revenue notification to finance.
// Params:
//   kind        'Booking' | 'Subscription' | 'Order'
//   reference   human reference (booking_number / SUB-id / order_number)
//   title       header strip text (defaults from kind)
//   summary     {label: value}  — top summary block
//   customer    {label: value}  — customer/contact block
//   details     {label: value}  — service/delivery block
//   items       [{name, quantity, price}] — order line items (optional)
//   breakdown   {label: value}  — amount breakdown (last line = grand total)
//   amount      number — used for the subject line
// Best-effort: never throws (payment flow must not be blocked by email).
async function sendFinanceNotification({ kind, reference, title, summary = {}, customer = {}, details = {}, items = [], breakdown = {}, amount = 0 }) {
  try {
    const headerTitle = title || `💰 New ${kind} — Payment Received`;
    const html = `
      <div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;">
        ${brandHeader(headerTitle)}
        ${Object.keys(summary).length ? fieldSection('Summary', summary) : ''}
        ${Object.keys(customer).length ? fieldSection('Customer', customer) : ''}
        ${Object.keys(details).length ? fieldSection(kind === 'Order' ? 'Delivery' : 'Service Details', details) : ''}
        ${itemsTable(items)}
        ${Object.keys(breakdown).length ? amountBox(breakdown) : ''}
        ${brandFooter()}
      </div>`;

    await transporter.sendMail({
      from: FROM,
      to: FINANCE_EMAIL,
      subject: `[${BRAND_NAME} Finance] New ${kind} ${reference} — ${inr(amount)}`,
      html,
    });
  } catch (err) {
    console.error('[email] sendFinanceNotification failed:', err.message);
  }
}

module.exports = { sendCareerApplication, sendFinanceNotification };
