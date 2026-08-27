
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

/**
 * Great-circle distance between two coordinates in metres (haversine).
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000; // Earth radius in metres
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

module.exports = { pointInPolygon, resolveGeofence, haversineMeters };
