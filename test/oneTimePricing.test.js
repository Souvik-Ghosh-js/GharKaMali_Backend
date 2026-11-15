// Acceptance tests from "One-Time Gardening Service Dynamic Pricing –
// Developer Specification" (sections 7, 9, 10, 11). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/services/oneTimePricing');

const specZone = P.zonePricing({ id: 1, name: 'Noida', base_price: 349 });
const price = (n, z = specZone) => P.serviceCharge(n, z).amount;

// ── Section 7: mandatory validation ─────────────────────────────────────────
test('reference totals (spec §7)', () => {
  const expected = { 10: 349, 15: 500, 20: 600, 30: 750, 40: 900, 50: 1000, 60: 1200, 70: 1400, 80: 1600, 100: 2000, 150: 2500, 200: 3000 };
  for (const [n, amt] of Object.entries(expected)) assert.equal(price(Number(n)), amt, `${n} plants`);
});

test('sample customer prices incl. rounding (spec §4)', () => {
  const rows = [[11, 379.2, 379], [12, 409.4, 409], [13, 439.6, 440], [14, 469.8, 470], [16, 520, 520], [17, 540, 540], [25, 675, 675]];
  for (const [n, raw, amt] of rows) {
    const s = P.serviceCharge(n, specZone);
    assert.equal(s.raw_amount, raw, `${n} raw`);
    assert.equal(s.amount, amt, `${n} rounded`);
  }
});

test('total never decreases across every quantity 10..200 (boundaries included)', () => {
  let prev = -1;
  for (let n = 10; n <= 200; n++) {
    const raw = P.serviceCharge(n, specZone).raw_amount;
    assert.ok(raw > prev, `${n} plants (${raw}) must cost more than ${n - 1}`);
    prev = raw;
  }
});

test('decreasing the quantity recalculates the lower total', () => {
  assert.equal(price(25), 675);
  assert.equal(price(24), 660);
  assert.equal(price(15), 500);
});

test('rounding happens once, after the full amount', () => {
  // 13 plants: 349 + 3 × 30.20 = 439.60 → 440 (per-plant rounding would give 439)
  assert.equal(P.serviceCharge(13, specZone).raw_amount, 439.6);
  assert.equal(price(13), 440);
});

test('minimum 10 plants; above the last interval → custom quote', () => {
  assert.equal(price(0), 349);
  assert.equal(price(5), 349);
  const over = P.serviceCharge(201, specZone);
  assert.equal(over.ok, false);
  assert.equal(over.code, 'CUSTOM_QUOTE');
});

test('zone base price is kept: a ₹499 zone starts at ₹499', () => {
  const z = P.zonePricing({ id: 9, base_price: 499 });
  assert.equal(price(10, z), 499);
  assert.equal(price(15, z), 650);   // 499 + 5 × 30.20
  assert.equal(price(25, z), 825);
});

test('interval validation: gaps, overlaps, zero rates, coverage to 200', () => {
  const ok = P.normalizeIntervals(P.DEFAULT_INTERVALS);
  assert.equal(P.validateIntervals(ok), null);
  const gap = ok.map((i) => ({ ...i })); gap[1].min = 17;
  assert.match(P.validateIntervals(gap), /gap/);
  const overlap = ok.map((i) => ({ ...i })); overlap[1].min = 15;
  assert.match(P.validateIntervals(overlap), /overlaps/);
  const zero = ok.map((i) => ({ ...i })); zero[3].rate = 0;
  assert.match(P.validateIntervals(zero), /more than ₹0/);
  assert.match(P.validateIntervals(ok.slice(0, -1)), /up to 200/);
  const late = ok.map((i) => ({ ...i })); late[0].min = 12;
  assert.match(P.validateIntervals(late), /must start at 11/);
});

// ── Section 9: vermicompost add-on ──────────────────────────────────────────
test('vermicompost add-on (spec §9)', () => {
  const q = (kg) => P.buildQuote({ pricing: specZone, plantCount: 10, vermicompostKg: kg, date: '2026-12-01' });
  assert.equal(q(null).vermicompost, null);
  assert.equal(q(null).subtotal, 349);
  assert.equal(q(1).subtotal, 449);
  assert.equal(q(5).subtotal, 649);
  assert.equal(q(10).subtotal, 929);
  assert.equal(q(0).subtotal, 349, 'removing the add-on removes its price');
  assert.throws(() => q(3), /1, 5, 10 kg/);
  assert.equal(P.validateVermicompost(P.normalizeVermicompost([{ kg: 1, price: 100 }, { kg: 5, price: 300 }])), 'Enter one price for 10 kg vermicompost');
});

