// Shared created_at date-range filter for admin list endpoints.
// Reads ?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD from the query string and
// returns a Sequelize where-fragment to spread into the endpoint's where
// clause ({} when absent or invalid, so callers can always spread it).
//
//   const { dateRangeWhere } = require('../utils/dateRange');
//   const where = { ...otherFilters, ...dateRangeWhere(req.query) };
//
const { Op } = require('sequelize');

const parseDay = (s) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};

function dateRangeWhere(query = {}, field = 'created_at') {
  const from = parseDay(query.from_date);
  const to = parseDay(query.to_date);
  if (!from && !to) return {};
  const range = {};
  if (from) range[Op.gte] = from;
  if (to) range[Op.lte] = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1); // end of day
  return { [field]: range };
}

module.exports = { dateRangeWhere };
