// ─────────────────────────────────────────────────────────────────────────────
// One-time gardening service pricing — follows "GharKaMali One-Time Gardening
// Service Dynamic Pricing – Developer Specification" (Nov 2026).
//
//   Service charge = zone base price (covers the first 10 plants)
//                  + Σ (additional plants in each interval × that interval's rate)
//
// Progressive: each interval's rate applies ONLY to the plants inside that
// interval, so the total can never drop when plants are added. The zone's own
// base price is kept as-is (a ₹499 zone starts at ₹499); only the per-plant
// interval rates and the vermicompost add-on prices come from the spec by
// default, and every zone can override them from the admin panel.
// Rounding to the nearest rupee happens ONCE, after the full amount is summed.
// Money is summed in integer paise so ₹30.20 × 3 never drifts.
//
// Pure functions here (no DB) so they can be unit-tested; DB helpers at the
// bottom require the models lazily.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_PLANTS = 10;              // plants covered by the zone base price
const MIN_PLANTS = BASE_PLANTS;      // minimum selectable quantity
const SPEC_MAX_PLANTS = 200;         // intervals must cover 11..200 with no gaps
const MAX_PLANT_LIMIT = 1000;        // sanity cap for admin-entered interval max
const FALLBACK_BASE_PRICE = 349;     // only if a zone has no usable base price
const GST_RATE = 0.18;               // 18% GST on top (same as every booking)

// Spec section 2 — incremental rate per additional plant in each interval.
const DEFAULT_INTERVALS = [
  { min: 11, max: 15, rate: 30.2 },
  { min: 16, max: 20, rate: 20 },
  { min: 21, max: 30, rate: 15 },
  { min: 31, max: 40, rate: 15 },
  { min: 41, max: 50, rate: 10 },
  { min: 51, max: 60, rate: 20 },
  { min: 61, max: 70, rate: 20 },
  { min: 71, max: 80, rate: 20 },
  { min: 81, max: 100, rate: 20 },
  { min: 101, max: 150, rate: 10 },
  { min: 151, max: 200, rate: 10 },
];

// Spec section 9 — optional vermicompost add-on.
const VERMICOMPOST_SIZES = [1, 5, 10];
const DEFAULT_VERMICOMPOST = [
  { kg: 1, price: 100 },
  { kg: 5, price: 300 },
  { kg: 10, price: 580 },
];

const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const isNum = (v) => v !== null && v !== '' && Number.isFinite(Number(v));

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

// ── Validation ───────────────────────────────────────────────────────────────

function normalizeIntervals(list) {
  return (Array.isArray(list) ? list : []).map((iv) => ({
    min: Number(iv?.min),
    max: Number(iv?.max),
    rate: isNum(iv?.rate) ? round2(iv.rate) : NaN,
  }));
}

// Intervals must start at 11, be continuous (no gaps / overlaps), reach at
// least 200 plants, and every rate must be > 0 so the total always increases.
function validateIntervals(list) {
  if (!Array.isArray(list) || !list.length) return 'Add at least one plant-quantity interval';
  let prevMax = BASE_PLANTS;
  for (const iv of list) {
    const { min, max, rate } = iv;
    if (!Number.isInteger(min) || !Number.isInteger(max)) return 'Each interval needs whole-number From and To plant counts';
    const label = `${min}–${max} plants`;
    if (min !== prevMax + 1) {
      return min > prevMax + 1
        ? `${label}: gap after ${prevMax} plants — must start at ${prevMax + 1}`
        : `${label}: overlaps the previous interval — must start at ${prevMax + 1}`;
    }
    if (max < min) return `${label}: To is below From`;
    if (!Number.isFinite(rate) || rate <= 0) return `${label}: rate per plant must be more than ₹0 (the total must always increase with more plants)`;
    prevMax = max;
  }
  if (prevMax < SPEC_MAX_PLANTS) return `Intervals must cover every quantity up to ${SPEC_MAX_PLANTS} plants (they stop at ${prevMax})`;
  if (prevMax > MAX_PLANT_LIMIT) return `Intervals cannot go beyond ${MAX_PLANT_LIMIT} plants`;
  return null;
}

function normalizeVermicompost(list) {
  return (Array.isArray(list) ? list : [])
    .map((v) => ({ kg: Number(v?.kg), price: isNum(v?.price) ? round2(v.price) : NaN }))
    .sort((a, b) => a.kg - b.kg);
}

function validateVermicompost(list) {
  if (!Array.isArray(list)) return 'Vermicompost prices are required';
  for (const kg of VERMICOMPOST_SIZES) {
    const rows = list.filter((v) => v.kg === kg);
    if (rows.length !== 1) return `Enter one price for ${kg} kg vermicompost`;
    if (!Number.isFinite(rows[0].price) || rows[0].price <= 0) return `${kg} kg vermicompost: price must be more than ₹0`;
  }
  if (list.length !== VERMICOMPOST_SIZES.length) return `Vermicompost comes only in ${VERMICOMPOST_SIZES.join(', ')} kg`;
  return null;
}

