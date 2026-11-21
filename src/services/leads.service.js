// ─────────────────────────────────────────────────────────────────────────────
// Lead sheet sync — pulls the marketing lead sheet (a Google Sheet) into the
// `leads` table so the admin panel can track and manage every lead (contacted,
// follow-up, booked …) without anyone editing the sheet itself.
//
// How it works:
//   • The sheet must be link-viewable (Share → Anyone with the link → Viewer).
//     We read its CSV export — no Google API key or service account needed.
//   • Every sheet column is kept verbatim in `raw` (header → value), and the
//     common fields (name/phone/email/city/service/source/date) are mapped by
//     header heuristics so the sheet's exact wording doesn't matter.
//   • Rows are upserted by a stable key (normalised phone, else a content
//     hash). Sheet edits update the sheet-derived fields; the admin-managed
//     fields (status / notes / follow-up) are NEVER touched by a sync, and
//     rows deleted from the sheet are kept here (an audit trail of leads).
//   • Config lives in SystemSetting 'leads_sheet_config' { sheet_id, gid,
//     sheet_url } — the admin can point it at a different sheet/tab anytime.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const axios = require('axios');

const SETTING_KEY = 'leads_sheet_config';
// The lead sheet this was set up with (overridable from the admin panel).
const DEFAULT_CONFIG = {
  sheet_id: '1M3rwNSQq4wqjYTlotwmAqa38efFTOR7WjkUkpoLAikw',
  gid: '1280718891',
};
const SYNC_COOLDOWN_MS = 2 * 60 * 1000; // auto-sync at most every 2 minutes
const MAX_ROWS = 10000;                  // sanity cap per sync

let lastSync = { at: 0, ok: null, error: null, added: 0, updated: 0, total: 0 };

// ── Config ───────────────────────────────────────────────────────────────────

