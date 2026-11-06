// ─────────────────────────────────────────────────────────────────────────────
// Blocked booking dates — admin-managed days on which NEW customer bookings
// are closed (holidays, staff off-days, capacity freezes).
//
// Stored as one SystemSetting row ('blocked_booking_dates') holding
// [{ date: 'YYYY-MM-DD', reason?: '…' }] — no new table needed.
//
// Enforced at: slot availability (check-availability), customer booking
// creation and customer reschedule. Admin flows (manual invoices / offline
// bookings) are deliberately NOT blocked — the admin is the one closing the
// dates, they can still book by hand.
// ─────────────────────────────────────────────────────────────────────────────
const { SystemSetting } = require('../models');

const SETTING_KEY = 'blocked_booking_dates';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Availability is hit on every date tap in the clients — cache briefly.
const CACHE_MS = 30 * 1000;
let cache = null;
let cacheAt = 0;

// Dedupe by date, drop malformed entries, trim reasons, sort ascending.
function normalize(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const date = String((item && item.date) || '').slice(0, 10);
    if (!DATE_RE.test(date) || seen.has(date)) continue;
    seen.add(date);
    const reason = String((item && item.reason) || '').trim().slice(0, 200);
    out.push(reason ? { date, reason } : { date });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function getBlockedDates() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const row = await SystemSetting.findOne({ where: { key: SETTING_KEY } });
    cache = row && row.value ? normalize(JSON.parse(row.value)) : [];
  } catch (e) {
    // Unreadable setting must never take bookings down — treat as "none blocked".
    console.error('[blockedDates] read failed:', e.message);
    cache = cache || [];
  }
  cacheAt = Date.now();
  return cache;
}

async function saveBlockedDates(list) {
  const value = normalize(list);
  const json = JSON.stringify(value);
  const [row, created] = await SystemSetting.findOrCreate({
    where: { key: SETTING_KEY }, defaults: { value: json },
  });
  if (!created) await row.update({ value: json });
  cache = value;
  cacheAt = Date.now();
  return value;
}

// date: 'YYYY-MM-DD' (longer datetime strings are truncated to the day).
// Returns the blocked entry ({date, reason?}) or null.
async function isDateBlocked(date) {
  const d = String(date || '').slice(0, 10);
  if (!DATE_RE.test(d)) return null;
  const list = await getBlockedDates();
  return list.find((e) => e.date === d) || null;
}

const blockedMessage = (entry) =>
  `Bookings are closed on this date${entry && entry.reason ? ` — ${entry.reason}` : ''}. Please pick another day.`;

module.exports = { getBlockedDates, saveBlockedDates, isDateBlocked, blockedMessage, SETTING_KEY };
