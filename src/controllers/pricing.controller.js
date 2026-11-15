// ─────────────────────────────────────────────────────────────────────────────
// One-time service pricing API — public config/quote for the website & app,
// admin per-zone pricing tables, vermicompost prices, surcharges and audit.
// All math lives in services/oneTimePricing.js (shared with createBooking and
// manual invoices) so every channel prices a visit identically.
// ─────────────────────────────────────────────────────────────────────────────
const P = require('../services/oneTimePricing');

const NOT_SERVICEABLE = "We don't serve this address yet. Please choose a supported service area or contact support.";
const isYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err.httpStatus) return fail(res, err.httpStatus, err.message);
    console.error('[pricing]', err);
    fail(res, 500, err.message);
  }
};

async function loadZone(id, { activeOnly = true } = {}) {
  const { Geofence } = require('../models');
  const zid = parseInt(id, 10);
  if (!Number.isInteger(zid) || zid <= 0) return null;
  const zone = await Geofence.findByPk(zid);
  if (!zone || (activeOnly && !zone.is_active)) return null;
  return zone;
}

// Surcharge rows a customer may see for a zone (active, not already ended).
function publicSurcharges(all, zoneId) {
  const today = P.todayIST();
  return all
    .filter((s) => P.surchargeApplies(s, zoneId, null) && !(s.ends_on && String(s.ends_on).slice(0, 10) < today))
    .map((s) => ({
      id: s.id, name: s.name, reason: s.reason || null, type: s.type, value: Number(s.value),
      starts_on: s.starts_on || null, ends_on: s.ends_on || null,
    }));
}

function surchargeStatus(s) {
  if (!s.is_active) return 'disabled';
  const today = P.todayIST();
  if (s.ends_on && String(s.ends_on).slice(0, 10) < today) return 'expired';
  if (s.starts_on && String(s.starts_on).slice(0, 10) > today) return 'scheduled';
  return 'active';
}

// ── PUBLIC ───────────────────────────────────────────────────────────────────

// GET /pricing/one-time?geofence_id=  → the zone's pricing config + surcharges
exports.getOneTimePricing = handle(async (req, res) => {
  const zone = await loadZone(req.query.geofence_id || req.query.zone_id);
  if (!zone) return fail(res, 404, NOT_SERVICEABLE, { code: 'ZONE_NOT_SERVICEABLE' });
  const pricing = P.zonePricing(zone);
  const surcharges = publicSurcharges(await P.getActiveSurcharges(), zone.id);
  res.json({
    success: true,
    data: {
      zone: { id: zone.id, name: zone.name, city: zone.city },
      base_price: pricing.base_price,
      base_plants: pricing.base_plants,
      min_plants: pricing.min_plants,
      default_plants: pricing.min_plants,
      max_plants: pricing.max_plants,
      intervals: pricing.intervals,
      vermicompost: pricing.vermicompost,
      surcharges,
      gst_rate: P.GST_RATE,
    },
  });
});

// POST /pricing/one-time/quote { geofence_id, plant_count, vermicompost_kg, scheduled_date, addons }
exports.quoteOneTime = handle(async (req, res) => {
  const { geofence_id, zone_id, plant_count, vermicompost_kg, scheduled_date, addons } = req.body || {};
  const zone = await loadZone(geofence_id || zone_id);
  if (!zone) return fail(res, 404, NOT_SERVICEABLE, { code: 'ZONE_NOT_SERVICEABLE' });
  let addonTotal = 0;
  if (Array.isArray(addons) && addons.length) {
    const { AddOnService } = require('../models');
    const ids = addons.map((a) => Number(a.addon_id)).filter(Boolean);
    const rows = await AddOnService.findAll({ where: { id: ids, is_active: true } });
    for (const r of rows) {
      const qty = Number(addons.find((a) => Number(a.addon_id) === r.id)?.quantity) || 1;
      addonTotal += (Number(r.price) || 0) * qty;
    }
  }
  const quote = P.buildQuote({
    pricing: P.zonePricing(zone),
    plantCount: plant_count,
    vermicompostKg: vermicompost_kg,
    surcharges: await P.getActiveSurcharges(),
    date: isYmd(scheduled_date) ? scheduled_date : P.todayIST(),
    addonTotal,
  });
  if (!quote.ok) {
    return res.json({ success: true, data: { custom_quote: true, max_plants: quote.max_plants, plants: quote.plants } });
  }
  res.json({ success: true, data: quote });
});

// GET /pricing/plant-slabs — legacy view for app builds released before the
// progressive pricing (they add zone.base_price + slab.extra). One slab per
// plant count reproduces the new price exactly for those builds.
exports.legacyPlantSlabs = handle(async (req, res) => {
  const zone = await loadZone(req.query.geofence_id || req.query.zone_id);
  const pricing = P.zonePricing(zone || {});
  res.json({
    success: true,
    data: { base_covers: P.BASE_PLANTS, max_auto_plants: pricing.max_plants, slabs: P.legacySlabs(pricing) },
  });
});