// Accepts a full Google Sheets URL (with optional #gid=…) or a bare sheet id.
function parseSheetUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const idMatch = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || s.match(/^([a-zA-Z0-9-_]{20,})$/);
  if (!idMatch) return null;
  const gidMatch = s.match(/[#&?]gid=(\d+)/);
  return { sheet_id: idMatch[1], gid: gidMatch ? gidMatch[1] : '0' };
}

async function getConfig() {
  try {
    const { SystemSetting } = require('../models');
    const row = await SystemSetting.findOne({ where: { key: SETTING_KEY } });
    if (row && row.value) {
      const v = JSON.parse(row.value);
      if (v && v.sheet_id) return v;
    }
  } catch (e) { console.error('[leads] config read failed:', e.message); }
  return { ...DEFAULT_CONFIG };
}

async function saveConfig(sheetUrl) {
  const parsed = parseSheetUrl(sheetUrl);
  if (!parsed) {
    const e = new Error('That does not look like a Google Sheets link. Paste the full sheet URL.');
    e.httpStatus = 400;
    throw e;
  }
  const value = { ...parsed, sheet_url: String(sheetUrl).trim() };
  const { SystemSetting } = require('../models');
  const [row, created] = await SystemSetting.findOrCreate({
    where: { key: SETTING_KEY }, defaults: { value: JSON.stringify(value) },
  });
  if (!created) await row.update({ value: JSON.stringify(value) });
  lastSync = { at: 0, ok: null, error: null, added: 0, updated: 0, total: 0 }; // force next sync
  return value;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

// Minimal RFC-4180 parser: quoted fields, embedded commas/quotes/newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

async function fetchSheetRows(config) {
  const url = `https://docs.google.com/spreadsheets/d/${config.sheet_id}/export?format=csv&gid=${config.gid || '0'}`;
  let res;
  try {
    res = await axios.get(url, {
      responseType: 'text', maxRedirects: 5, timeout: 20000,
      // Google answers HTML login pages with 200 sometimes; keep errors as errors.
      validateStatus: (s) => s >= 200 && s < 300,
    });
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401 || status === 403) {
      const e = new Error("The Google Sheet is private. Open it → Share → General access → 'Anyone with the link' → Viewer, then sync again.");
      e.httpStatus = 409;
      throw e;
    }
    if (status === 404) {
      const e = new Error('Sheet not found — check the sheet link in the Leads settings.');
      e.httpStatus = 409;
      throw e;
    }
    const e = new Error(`Could not reach Google Sheets (${status || err.code || err.message}). Try again in a minute.`);
    e.httpStatus = 502;
    throw e;
  }
  const body = String(res.data || '');
  if (/<html/i.test(body.slice(0, 200))) {
    const e = new Error("Google returned a sign-in page — the sheet is private. Share it as 'Anyone with the link → Viewer' and sync again.");
    e.httpStatus = 409;
    throw e;
  }
  return parseCsv(body);
}

// ── Header mapping ───────────────────────────────────────────────────────────

const HEADER_MAP = [
  ['name',    /^(full ?name|name|customer|client|lead name)/i],
  ['phone',   /phone|mobile|whats ?app|contact ?(no|number)?$|number/i],
  ['email',   /e-?mail/i],
  ['city',    /city|location|area|locality|address|pincode|zone/i],
  ['service', /service|interest|plan|requirement|package|looking|product|type/i],
  ['source',  /source|campaign|platform|medium|utm|channel|ad ?set/i],
  ['date',    /time ?stamp|date|created|submitted|entry/i],
];

// header index per mapped field: first header that matches and isn't taken.
function mapHeaders(headers) {
  const picked = {};
  const used = new Set();
  for (const [field, re] of HEADER_MAP) {
    const idx = headers.findIndex((h, i) => !used.has(i) && re.test(String(h || '').trim()));
    if (idx >= 0) { picked[field] = idx; used.add(idx); }
  }
  return picked;
}

const normPhone = (v) => {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
};

// Sheet dates: "20/11/2026" (Indian DD/MM/YYYY — what our lead sheet uses),
// optionally with a time, or ISO "2026-11-25". When both slash parts could be
// a month we read DD/MM, falling back to MM/DD only when DD/MM is impossible.
function parseSheetDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (slash) {
    const a = +slash[1], b = +slash[2];
    const [day, month] = b > 12 ? [b, a] : [a, b]; // default DD/MM; flip only if MM/DD is the only valid read
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(+slash[3], month - 1, day, +(slash[4] || 12), +(slash[5] || 0), +(slash[6] || 0)));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
  return isNaN(d.getTime()) ? null : d;
}

// ── Seeding the panel status from the sheet's own tracking columns ──────────
// The lead sheet carries Status / Disposition / Lead Contacted / Next Followup
// columns the team already fills. A NEW lead starts from them so nobody
// re-triages old leads; after that, the panel owns these fields and a sync
// never touches them again.
function rawField(raw, re) {
  const k = Object.keys(raw).find((h) => re.test(h));
  return k ? String(raw[k] || '').trim() : '';
}

function seedStatus(raw) {
  const txt = `${rawField(raw, /^status/i)} ${rawField(raw, /^disposition/i)}`.toLowerCase();
  if (/book|converted|won/.test(txt)) return 'booked';
  if (/not ?interest|lost|dead|dnd/.test(txt)) return 'not_interested';
  if (/invalid|wrong ?number|junk|spam|^test/.test(txt)) return 'invalid';
  if (/callback|follow/.test(txt)) return 'follow_up';
  if (/^y(es)?$/i.test(rawField(raw, /contacted/i)) || /contacted|responded|spoke/.test(txt)) return 'contacted';
  return 'new';
}