function validateBasePrice(v) {
  if (!isNum(v) || Number(v) <= 0) return 'Base price (first 10 plants) must be more than ₹0';
  return null;
}

// ── Zone pricing config ──────────────────────────────────────────────────────

// Resolve a Geofence row (or plain object) into the pricing config used for
// quotes. A zone with no saved table falls back to the spec defaults.
function zonePricing(zone) {
  const saved = normalizeIntervals(parseJson(zone?.plant_rate_intervals));
  const intervalsOk = saved.length && !validateIntervals(saved);
  const vSaved = normalizeVermicompost(parseJson(zone?.vermicompost_prices));
  const vOk = vSaved.length && !validateVermicompost(vSaved);
  const intervals = intervalsOk ? saved : DEFAULT_INTERVALS.map((i) => ({ ...i }));
  const base = Number(zone?.base_price) > 0 ? round2(zone.base_price) : FALLBACK_BASE_PRICE;
  return {
    zone_id: zone?.id ?? null,
    zone_name: zone?.name ?? null,
    base_price: base,
    base_plants: BASE_PLANTS,
    min_plants: MIN_PLANTS,
    max_plants: intervals[intervals.length - 1].max,
    intervals,
    vermicompost: vOk ? vSaved : DEFAULT_VERMICOMPOST.map((v) => ({ ...v })),
    uses_default_rates: !intervalsOk,
    uses_default_vermicompost: !vOk,
  };
}

// ── Calculations ─────────────────────────────────────────────────────────────

// Gardening service charge for a plant quantity.
//  - below 10 → priced as 10 (minimum quantity), flagged `clamped`
//  - above the last interval → { ok:false, code:'CUSTOM_QUOTE' } unless
//    `extendBeyondMax` (used only for extra plants found during a visit, which
//    cannot be refused: the last interval's rate continues).
function serviceCharge(quantity, pricing, { extendBeyondMax = false } = {}) {
  const asked = parseInt(quantity, 10);
  const plants = Number.isInteger(asked) && asked >= MIN_PLANTS ? asked : MIN_PLANTS;
  const intervals = pricing.intervals;
  const maxPlants = intervals[intervals.length - 1].max;
  if (plants > maxPlants && !extendBeyondMax) {
    return { ok: false, code: 'CUSTOM_QUOTE', plants, max_plants: maxPlants };
  }
  let paise = toPaise(pricing.base_price);
  const breakdown = [];
  intervals.forEach((iv, idx) => {
    const top = (extendBeyondMax && idx === intervals.length - 1) ? Math.max(iv.max, plants) : iv.max;
    const count = Math.max(0, Math.min(plants, top) - iv.min + 1);
    if (count > 0) {
      const p = count * toPaise(iv.rate);
      paise += p;
      breakdown.push({ min: iv.min, max: iv.max, plants: count, rate: iv.rate, amount: p / 100 });
    }
  });
  return {
    ok: true,
    plants,
    clamped: plants !== asked,
    base_price: pricing.base_price,
    base_plants: BASE_PLANTS,
    raw_amount: paise / 100,           // before rounding
    amount: Math.round(paise / 100),   // customer amount — nearest ₹1
    breakdown,
  };
}

// Selected vermicompost pack, or null when not chosen. Throws on an unknown size.
function vermicompostLine(kg, pricing) {
  if (kg === undefined || kg === null || kg === '' || Number(kg) === 0) return null;
  const want = Number(kg);
  const row = pricing.vermicompost.find((v) => v.kg === want);
  if (!row) {
    const e = new Error(`Vermicompost is available in ${VERMICOMPOST_SIZES.join(', ')} kg only`);
    e.httpStatus = 400;
    throw e;
  }
  return { kg: row.kg, amount: round2(row.price) };
}

// ── Surcharges (admin rules, spec section 11) ────────────────────────────────

const ymd = (d) => (d ? String(d).slice(0, 10) : null);

function surchargeApplies(s, zoneId, dateStr) {
  if (!s || !s.is_active) return false;
  if (s.zone_scope !== 'all') {
    const ids = (parseJson(s.zone_ids) || []).map(Number);
    if (!zoneId || !ids.includes(Number(zoneId))) return false;
  }
  const day = ymd(dateStr);
  const from = ymd(s.starts_on);
  const to = ymd(s.ends_on);
  if (from && day && day < from) return false;
  if (to && day && day > to) return false;
  return true;
}

function surchargeAmount(s, serviceAmount) {
  const value = Number(s.value) || 0;
  if (s.type === 'percentage') return Math.round((Number(serviceAmount) || 0) * value / 100);
  return round2(value);
}