// ── ADMIN: per-zone pricing ──────────────────────────────────────────────────

const zoneView = (z) => {
  const p = P.zonePricing(z);
  return {
    id: z.id, name: z.name, city: z.city, state: z.state, is_active: z.is_active,
    base_price: p.base_price, base_plants: p.base_plants, max_plants: p.max_plants,
    intervals: p.intervals, vermicompost: p.vermicompost,
    uses_default_rates: p.uses_default_rates, uses_default_vermicompost: p.uses_default_vermicompost,
  };
};

// GET /admin/pricing/one-time/zones
exports.listZonePricing = handle(async (req, res) => {
  const { Geofence } = require('../models');
  const zones = await Geofence.findAll({ order: [['city', 'ASC'], ['name', 'ASC']] });
  res.json({
    success: true,
    data: { zones: zones.map(zoneView), defaults: { intervals: P.DEFAULT_INTERVALS, vermicompost: P.DEFAULT_VERMICOMPOST } },
  });
});

// PUT /admin/pricing/one-time/zones/:id { intervals, vermicompost, copied_from_zone_id? }
// Only the per-plant rates and vermicompost prices. The zone's base price
// (first 10 plants) stays where it already lives — the zone's own settings.
exports.updateZonePricing = handle(async (req, res) => {
  const { sequelize } = require('../models');
  const zone = await loadZone(req.params.id, { activeOnly: false });
  if (!zone) return fail(res, 404, 'Zone not found');
  const { intervals, vermicompost, copied_from_zone_id } = req.body || {};

  const iv = P.normalizeIntervals(intervals);
  const vc = P.normalizeVermicompost(vermicompost);
  const err = P.validateIntervals(iv) || P.validateVermicompost(vc);
  if (err) return fail(res, 400, err);

  const before = zoneView(zone);
  let note = null;
  if (copied_from_zone_id) {
    const src = await loadZone(copied_from_zone_id, { activeOnly: false });
    if (src) note = `Rates copied from ${src.name} (#${src.id}); base price kept`;
  }
  await sequelize.transaction(async (t) => {
    await zone.update({
      plant_rate_intervals: iv,
      vermicompost_prices: vc,
    }, { transaction: t });
    await P.logPricingAudit({
      entity_type: 'zone_pricing', entity_id: zone.id, zone_id: zone.id,
      action: copied_from_zone_id ? 'copy' : 'update',
      before: { intervals: before.intervals, vermicompost: before.vermicompost },
      after: { intervals: iv, vermicompost: vc },
      actor_id: req.user?.id, note,
    }, { transaction: t });
  });
  res.json({ success: true, message: `Pricing saved for ${zone.name}. It applies to new quotes and bookings only.`, data: zoneView(zone) });
});

// POST /admin/pricing/one-time/vermicompost/apply-all { vermicompost, zone_ids? }
// Keep compost prices uniform: copy one set of prices to all (or chosen) zones.
exports.applyVermicompostToZones = handle(async (req, res) => {
  const { Geofence, sequelize } = require('../models');
  const vc = P.normalizeVermicompost(req.body?.vermicompost);
  const err = P.validateVermicompost(vc);
  if (err) return fail(res, 400, err);
  const ids = Array.isArray(req.body?.zone_ids) ? req.body.zone_ids.map(Number).filter(Boolean) : null;
  const zones = await Geofence.findAll(ids ? { where: { id: ids } } : {});
  await sequelize.transaction(async (t) => {
    for (const z of zones) {
      const before = P.zonePricing(z).vermicompost;
      await z.update({ vermicompost_prices: vc }, { transaction: t });
      await P.logPricingAudit({
        entity_type: 'zone_pricing', entity_id: z.id, zone_id: z.id, action: 'update',
        before: { vermicompost: before }, after: { vermicompost: vc },
        actor_id: req.user?.id, note: 'Vermicompost prices applied across zones',
      }, { transaction: t });
    }
  });
  res.json({ success: true, message: `Vermicompost prices applied to ${zones.length} zone(s)` });
});

// GET /admin/pricing/audit?entity_type=&entity_id=&zone_id=&limit=
exports.getPricingAudit = handle(async (req, res) => {
  const { PricingAudit, User } = require('../models');
  const where = {};
  if (req.query.entity_type) where.entity_type = String(req.query.entity_type);
  if (req.query.entity_id) where.entity_id = parseInt(req.query.entity_id, 10);
  if (req.query.zone_id) where.zone_id = parseInt(req.query.zone_id, 10);
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
  const rows = await PricingAudit.findAll({
    where, limit, order: [['created_at', 'DESC'], ['id', 'DESC']],
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email'] }],
  });
  res.json({
    success: true,
    data: rows.map((r) => {
      const o = r.get({ plain: true });
      return { ...o, before_value: P.parseJson(o.before_value), after_value: P.parseJson(o.after_value) };
    }),
  });
});

// ── ADMIN: surcharges ────────────────────────────────────────────────────────

