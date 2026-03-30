/**
 * GharKaMali Shop Seeder
 * 
 * Run AFTER executing migrate_shop.sql on the database.
 * This script only inserts data — it does NOT alter any tables.
 * 
 * Usage: node seed_shop.js
 */

require('dotenv').config();
const { ProductCategory, Product, sequelize } = require('./src/models');

const categories = [
  { name: 'Plants',          slug: 'plants',        icon: '🌿' },
  { name: 'Pots & Planters', slug: 'pots-planters', icon: '🏺' },
  { name: 'Soil & Compost',  slug: 'soil-compost',  icon: '🟤' },
  { name: 'Fertilizers',     slug: 'fertilizers',   icon: '🧪' },
  { name: 'Tools',           slug: 'tools',         icon: '🛠️' },
  { name: 'Pest Control',    slug: 'pest-control',  icon: '🕸️' },
];

const products = [
  { name: 'Premium Organic Potting Mix',        category: 'Soil & Compost',  price: 499,  mrp: 699,  badge: 'Bestseller',  icon_key: 'soil',  rating: 4.8, review_count: 234, description: 'Rich organic blend with perlite, vermiculite & slow-release nutrients. Perfect for all indoor & outdoor plants.' },
  { name: 'Neem Oil Concentrate 500ml',          category: 'Pest Control',   price: 299,  mrp: 399,  badge: 'Organic',     icon_key: 'pest',  rating: 4.7, review_count: 189, description: '100% cold-pressed neem oil. Natural pesticide, fungicide & miticide safe for all plants.' },
  { name: 'Handcrafted Terracotta Pot Set (3pc)',category: 'Pots & Planters',price: 899,  mrp: 1299, badge: 'Handcrafted', icon_key: 'pot',   rating: 4.9, review_count: 156, description: 'Set of 3 artisan terracotta pots (4", 6", 8"). Perfect drainage, breathable walls.' },
  { name: 'Plant Growth Booster — NPK 19:19:19', category: 'Fertilizers',   price: 649,  mrp: 849,  badge: 'Top Rated',   icon_key: 'fert',  rating: 4.6, review_count: 312, description: 'Balanced water-soluble fertilizer for all stages of plant growth.' },
  { name: 'Monstera Deliciosa (Medium)',          category: 'Plants',        price: 1299, mrp: 1800, badge: 'Popular',     icon_key: 'plant', rating: 4.9, review_count: 428, description: 'Beautiful split-leaf monstera. 30-40cm height, healthy root system.' },
  { name: 'Pruning Shears — Premium Steel',       category: 'Tools',         price: 799,  mrp: 999,  badge: 'Professional',icon_key: 'tool',  rating: 4.8, review_count: 97,  description: 'Japanese SK-5 high carbon steel blades. Ergonomic rubber grip. Includes sheath.' },
  { name: 'Peace Lily Indoor Plant',              category: 'Plants',        price: 699,  mrp: 999,  badge: 'Air Purifier',icon_key: 'plant', rating: 4.7, review_count: 345, description: 'NASA-certified air purifying plant. Low maintenance, thrives in low light.' },
  { name: 'Drip Irrigation Kit (Garden)',         category: 'Tools',         price: 1899, mrp: 2499, badge: 'DIY Kit',     icon_key: 'tool',  rating: 4.5, review_count: 78,  description: 'Complete drip system for up to 20 plants. Includes timer, tubing & emitters.' },
];

async function seed() {
  try {
    // Just verify connection — no table changes
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Seed Categories
    for (const cat of categories) {
      const [record, created] = await ProductCategory.findOrCreate({
        where: { slug: cat.slug },
        defaults: cat,
      });
      console.log(`  ${created ? '➕' : '⏭️ '} Category: ${record.name}`);
    }

    // Build category name → id map
    const allCats = await ProductCategory.findAll();
    const catMap = Object.fromEntries(allCats.map(c => [c.name, c.id]));

    // Seed Products
    for (const p of products) {
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const category_id = catMap[p.category];

      if (!category_id) {
        console.warn(`  ⚠️  Unknown category "${p.category}" for: ${p.name}`);
        continue;
      }

      const [record, created] = await Product.findOrCreate({
        where: { slug },
        defaults: { ...p, slug, category_id, stock_quantity: 50, is_active: true },
      });
      console.log(`  ${created ? '➕' : '⏭️ '} Product: ${record.name}`);
    }

    console.log('\n✅ Shop seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    console.error('\n👉 Make sure you ran migrate_shop.sql first!\n');
    process.exit(1);
  }
}

seed();