// ── Section 10: zone-based pricing ──────────────────────────────────────────
const zoneA = P.zonePricing({ id: 1, base_price: 349 });
const zoneB = P.zonePricing({
  id: 2, base_price: 399,
  plant_rate_intervals: P.DEFAULT_INTERVALS.map((i) => ({ ...i, rate: i.rate + 5 })),
  vermicompost_prices: [{ kg: 1, price: 120 }, { kg: 5, price: 320 }, { kg: 10, price: 600 }],
});

test('same quantity, different zones → different totals (spec §10)', () => {
  assert.equal(price(20, zoneA), 600);
  assert.equal(price(20, zoneB), 399 + 5 * 35.2 + 5 * 25); // 700
  assert.notEqual(price(20, zoneA), price(20, zoneB));
});

test('vermicompost prices come from the selected zone', () => {
  assert.equal(P.vermicompostLine(5, zoneA).amount, 300);
  assert.equal(P.vermicompostLine(5, zoneB).amount, 320);
});

test('a price change in one zone does not touch another', () => {
  const before = price(30, zoneA);
  P.zonePricing({ id: 2, base_price: 999 }); // "edit" zone 2
  assert.equal(price(30, zoneA), before);
});

test('confirmed orders keep their price: snapshot re-prices identically after a rate change', () => {
  const q = P.buildQuote({ pricing: zoneA, plantCount: 25, date: '2026-12-01' });
  const snap = P.pricingSnapshot(zoneA, q);
  const fromSnap = P.zonePricing({ id: snap.zone_id, base_price: snap.base_price, plant_rate_intervals: snap.intervals });
  assert.equal(P.serviceCharge(25, fromSnap).amount, 675);
});

// ── Section 11: surcharges ──────────────────────────────────────────────────
const S = (o) => ({ id: 1, name: 'Peak demand', type: 'fixed', value: 50, zone_scope: 'all', zone_ids: null, starts_on: null, ends_on: null, is_active: true, ...o });
const quote = (surcharges, zone = zoneA, date = '2026-12-10') => P.buildQuote({ pricing: zone, plantCount: 20, surcharges, date });

test('no surcharge → no line, normal price', () => {
  const q = quote([]);
  assert.deepEqual(q.surcharges, []);
  assert.equal(q.subtotal, 600);
});

test('fixed surcharge added and shown separately', () => {
  const q = quote([S({})]);
  assert.equal(q.surcharges.length, 1);
  assert.equal(q.surcharges[0].amount, 50);
  assert.equal(q.service.amount, 600, 'not hidden inside the service price');
  assert.equal(q.subtotal, 650);
});

test('percentage surcharge uses the service charge as basis', () => {
  const q = quote([S({ type: 'percentage', value: 10 })]);
  assert.equal(q.surcharges[0].amount, 60);
  assert.match(q.surcharges[0].basis, /10% of the gardening service charge/);
});

test('zone-specific surcharge does not affect other zones', () => {
  const onlyB = S({ zone_scope: 'selected', zone_ids: [2] });
  assert.equal(quote([onlyB], zoneA).surcharges.length, 0);
  assert.equal(quote([onlyB], zoneB).surcharges.length, 1);
  assert.equal(quote([S({ zone_scope: 'selected', zone_ids: '[2]' })], zoneB).surcharges.length, 1, 'JSON-string zone ids');
});

test('disabled or expired surcharge is not applied; date window respected', () => {
  assert.equal(quote([S({ is_active: false })]).surcharges.length, 0);
  assert.equal(quote([S({ ends_on: '2026-12-01' })]).surcharges.length, 0);
  assert.equal(quote([S({ starts_on: '2026-12-15' })]).surcharges.length, 0);
  assert.equal(quote([S({ starts_on: '2026-12-01', ends_on: '2026-12-31' })]).surcharges.length, 1);
});

test('removing a surcharge restores the total', () => {
  assert.equal(quote([S({})]).subtotal, 650);
  assert.equal(quote([]).subtotal, 600);
});

test('the same surcharge is never applied twice on recalculation', () => {
  const s = S({});
  const q = quote([s, s, { ...s }]);
  assert.equal(q.surcharges.length, 1);
  assert.equal(q.surcharge_total, 50);
});

test('final payable = service + add-ons + surcharges + 18% GST', () => {
  const q = P.buildQuote({ pricing: zoneA, plantCount: 25, vermicompostKg: 5, surcharges: [S({})], date: '2026-12-10', addonTotal: 99 });
  assert.equal(q.subtotal, 675 + 300 + 99 + 50);
  assert.equal(q.total, Math.round(1124 * 1.18 * 100) / 100);
});

test('legacy slab view reproduces the new price for old app builds', () => {
  const z = P.zonePricing({ id: 3, base_price: 350 });
  const slabs = P.legacySlabs(z);
  for (const n of [11, 13, 25, 199, 200]) {
    const slab = slabs.find((s) => n >= s.min && n <= s.max);
    assert.equal(350 + slab.extra, price(n, z), `${n} plants`);
  }
});
