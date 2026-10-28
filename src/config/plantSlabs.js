// ─────────────────────────────────────────────────────────────────────────────
// On-demand plant-count pricing slabs — the zone base price covers up to
// BASE_COVERS plants; the slab surcharge for the plant-count range is ADDED to
// the base. Exact slab price only: never interpolate, prorate or round.
// Above the last slab (default >200 plants) no price is auto-calculated — the
// customer must ask for a custom quote.
//
// Configurable from the admin panel (stored as JSON in system_settings under
// 'plant_slabs'); these defaults apply until an admin saves their own.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_SLABS = [
  { min: 11, max: 15, extra: 100 },
  { min: 16, max: 20, extra: 200 },
  { min: 21, max: 30, extra: 350 },
  { min: 31, max: 40, extra: 400 },
  { min: 41, max: 50, extra: 600 },
  { min: 51, max: 60, extra: 800 },
  { min: 61, max: 70, extra: 1000 },
  { min: 71, max: 80, extra: 1200 },
  { min: 81, max: 100, extra: 1300 },
  { min: 101, max: 150, extra: 1800 },
  { min: 151, max: 200, extra: 2000 },
];
const BASE_COVERS = 10; // plants included in the zone base price

const SETTING_KEY = 'plant_slabs';
let cache = { slabs: null, at: 0 };
const CACHE_MS = 60 * 1000;

// Validate an admin-supplied slab list: positive ints, min<=max, extras >= 0,
// strictly ascending and non-overlapping, first slab starting at BASE_COVERS+1.
function validateSlabs(slabs) {
  if (!Array.isArray(slabs) || !slabs.length) return 'slabs must be a non-empty array';
  let prevMax = BASE_COVERS;
  for (const s of slabs) {
    const min = Number(s?.min), max = Number(s?.max), extra = Number(s?.extra);
    if (!Number.isInteger(min) || !Number.isInteger(max) || !Number.isFinite(extra)) {
      return 'each slab needs integer min/max and a numeric extra';
    }
    if (extra < 0) return `slab ${min}–${max}: extra cannot be negative`;
    if (min !== prevMax + 1) return `slab ${min}–${max}: must start at ${prevMax + 1} (ranges must be continuous)`;
    if (max < min) return `slab ${min}–${max}: max is below min`;
    prevMax = max;
  }
  return null;
}

async function getPlantSlabs() {
  if (cache.slabs && Date.now() - cache.at < CACHE_MS) return cache.slabs;
  try {
    const { SystemSetting } = require('../models');
    const row = await SystemSetting.findOne({ where: { key: SETTING_KEY } });
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (!validateSlabs(parsed)) {
        cache = { slabs: parsed, at: Date.now() };
        return parsed;
      }
    }
  } catch (e) {
    console.error('[plantSlabs] read failed, using defaults:', e.message);
  }
  cache = { slabs: DEFAULT_SLABS, at: Date.now() };
  return DEFAULT_SLABS;
}

function invalidatePlantSlabCache() { cache = { slabs: null, at: 0 }; }

// Surcharge for a plant count. Returns a number (0 when the base covers it),
// or null when the count is beyond the last slab → custom quote required.
function plantSurcharge(count, slabs) {
  const n = parseInt(count) || 0;
  if (n <= BASE_COVERS) return 0;
  for (const s of slabs) {
    if (n >= s.min && n <= s.max) return Number(s.extra) || 0;
  }
  return null; // beyond the last slab — never auto-calculate
}

const maxAutoPlants = (slabs) => slabs.length ? Number(slabs[slabs.length - 1].max) : BASE_COVERS;

module.exports = {
  DEFAULT_SLABS, BASE_COVERS, SETTING_KEY,
  getPlantSlabs, plantSurcharge, maxAutoPlants, validateSlabs, invalidatePlantSlabCache,
};
