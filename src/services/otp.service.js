const axios = require('axios');

// Generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Send OTP via MSG91 or static
const sendOTP = async (phone, otp) => {
  if (process.env.USE_STATIC_OTP === 'true') {
    console.log(`[DEV] OTP for ${phone}: ${otp}`);
    return { success: true, method: 'static' };
  }
  try {
    const response = await axios.post('https://api.msg91.com/api/v5/otp', {
      template_id: process.env.MSG91_TEMPLATE_ID,
      mobile: `91${phone}`,
      authkey: process.env.MSG91_AUTH_KEY,
      otp
    });
    return { success: true, method: 'msg91', response: response.data };
  } catch (err) {
    console.error('MSG91 error:', err.message);
    return { success: false, error: err.message };
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
    `🌿 *Ghar Ka Mali*\nHello ${name}! Your garden visit is confirmed for *${date}* at *${time}*. Our gardener is on the way! 🌱`,

  gardenerEnRoute: (name, gardenerName, eta) =>
    `🚶 *Ghar Ka Mali*\nHi ${name}! Your gardener *${gardenerName}* is on the way. Expected arrival: *${eta} minutes*. Share OTP when they arrive.`,

  gardenerArrived: (name, otp) =>
    `✅ *Ghar Ka Mali*\nHi ${name}! Your gardener has arrived. Your OTP is *${otp}*. Please share it to start the service.`,

  visitCompleted: (name, amount) =>
    `🎉 *Ghar Ka Mali*\nThank you ${name}! Your garden visit is complete. Total: ₹${amount}. Rate your experience in the app!`,

  subscriptionRenewed: (name, planName, endDate) =>
    `🔄 *Ghar Ka Mali*\nHi ${name}! Your *${planName}* subscription has been renewed until *${endDate}*. Happy gardening! 🌺`,

  welcomeGardener: (name) =>
    `🌿 *Ghar Ka Mali*\nWelcome ${name}! Your account has been approved. Start accepting jobs from the Gardener App!`
};

module.exports = { generateOTP, sendOTP, sendWhatsApp, templates };
