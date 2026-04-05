
/**
 * Ray-casting algorithm to check if a point is inside a polygon
 * polygon is an array of [lat, lng]
 */
function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = parseFloat(polygon[i][0]), yi = parseFloat(polygon[i][1]);
    const xj = parseFloat(polygon[j][0]), yj = parseFloat(polygon[j][1]);

    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Resolve the first active geofence that contains the given coordinates
 */
async function resolveGeofence(lat, lng) {
  const { Geofence } = require('../models');
  const geofences = await Geofence.findAll({ where: { is_active: true } });

  for (const gf of geofences) {
    let polygon = [];
    try {
      polygon = typeof gf.polygon_coords === 'string'
        ? JSON.parse(gf.polygon_coords)
        : (gf.polygon_coords || []);
    } catch { continue; }

    if (polygon.length < 3) continue;

    if (pointInPolygon(lat, lng, polygon)) {
      return gf;
    }
  }
  return null;
}

module.exports = { pointInPolygon, resolveGeofence };