function seedFollowUp(raw) {
  const d = parseSheetDate(rawField(raw, /next ?follow ?-? ?up/i));
  return d ? d.toISOString().slice(0, 10) : null;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function syncLeads({ force = false } = {}) {
  if (!force && Date.now() - lastSync.at < SYNC_COOLDOWN_MS) return lastSync;

  const config = await getConfig();
  try {
    const rows = await fetchSheetRows(config);
    if (rows.length < 1) throw Object.assign(new Error('The sheet looks empty.'), { httpStatus: 409 });
    const headers = rows[0].map((h) => String(h || '').trim());
    const map = mapHeaders(headers);
    const { Lead } = require('../models');

    // One-time cleanup: drop untouched rows from the short-lived first key
    // scheme (plain ph:<10 digits>) so the per-enquiry keys don't duplicate
    // them. Rows an admin already worked on are never deleted.
    try {
      const { Op } = require('sequelize');
      await Lead.destroy({ where: { sheet_key: { [Op.regexp]: '^ph:[0-9]{10}$' }, status: 'new', notes: null } });
    } catch (_) { /* best-effort */ }

    let added = 0, updated = 0;
    const seen = new Set();
    for (const cells of rows.slice(1, MAX_ROWS + 1)) {
      const raw = {};
      headers.forEach((h, i) => { if (h) raw[h] = String(cells[i] ?? '').trim(); });
      const get = (f) => (map[f] !== undefined ? String(cells[map[f]] ?? '').trim() : '');
      const phone = normPhone(get('phone'));
      const name = get('name');
      const email = get('email');
      // Stable identity: the same person can enquire more than once, so the
      // key is phone + booking id when the row has one, else phone + the
      // row's timestamp (one lead per person per day) — these never get
      // edited, so sheet edits to other columns can't duplicate the lead.
      // Phoneless rows fall back to a content hash.
      const bookingId = rawField(raw, /booking ?(id|no)/i);
      const key = phone
        ? `ph:${phone}:${crypto.createHash('sha1').update((bookingId || get('date')).toLowerCase()).digest('hex').slice(0, 12)}`
        : `h:${crypto.createHash('sha1').update([name, email, get('date'), get('city')].join('|').toLowerCase()).digest('hex')}`;
      if (seen.has(key)) continue; // duplicate row in the sheet → first one wins
      seen.add(key);

      const sheetFields = {
        name: name.slice(0, 200) || null,
        phone: phone || null,
        email: email.slice(0, 200) || null,
        city: get('city').slice(0, 120) || null,
        service: get('service').slice(0, 200) || null,
        source: get('source').slice(0, 120) || null,
        sheet_date: parseSheetDate(get('date')),
        raw: JSON.stringify(raw),
      };
      const existing = await Lead.findOne({ where: { sheet_key: key } });
      if (existing) {
        // Only rewrite when something from the sheet actually changed.
        const changed = Object.keys(sheetFields).some((k) => {
          const a = k === 'sheet_date'
            ? (existing[k] ? new Date(existing[k]).getTime() : null)
            : (existing[k] ?? null);
          const b = k === 'sheet_date'
            ? (sheetFields[k] ? sheetFields[k].getTime() : null)
            : (sheetFields[k] ?? null);
          return String(a) !== String(b);
        });
        if (changed) { await existing.update(sheetFields); updated++; }
      } else {
        await Lead.create({
          sheet_key: key,
          status: seedStatus(raw),
          follow_up_on: seedFollowUp(raw),
          ...sheetFields,
        });
        added++;
      }
    }
    lastSync = { at: Date.now(), ok: true, error: null, added, updated, total: rows.length - 1 };
  } catch (err) {
    lastSync = { at: Date.now(), ok: false, error: err.message, added: 0, updated: 0, total: 0 };
    console.error('[leads] sync failed:', err.message);
  }
  return lastSync;
}

module.exports = {
  getConfig, saveConfig, parseSheetUrl, syncLeads, parseCsv, SETTING_KEY,
  lastSyncInfo: () => lastSync,
  // Pure helpers, exported for tests/dry-runs.
  mapHeaders, parseSheetDate, seedStatus, seedFollowUp, normPhone, fetchSheetRows,
};
