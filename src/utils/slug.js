// Slug generation shared by models (via hooks) and backfill scripts.
const { Op } = require('sequelize');

function slugify(name) {
  return (name || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Return a slug unique within `model.slug`, appending -2, -3… on collision.
// `excludeId` lets a row keep its own slug when updating.
async function uniqueSlug(model, base, excludeId = null) {
  const root = slugify(base) || 'item';
  let candidate = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { slug: candidate };
    if (excludeId != null) where.id = { [Op.ne]: excludeId };
    const clash = await model.findOne({ where });
    if (!clash) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

module.exports = { slugify, uniqueSlug };
