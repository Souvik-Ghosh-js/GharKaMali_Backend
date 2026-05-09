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

module.exports = { sendCareerApplication };
