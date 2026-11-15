// ─────────────────────────────────────────────────────────────────────────────
// RETIRED (Nov 2026). The flat "slab extra" table was replaced by progressive
// per-zone one-time pricing — see services/oneTimePricing.js. Nothing in the
// app imports this file any more; it re-exports the new engine's legacy view
// only so a stray old script fails soft instead of crashing.
// ─────────────────────────────────────────────────────────────────────────────
const P = require('../services/oneTimePricing');

module.exports = {
  BASE_COVERS: P.BASE_PLANTS,
  legacySlabs: P.legacySlabs,
};
