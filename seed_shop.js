const { ProductCategory, Product, sequelize } = require('./src/models');

const categories = [
  { name: 'Plants', slug: 'plants', icon: '🌿' },
  { name: 'Pots & Planters', slug: 'pots-planters', icon: '🏺' },
  { name: 'Soil & Compost', slug: 'soil-compost', icon: '🟤' },
  { name: 'Fertilizers', slug: 'fertilizers', icon: '🧪' },
  { name: 'Tools', slug: 'tools', icon: '🛠️' },
  { name: 'Pest Control', slug: 'pest-control', icon: '🕸️' }
];

const products = [
  { name: 'Premium Organic Potting Mix', price: 499, mrp: 699, category: 'Soil & Compost', badge: 'Bestseller', rating: 4.8, review_count: 234, description: 'Rich organic blend with perlite, vermiculite & slow-release nutrients. Perfect for all indoor & outdoor plants.', icon_key: 'soil' },
  { name: 'Neem Oil Concentrate 500ml', price: 299, mrp: 399, category: 'Pest Control', badge: 'Organic', rating: 4.7, review_count: 189, description: '100% cold-pressed neem oil. Natural pesticide, fungicide & miticide safe for all plants and beneficial insects.', icon_key: 'pest' },
  { name: 'Handcrafted Terracotta Pot Set (3pc)', price: 899, mrp: 1299, category: 'Pots & Planters', badge: 'Handcrafted', rating: 4.9, review_count: 156, description: 'Set of 3 artisan terracotta pots (4", 6", 8"). Perfect drainage, breathable walls, stunning craftsmanship.', icon_key: 'pot' },
  { name: 'Plant Growth Booster — NPK 19:19:19', price: 649, mrp: 849, category: 'Fertilizers', badge: 'Top Rated', rating: 4.6, review_count: 312, description: 'Balanced water-soluble fertilizer for all stages of plant growth. Micronutrient enriched formula.', icon_key: 'fert' },
  { name: 'Monstera Deliciosa (Medium)', price: 1299, mrp: 1800, category: 'Plants', badge: 'Popular', rating: 4.9, review_count: 428, description: 'Beautiful split-leaf monstera. 30-40cm height, healthy root system, shipped in eco-packaging.', icon_key: 'plant' },
  { name: 'Pruning Shears — Premium Steel', price: 799, mrp: 999, category: 'Tools', badge: 'Professional', rating: 4.8, review_count: 97, description: 'Japanese SK-5 high carbon steel blades. Ergonomic rubber grip. Includes leather sheath.', icon_key: 'tool' },
  { name: 'Peace Lily Indoor Plant', price: 699, mrp: 999, category: 'Plants', badge: 'Air Purifier', rating: 4.7, review_count: 345, description: 'NASA-certified air purifying plant. Low maintenance, thrives in low light. Ships in premium ceramic pot.', icon_key: 'plant' },
  { name: 'Drip Irrigation Kit (Garden)', price: 1899, mrp: 2499, category: 'Tools', badge: 'DIY Kit', rating: 4.5, review_count: 78, description: 'Complete drip system for up to 20 plants. Includes timer, tubing, emitters and connectors.', icon_key: 'tool' }
];

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');

    // Sync models (ensure tables exist)
    await sequelize.sync({ alter: true });
    console.log('Models synced');

    // Seed Categories
    for (const cat of categories) {
      await ProductCategory.findOrCreate({
        where: { slug: cat.slug },
        defaults: cat
      });
    }
    console.log('Categories seeded');

    // Seed Products
    const allCats = await ProductCategory.findAll();
    const catMap = allCats.reduce((acc, c) => ({ ...acc, [c.name]: c.id }), {});

    for (const p of products) {
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await Product.findOrCreate({
        where: { slug },
        defaults: {
          ...p,
          slug,
          category_id: catMap[p.category],
          stock_quantity: 50,
          is_active: true
        }
      });
    }
    console.log('Products seeded');

    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
}

seed();