// Applicable surcharge lines for a booking — each surcharge at most once.
function computeSurcharges(all, { zoneId, date, serviceAmount }) {
  const seen = new Set();
  const lines = [];
  for (const s of all || []) {
    if (seen.has(s.id) || !surchargeApplies(s, zoneId, date)) continue;
    seen.add(s.id);
    const amount = surchargeAmount(s, serviceAmount);
    if (amount <= 0) continue;
    lines.push({
      id: s.id,
      name: s.name,
      reason: s.reason || null,
      type: s.type,
      value: Number(s.value),
      basis: s.type === 'percentage' ? `${Number(s.value)}% of the gardening service charge` : 'Fixed amount',
      amount,
    });
  }
  return lines;
}

// ── Full quote ───────────────────────────────────────────────────────────────

// Final payable = zone service charge + vermicompost + other add-ons
//               + surcharges, then 18% GST on top (coupons are applied by the
//               caller against `subtotal`, exactly as before).
function buildQuote({ pricing, plantCount, vermicompostKg, surcharges = [], date, addonTotal = 0 }) {
  const service = serviceCharge(plantCount, pricing);
  if (!service.ok) return { ok: false, code: service.code, max_plants: service.max_plants, plants: service.plants };
  const vermicompost = vermicompostLine(vermicompostKg, pricing);
  const surchargeLines = computeSurcharges(surcharges, {
    zoneId: pricing.zone_id, date, serviceAmount: service.amount,
  });
  const surchargeTotal = round2(surchargeLines.reduce((s, l) => s + l.amount, 0));
  const subtotal = round2(service.amount + (vermicompost?.amount || 0) + (Number(addonTotal) || 0) + surchargeTotal);
  const total = round2(subtotal * (1 + GST_RATE));
  return {
    ok: true,
    zone_id: pricing.zone_id,
    plants: service.plants,
    service,
    vermicompost,
    addon_total: round2(Number(addonTotal) || 0),
    surcharges: surchargeLines,
    surcharge_total: surchargeTotal,
    subtotal,
    gst_rate: GST_RATE,
    gst_amount: round2(total - subtotal),
    total,
  };
}

// What a booking keeps so a later admin price change never alters it.
function pricingSnapshot(pricing, quote) {
  return {
    zone_id: pricing.zone_id,
    base_price: pricing.base_price,
    base_plants: BASE_PLANTS,
    intervals: pricing.intervals,
    vermicompost: pricing.vermicompost,
    plants: quote.plants,
    service_raw_amount: quote.service.raw_amount,
    service_amount: quote.service.amount,
    priced_at: new Date().toISOString(),
  };
}

// Legacy per-plant slab view for app builds released before this change:
// they add zone.base_price + slab.extra, so one slab per plant count with
// extra = exact progressive increment reproduces the new price for them.
function legacySlabs(pricing) {
  const slabs = [];
  for (let n = BASE_PLANTS + 1; n <= pricing.max_plants; n++) {
    const s = serviceCharge(n, pricing);
    slabs.push({ min: n, max: n, extra: Math.round(s.raw_amount - pricing.base_price) });
  }
  return slabs;
}

// ── DB helpers ───────────────────────────────────────────────────────────────

let surchargeCache = { rows: null, at: 0 };
const SURCHARGE_CACHE_MS = 30 * 1000;

async function getActiveSurcharges() {
  if (surchargeCache.rows && Date.now() - surchargeCache.at < SURCHARGE_CACHE_MS) return surchargeCache.rows;
  const { Surcharge } = require('../models');
  const rows = (await Surcharge.findAll({ where: { is_active: true }, order: [['id', 'ASC']] }))
    .map((r) => r.get({ plain: true }));
  surchargeCache = { rows, at: Date.now() };
  return rows;
}

function invalidateSurchargeCache() { surchargeCache = { rows: null, at: 0 }; }

function todayIST() {
  const now = new Date(Date.now() + 330 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

async function logPricingAudit({ entity_type, entity_id, zone_id = null, action, before = null, after = null, actor_id = null, note = null }, opts = {}) {
  try {
    const { PricingAudit } = require('../models');
    await PricingAudit.create({
      entity_type, entity_id, zone_id, action,
      before_value: before, after_value: after, actor_id, note,
    }, opts);
  } catch (e) {
    console.error('[pricing] audit write failed:', e.message);
  }
}

module.exports = {
  BASE_PLANTS, MIN_PLANTS, SPEC_MAX_PLANTS, GST_RATE,
  DEFAULT_INTERVALS, DEFAULT_VERMICOMPOST, VERMICOMPOST_SIZES,
  parseJson, round2,
  normalizeIntervals, validateIntervals, normalizeVermicompost, validateVermicompost, validateBasePrice,
  zonePricing, serviceCharge, vermicompostLine,
  surchargeApplies, computeSurcharges, buildQuote, pricingSnapshot, legacySlabs,
  getActiveSurcharges, invalidateSurchargeCache, todayIST, logPricingAudit,
};