const surchargeView = (s) => {
  const o = s.get ? s.get({ plain: true }) : s;
  return { ...o, value: Number(o.value), zone_ids: P.parseJson(o.zone_ids) || [], status: surchargeStatus(o) };
};

async function readSurchargeBody(body, existing = null) {
  const { Geofence } = require('../models');
  const pick = (k) => (body[k] !== undefined ? body[k] : existing?.[k]);
  const name = String(pick('name') || '').trim();
  const reason = String(pick('reason') || '').trim() || null;
  const type = pick('type');
  const value = Number(pick('value'));
  const zone_scope = pick('zone_scope') || 'all';
  const zone_ids = zone_scope === 'selected'
    ? [...new Set((P.parseJson(pick('zone_ids')) || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : null;
  const starts_on = pick('starts_on') || null;
  const ends_on = pick('ends_on') || null;
  const is_active = pick('is_active') === undefined ? true : !!pick('is_active');

  if (!name) return { error: 'Give the surcharge a name (e.g. Peak demand)' };
  if (name.length > 100) return { error: 'Name must be 100 characters or fewer' };
  if (reason && reason.length > 255) return { error: 'Reason must be 255 characters or fewer' };
  if (!['fixed', 'percentage'].includes(type)) return { error: "Type must be 'fixed' (₹) or 'percentage' (%)" };
  if (!Number.isFinite(value) || value <= 0) return { error: 'Amount must be more than 0' };
  if (type === 'percentage' && value > 100) return { error: 'A percentage surcharge cannot be more than 100%' };
  if (!['all', 'selected'].includes(zone_scope)) return { error: "Zones must be 'all' or 'selected'" };
  if (zone_scope === 'selected') {
    if (!zone_ids.length) return { error: 'Pick at least one zone, or apply to all zones' };
    const found = await Geofence.count({ where: { id: zone_ids } });
    if (found !== zone_ids.length) return { error: 'One or more selected zones no longer exist' };
  }
  if (starts_on && !isYmd(String(starts_on))) return { error: 'Start date must be YYYY-MM-DD' };
  if (ends_on && !isYmd(String(ends_on))) return { error: 'End date must be YYYY-MM-DD' };
  if (starts_on && ends_on && String(ends_on) < String(starts_on)) return { error: 'End date is before the start date' };
  return { data: { name, reason, type, value: P.round2(value), zone_scope, zone_ids, starts_on, ends_on, is_active } };
}

// GET /admin/surcharges
exports.listSurcharges = handle(async (req, res) => {
  const { Surcharge } = require('../models');
  const rows = await Surcharge.findAll({ order: [['is_active', 'DESC'], ['id', 'DESC']] });
  res.json({ success: true, data: rows.map(surchargeView) });
});

// POST /admin/surcharges
exports.createSurcharge = handle(async (req, res) => {
  const { Surcharge } = require('../models');
  const { error, data } = await readSurchargeBody(req.body || {});
  if (error) return fail(res, 400, error);
  const row = await Surcharge.create({ ...data, created_by: req.user?.id, updated_by: req.user?.id });
  P.invalidateSurchargeCache();
  await P.logPricingAudit({ entity_type: 'surcharge', entity_id: row.id, action: 'create', after: surchargeView(row), actor_id: req.user?.id });
  res.status(201).json({ success: true, message: 'Surcharge created', data: surchargeView(row) });
});

// PUT /admin/surcharges/:id  (also used to enable / disable)
exports.updateSurcharge = handle(async (req, res) => {
  const { Surcharge } = require('../models');
  const row = await Surcharge.findByPk(req.params.id);
  if (!row) return fail(res, 404, 'Surcharge not found');
  const before = surchargeView(row);
  const { error, data } = await readSurchargeBody(req.body || {}, before);
  if (error) return fail(res, 400, error);
  await row.update({ ...data, updated_by: req.user?.id });
  P.invalidateSurchargeCache();
  const onlyToggle = Object.keys(req.body || {}).every((k) => k === 'is_active');
  const action = onlyToggle ? (data.is_active ? 'enable' : 'disable') : 'update';
  await P.logPricingAudit({ entity_type: 'surcharge', entity_id: row.id, action, before, after: surchargeView(row), actor_id: req.user?.id });
  res.json({ success: true, message: action === 'update' ? 'Surcharge updated' : `Surcharge ${action}d`, data: surchargeView(row) });
});

// DELETE /admin/surcharges/:id
exports.deleteSurcharge = handle(async (req, res) => {
  const { Surcharge } = require('../models');
  const row = await Surcharge.findByPk(req.params.id);
  if (!row) return fail(res, 404, 'Surcharge not found');
  const before = surchargeView(row);
  await row.destroy();
  P.invalidateSurchargeCache();
  await P.logPricingAudit({ entity_type: 'surcharge', entity_id: before.id, action: 'delete', before, actor_id: req.user?.id });
  res.json({ success: true, message: 'Surcharge removed. Existing bookings keep the surcharge they were charged.' });
});
