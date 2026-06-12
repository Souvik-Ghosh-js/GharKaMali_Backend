// Inspect an MSG91 SMS template to see its EXACT variable names, so we send the
// right keys (MSG91 only substitutes a variable whose key matches the template).
// Usage: node test-msg91-template.js <msg91_template_id>
// Delete after debugging.
require('dotenv').config();
const axios = require('axios');

const authkey = (process.env.MSG91_AUTH_KEY || '').trim();
const tid = (process.argv[2] || process.env.MSG91_TEMPLATE_ID || '').trim();
if (!authkey || !tid) { console.error('Need MSG91_AUTH_KEY in .env and a template id arg'); process.exit(1); }

const H = { headers: { authkey, accept: 'application/json' } };
const show = (label, p) => p
  .then((r) => { console.log(`\n── ${label} (HTTP ${r.status}) ──`); console.log(JSON.stringify(r.data, null, 2)); })
  .catch((e) => { console.log(`\n── ${label} FAILED (HTTP ${e.response?.status}) ──`); console.log(JSON.stringify(e.response?.data || e.message, null, 2)); });

(async () => {
  // Different MSG91 accounts expose templates under slightly different paths —
  // try the common ones and print whatever returns the template body + variables.
  await show('TEMPLATE (v5)', axios.get(`https://control.msg91.com/api/v5/sms/get-template/?template_id=${tid}`, H));
  await show('TEMPLATE (v5 alt)', axios.get(`https://control.msg91.com/api/v5/sms/template/${tid}`, H));
  await show('TEMPLATE LIST', axios.get('https://control.msg91.com/api/v5/sms/get-templates/', H));
})();
