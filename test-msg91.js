// Standalone MSG91 OTP tester. Usage:
//   node test-msg91.js 9876543210
// Reads MSG91_* from .env. Prints the EXACT request + MSG91's raw response so we
// can see precisely why a send is rejected. Delete this file after debugging.
require('dotenv').config();
const axios = require('axios');

const phone = (process.argv[2] || '').replace(/\D/g, '');
if (phone.length !== 10) {
  console.error('Usage: node test-msg91.js <10-digit-phone>');
  process.exit(1);
}

const templateId = (process.env.MSG91_TEMPLATE_ID || '').trim();
const authkey = (process.env.MSG91_AUTH_KEY || '').trim();
const senderId = (process.env.MSG91_SENDER_ID || 'GKMOTP').trim();
const varOtp = (process.env.MSG91_VAR_OTP || 'var1').trim();
const varExpiry = (process.env.MSG91_VAR_EXPIRY || 'var2').trim();
const otp = Math.floor(100000 + Math.random() * 900000).toString();

const payload = {
  template_id: templateId,
  sender: senderId,
  short_url: '0',
  recipients: [{ mobiles: `91${phone}`, [varOtp]: otp, [varExpiry]: '10' }],
};

console.log('── MSG91 config (from .env) ──');
console.log('template_id :', JSON.stringify(templateId), `(len ${templateId.length})`);
console.log('authkey     :', authkey ? `${authkey.slice(0, 4)}…${authkey.slice(-4)} (len ${authkey.length})` : '(MISSING)');
console.log('sender      :', JSON.stringify(senderId));
console.log('var names   :', varOtp, '/', varExpiry);
console.log('── Request payload ──');
console.log(JSON.stringify(payload, null, 2));

axios.post('https://control.msg91.com/api/v5/flow', payload, {
  headers: { authkey, 'Content-Type': 'application/json', accept: 'application/json' },
})
  .then((r) => { console.log('── SUCCESS', r.status, '──'); console.log(JSON.stringify(r.data, null, 2)); })
  .catch((e) => {
    console.log('── FAILED', e.response?.status, '──');
    console.log(JSON.stringify(e.response?.data || e.message, null, 2));
  });
