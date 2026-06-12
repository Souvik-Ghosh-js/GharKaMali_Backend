// Query MSG91 for the delivery status / logs of recent SMS, and check balance.
// Usage:
//   node test-msg91-status.js                 -> today's SMS logs + balance
//   node test-msg91-status.js <requestId>     -> status for one request id
// Delete this file after debugging.
require('dotenv').config();
const axios = require('axios');

const authkey = (process.env.MSG91_AUTH_KEY || '').trim();
const reqId = process.argv[2];

if (!authkey) { console.error('MSG91_AUTH_KEY missing in .env'); process.exit(1); }

const H = { headers: { authkey, accept: 'application/json' } };
const show = (label, p) => p
  .then((r) => { console.log(`\n── ${label} (HTTP ${r.status}) ──`); console.log(JSON.stringify(r.data, null, 2)); })
  .catch((e) => { console.log(`\n── ${label} FAILED (HTTP ${e.response?.status}) ──`); console.log(JSON.stringify(e.response?.data || e.message, null, 2)); });

(async () => {
  // 1) SMS wallet balance — a "success" submit still silently drops with 0 credits.
  await show('SMS BALANCE', axios.get('https://control.msg91.com/api/v5/getbalance?type=4', H));

  // 2) Per-request delivery report (if a request id was passed).
  if (reqId) {
    await show(`REQUEST ${reqId}`,
      axios.get(`https://control.msg91.com/api/v5/report/${reqId}`, H));
    await show(`ANALYTICS for ${reqId}`,
      axios.get(`https://control.msg91.com/api/v5/report/analytics?request_id=${reqId}`, H));
  }

  // 3) Today's SMS logs.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await show(`SMS LOGS (${today})`,
    axios.get(`https://control.msg91.com/api/v5/report/logs/p/sms?startDate=${today}&endDate=${today}`, H));
})();
