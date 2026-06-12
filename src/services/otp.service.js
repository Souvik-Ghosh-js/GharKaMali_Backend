const axios = require('axios');

// Generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Minutes the OTP stays valid — must match the value substituted into the
// DLT template's ##var2## ("expire in N minutes") and the expiry set on the user.
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);

// Send OTP via MSG91 Flow API (or static in dev).
//
// We use the FLOW API (not MSG91's managed /v5/otp) because the backend generates
// and verifies the OTP itself. The DLT-approved template is:
//   "Your GharKaMali login verification code is ##var1##. This code will expire
//    in ##var2## minutes. For security never share this code with anyone."
// var1 = the OTP, var2 = expiry minutes. Sender ID: GKMOTP.
const sendOTP = async (phone, otp) => {
  if (process.env.USE_STATIC_OTP === 'true') {
    console.log(`[DEV] OTP for ${phone}: ${otp}`);
    return { success: true, method: 'static' };
  }
  try {
    const response = await axios.post(
      'https://control.msg91.com/api/v5/flow/',
      {
        template_id: process.env.MSG91_TEMPLATE_ID,
        short_url: '0',
        recipients: [
          {
            mobiles: `91${phone}`,
            var1: otp,
            var2: String(OTP_EXPIRY_MINUTES),
          },
        ],
      },
      {
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
      }
    );
    return { success: true, method: 'msg91', response: response.data };
  } catch (err) {
    console.error('MSG91 error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
};

// Send WhatsApp via Twilio
const sendWhatsApp = async (phone, message) => {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID) {
      console.log(`[DEV] WhatsApp to ${phone}: ${message}`);
      return { success: true, method: 'mock' };
    }
    const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
      to: `whatsapp:+91${phone}`
    });
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error('Twilio error:', err.message);
    return { success: false, error: err.message };
  }
};

// WhatsApp message templates
const templates = {
  bookingConfirmed: (name, date, time) =>
    `🌿 *GharKaMali*\nHello ${name}! Your garden visit is confirmed for *${date}* at *${time}*. Our gardener is on the way! 🌱`,

  gardenerEnRoute: (name, gardenerName, eta) =>
    `🚶 *GharKaMali*\nHi ${name}! Your gardener *${gardenerName}* is on the way. Expected arrival: *${eta} minutes*. Share OTP when they arrive.`,

  gardenerArrived: (name, otp) =>
    `✅ *GharKaMali*\nHi ${name}! Your gardener has arrived. Your OTP is *${otp}*. Please share it to start the service.`,

  visitCompleted: (name, amount) =>
    `🎉 *GharKaMali*\nThank you ${name}! Your garden visit is complete. Total: ₹${amount}. Rate your experience in the app!`,

  visitReport: (name, bookingNumber, tasks, notes) => {
    const taskLines = tasks && tasks.length > 0
      ? tasks.map(t => `  ✅ ${t}`).join('\n')
      : '  (no tasks recorded)';
    const notesLine = notes ? `\n📝 *Gardener Notes:* ${notes}` : '';
    return `📋 *GharKaMali — Visit Report*\nHi ${name}, here is your service report for booking *${bookingNumber}*:\n\n*Tasks Completed:*\n${taskLines}${notesLine}\n\nBefore & after photos are available in the app. Rate your experience to help us improve! 🌿`;
  },

  subscriptionRenewed: (name, planName, endDate) =>
    `🔄 *GharKaMali*\nHi ${name}! Your *${planName}* subscription has been renewed until *${endDate}*. Happy gardening! 🌺`,

  welcomeGardener: (name) =>
    `🌿 *GharKaMali*\nWelcome ${name}! Your account has been approved. Start accepting jobs from the Gardener App!`
};

module.exports = { generateOTP, sendOTP, sendWhatsApp, templates, OTP_EXPIRY_MINUTES };
