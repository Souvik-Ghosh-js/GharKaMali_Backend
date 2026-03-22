require('dotenv').config();
const bcrypt = require('bcryptjs');
const {
  sequelize, User, ServiceZone, ServicePlan, GardenerProfile,
  GardenerZone, AddOnService, SLAConfig, CityPage, Blog
} = require('../models');

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('Connected. Seeding database...\n');

    // ── ADMIN ──────────────────────────────────────────────────────────────────
    const adminPw = await bcrypt.hash('Admin@123', 10);
    const [admin] = await User.findOrCreate({
      where: { phone: '9999999999' },
      defaults: {
        name: 'Super Admin',
        phone: '9999999999',
        email: 'admin@gharkamali.com',
        password: adminPw,
        role: 'admin',
        is_active: true,
        is_approved: true,
        referral_code: 'ADMIN001',
        city: 'Delhi',
        state: 'Delhi'
      }
    });
    console.log('✅ Admin:', admin.phone, '/ Admin@123');

    // ── SERVICE ZONES ──────────────────────────────────────────────────────────
    const zonesData = [
      { name: 'South Delhi',   city: 'Delhi',     state: 'Delhi',       base_price: 299, price_per_plant: 15, min_plants: 5, center_latitude: 28.5355, center_longitude: 77.3910, radius_km: 5 },
      { name: 'Bandra West',   city: 'Mumbai',    state: 'Maharashtra', base_price: 399, price_per_plant: 20, min_plants: 5, center_latitude: 19.0596, center_longitude: 72.8295, radius_km: 4 },
      { name: 'Koramangala',   city: 'Bangalore', state: 'Karnataka',   base_price: 349, price_per_plant: 18, min_plants: 5, center_latitude: 12.9279, center_longitude: 77.6271, radius_km: 4 },
      { name: 'Banjara Hills', city: 'Hyderabad', state: 'Telangana',   base_price: 299, price_per_plant: 15, min_plants: 5, center_latitude: 17.4156, center_longitude: 78.4347, radius_km: 5 },
      { name: 'Salt Lake',     city: 'Kolkata',   state: 'West Bengal', base_price: 249, price_per_plant: 12, min_plants: 5, center_latitude: 22.5726, center_longitude: 88.4196, radius_km: 5 }
    ];
    const zones = [];
    for (const z of zonesData) {
      const [zone] = await ServiceZone.findOrCreate({ where: { name: z.name, city: z.city }, defaults: z });
      zones.push(zone);
    }
    console.log('✅ Service zones:', zones.length);

    // ── SERVICE PLANS ──────────────────────────────────────────────────────────
    const plansData = [
      { name: 'Basic Monthly',    plan_type: 'subscription', visits_per_month: 8,  price: 999,  duration_days: 30, max_plants: 10, description: '8 visits/month, up to 10 plants',  features: ['8 visits', '10 plants max', 'WhatsApp updates', 'Rating system'] },
      { name: 'Standard Monthly', plan_type: 'subscription', visits_per_month: 12, price: 1499, duration_days: 30, max_plants: 20, description: '12 visits/month, up to 20 plants', features: ['12 visits', '20 plants max', 'WhatsApp updates', 'Priority support', 'Free plant identification'] },
      { name: 'Premium Monthly',  plan_type: 'subscription', visits_per_month: 24, price: 2499, duration_days: 30, max_plants: 50, description: '24 visits/month, up to 50 plants', features: ['24 visits', '50 plants max', 'WhatsApp updates', 'Dedicated gardener', 'Free plant identification', 'Fertilizer included'] },
      { name: 'On-Demand Visit',  plan_type: 'ondemand',     visits_per_month: 1,  price: 199,  price_per_visit: 199, duration_days: 1, max_plants: 5, description: 'Single visit on demand', features: ['Single visit', 'Up to 5 plants', 'WhatsApp updates'] }
    ];
    for (const p of plansData) {
      await ServicePlan.findOrCreate({ where: { name: p.name }, defaults: p });
    }
    console.log('✅ Service plans: 4');

    // ── ADD-ON SERVICES ────────────────────────────────────────────────────────
    const addonsData = [
      { name: 'Deep Fertilizing',   description: 'Premium organic fertilizer treatment for all plants', price: 299, duration_mins: 45, icon: '🌱', category: 'nutrition' },
      { name: 'Pest Control',       description: 'Eco-friendly pesticide spray for common garden pests', price: 399, duration_mins: 60, icon: '🐛', category: 'health' },
      { name: 'Pruning & Shaping',  description: 'Professional pruning and shape trimming for shrubs and hedges', price: 349, duration_mins: 60, icon: '✂️', category: 'grooming' },
      { name: 'Soil Replacement',   description: 'Replace old soil with premium potting mix (up to 5 pots)', price: 499, duration_mins: 90, icon: '🪴', category: 'soil' },
      { name: 'Plant Repotting',    description: 'Repot plants into new containers (per plant)', price: 150, duration_mins: 20, icon: '🏺', category: 'care' },
      { name: 'Lawn Mowing',        description: 'Professional lawn mowing and edging (up to 500 sq ft)', price: 599, duration_mins: 60, icon: '🌾', category: 'lawn' },
      { name: 'Composting Setup',   description: 'Set up a compost bin and initial composting guidance', price: 799, duration_mins: 90, icon: '♻️', category: 'nutrition' },
      { name: 'Plant Health Check', description: 'Detailed health assessment report for all your plants', price: 199, duration_mins: 30, icon: '🔍', category: 'health' }
    ];
    for (const a of addonsData) {
      await AddOnService.findOrCreate({ where: { name: a.name }, defaults: a });
    }
    console.log('✅ Add-on services: 8');

    // ── SLA CONFIG ─────────────────────────────────────────────────────────────
    const existingSLA = await SLAConfig.findOne({ where: { is_active: true } });
    if (!existingSLA) {
      await SLAConfig.create({
        max_arrival_delay_mins: 30,
        max_service_duration_hrs: 3.0,
        response_time_hrs: 24,
        is_active: true,
        updated_by: admin.id
      });
    }
    console.log('✅ SLA config');

    // ── SUPERVISORS ────────────────────────────────────────────────────────────
    const supPw = await bcrypt.hash('Supervisor@123', 10);
    const supervisorsData = [
      { name: 'Rajesh Sharma',  phone: '9111111111', email: 'rajesh.supervisor@gharkamali.com', city: 'Delhi',     state: 'Delhi',        referral_code: 'SUP111111' },
      { name: 'Priya Nair',     phone: '9222222222', email: 'priya.supervisor@gharkamali.com',  city: 'Mumbai',    state: 'Maharashtra',  referral_code: 'SUP222222' }
    ];
    const supervisors = [];
    for (const s of supervisorsData) {
      const [sup] = await User.findOrCreate({
        where: { phone: s.phone },
        defaults: { ...s, password: supPw, role: 'supervisor', is_active: true, is_approved: true }
      });
      supervisors.push(sup);
    }
    console.log('✅ Supervisors:', supervisors.length, '/ Supervisor@123');

    // ── GARDENERS ──────────────────────────────────────────────────────────────
    const gardenersData = [
      {
        user: { name: 'Ramu Kaka',      phone: '9333333333', city: 'Delhi',     state: 'Delhi',       referral_code: 'GRD333333' },
        profile: { experience_years: 5, bio: 'Experienced gardener specializing in terrace and balcony gardens.', bank_account: '1234567890', bank_ifsc: 'HDFC0001234', bank_name: 'HDFC Bank', id_proof_type: 'aadhaar', id_proof_number: '1234-5678-9012' },
        supervisor: supervisors[0],
        zones: [zones[0]]  // South Delhi
      },
      {
        user: { name: 'Shyam Lal',      phone: '9444444444', city: 'Delhi',     state: 'Delhi',       referral_code: 'GRD444444' },
        profile: { experience_years: 3, bio: 'Passionate about organic gardening and composting.', bank_account: '9876543210', bank_ifsc: 'SBI0001234', bank_name: 'State Bank of India', id_proof_type: 'voter_id', id_proof_number: 'DL/04/123/456789' },
        supervisor: supervisors[0],
        zones: [zones[0]]  // South Delhi
      },
      {
        user: { name: 'Ganesh Patil',   phone: '9555555555', city: 'Mumbai',    state: 'Maharashtra', referral_code: 'GRD555555' },
        profile: { experience_years: 7, bio: 'Expert in tropical plants, succulents, and indoor plant care.', bank_account: '1122334455', bank_ifsc: 'ICIC0001234', bank_name: 'ICICI Bank', id_proof_type: 'aadhaar', id_proof_number: '9876-5432-1098' },
        supervisor: supervisors[1],
        zones: [zones[1]]  // Bandra West
      }
    ];

    const gardeners = [];
    for (const g of gardenersData) {
      const [gUser] = await User.findOrCreate({
        where: { phone: g.user.phone },
        defaults: { ...g.user, role: 'gardener', is_active: true, is_approved: true }
      });

      await GardenerProfile.findOrCreate({
        where: { user_id: gUser.id },
        defaults: {
          user_id: gUser.id,
          supervisor_id: g.supervisor.id,
          ...g.profile,
          rating: 4.5,
          total_jobs: 0,
          completed_jobs: 0,
          cancelled_jobs: 0,
          is_available: true
        }
      });

      for (const zone of g.zones) {
        await GardenerZone.findOrCreate({ where: { gardener_id: gUser.id, zone_id: zone.id } });
      }

      gardeners.push(gUser);
    }
    console.log('✅ Gardeners:', gardeners.length, '(phones: 9333333333, 9444444444, 9555555555) — OTP: 123456');

    // ── CUSTOMERS ──────────────────────────────────────────────────────────────
    const customersData = [
      { name: 'Anjali Singh',  phone: '9666666666', email: 'anjali@example.com',  city: 'Delhi',  state: 'Delhi',       address: '12, Rose Garden Colony, South Delhi', pincode: '110049', referral_code: 'CST666666' },
      { name: 'Vikram Mehta',  phone: '9777777777', email: 'vikram@example.com',  city: 'Delhi',  state: 'Delhi',       address: '45, Green Park, South Delhi',          pincode: '110016', referral_code: 'CST777777' },
      { name: 'Sneha D\'Souza', phone: '9888888888', email: 'sneha@example.com',   city: 'Mumbai', state: 'Maharashtra', address: '8, Pali Hill, Bandra West, Mumbai',    pincode: '400050', referral_code: 'CST888888' }
    ];
    const customers = [];
    for (const c of customersData) {
      const [cust] = await User.findOrCreate({
        where: { phone: c.phone },
        defaults: { ...c, role: 'customer', is_active: true, is_approved: true, wallet_balance: 200 }
      });
      customers.push(cust);
    }
    console.log('✅ Customers:', customers.length, '(phones: 9666666666, 9777777777, 9888888888) — OTP: 123456');

    // ── CITY PAGES ─────────────────────────────────────────────────────────────
    const cityPagesData = [
      {
        city_name: 'Delhi', slug: 'delhi', state: 'Delhi',
        hero_title: 'Professional Gardening Services in Delhi',
        hero_description: 'Ghar Ka Mali brings expert gardeners to your doorstep in Delhi. Subscription plans starting ₹999/month.',
        seo_title: 'Best Gardening Services in Delhi | Ghar Ka Mali',
        seo_description: 'Hire professional gardeners in Delhi for terrace gardens, balcony plants, and lawn care. Book online, track in real-time.',
        content: '<h2>Gardening Services in Delhi</h2><p>Delhi\'s climate is perfect for a wide variety of plants. Our trained gardeners cover South Delhi, Noida, Gurugram, and nearby areas.</p>',
        total_gardeners: 2
      },
      {
        city_name: 'Mumbai', slug: 'mumbai', state: 'Maharashtra',
        hero_title: 'Professional Gardening Services in Mumbai',
        hero_description: 'Expert gardeners in Mumbai for balcony gardens, terrace farming, and indoor plant care. Starting ₹399/visit.',
        seo_title: 'Best Gardening Services in Mumbai | Ghar Ka Mali',
        seo_description: 'Professional gardeners in Mumbai — Bandra, Andheri, Powai, Thane. Subscription plans and on-demand visits.',
        content: '<h2>Gardening Services in Mumbai</h2><p>Mumbai\'s tropical climate is ideal for lush balcony gardens. Our gardeners are trained in humidity management and salt-air plant care.</p>',
        total_gardeners: 1
      },
      {
        city_name: 'Bangalore', slug: 'bangalore', state: 'Karnataka',
        hero_title: 'Professional Gardening Services in Bangalore',
        hero_description: 'Ghar Ka Mali brings certified gardeners to Bangalore. Perfect weather, perfect gardens.',
        seo_title: 'Best Gardening Services in Bangalore | Ghar Ka Mali',
        seo_description: 'Hire expert gardeners in Bangalore — Koramangala, Indiranagar, Whitefield. On-demand and subscription plans.',
        content: '<h2>Gardening Services in Bangalore</h2><p>Bangalore\'s year-round mild climate makes it ideal for gardening. Our experts help you grow everything from succulents to vegetable patches.</p>',
        total_gardeners: 0
      },
      {
        city_name: 'Hyderabad', slug: 'hyderabad', state: 'Telangana',
        hero_title: 'Professional Gardening Services in Hyderabad',
        hero_description: 'Expert plant care and garden maintenance across Hyderabad. Book your gardener today.',
        seo_title: 'Best Gardening Services in Hyderabad | Ghar Ka Mali',
        seo_description: 'Trusted gardeners in Hyderabad — Banjara Hills, Jubilee Hills, Gachibowli. Affordable subscription plans.',
        content: '<h2>Gardening Services in Hyderabad</h2><p>Hyderabad\'s semi-arid climate needs expert watering schedules and drought-resistant plants. Our gardeners specialize in water-efficient gardens.</p>',
        total_gardeners: 0
      },
      {
        city_name: 'Kolkata', slug: 'kolkata', state: 'West Bengal',
        hero_title: 'Professional Gardening Services in Kolkata',
        hero_description: 'Trained gardeners in Kolkata for terrace gardens, indoor plants, and lawn maintenance.',
        seo_title: 'Best Gardening Services in Kolkata | Ghar Ka Mali',
        seo_description: 'Book expert gardeners in Kolkata — Salt Lake, New Town, Ballygunge. Affordable monthly plans.',
        content: '<h2>Gardening Services in Kolkata</h2><p>Kolkata\'s humid tropical climate supports lush greenery. Our gardeners are experts in monsoon plant care and post-rain recovery.</p>',
        total_gardeners: 0
      }
    ];
    for (const cp of cityPagesData) {
      await CityPage.findOrCreate({ where: { slug: cp.slug }, defaults: cp });
    }
    console.log('✅ City pages: 5');

    // ── SAMPLE BLOGS ───────────────────────────────────────────────────────────
    const blogsData = [
      {
        title: '10 Best Plants for Your Delhi Balcony Garden',
        slug: '10-best-plants-for-delhi-balcony-garden',
        excerpt: 'Delhi\'s extreme climate — blazing summers and chilly winters — needs special plants. Here are the top 10 that thrive all year.',
        content: '<h2>1. Money Plant (Epipremnum aureum)</h2><p>One of the most resilient plants for Delhi balconies. Thrives in partial shade and needs watering only every 2-3 days.</p><h2>2. Aloe Vera</h2><p>Perfect for Delhi\'s dry summers. Requires very little water and is useful for burns and skin care.</p><h2>3. Tulsi (Holy Basil)</h2><p>Sacred and practical. Grows well in full sun and acts as a natural mosquito repellent.</p><h2>4. Hibiscus</h2><p>Produces stunning flowers through spring and summer. Needs full sun and regular watering.</p><h2>5. Bougainvillea</h2><p>The quintessential Delhi climber. Thrives in heat, needs minimal water once established.</p>',
        category: 'tips',
        tags: ['delhi', 'balcony', 'plants', 'beginners'],
        author_id: admin.id,
        status: 'published',
        city_slug: 'delhi',
        seo_title: '10 Best Plants for Delhi Balcony Garden | Ghar Ka Mali',
        seo_description: 'Discover the top 10 plants perfect for Delhi\'s climate — from money plants to bougainvillea. Expert tips from Ghar Ka Mali.',
        published_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
      },
      {
        title: 'How to Water Your Plants in Mumbai\'s Monsoon',
        slug: 'how-to-water-plants-mumbai-monsoon',
        excerpt: 'Mumbai\'s monsoon can waterlog your plants and cause root rot. Learn how to protect your garden during heavy rains.',
        content: '<h2>The Monsoon Challenge</h2><p>Mumbai receives over 2000mm of rain between June and September. Most balcony plants are at risk of overwatering during this period.</p><h2>Key Tips</h2><ul><li><strong>Move pots under cover</strong> — If possible, shift pots away from direct rain.</li><li><strong>Check drainage holes</strong> — Ensure every pot has a clear drainage hole.</li><li><strong>Skip manual watering</strong> — On rainy days, nature provides enough. Only water if the topsoil is dry.</li><li><strong>Use fungicide</strong> — High humidity encourages fungal growth. Apply neem-based fungicide every 2 weeks.</li></ul>',
        category: 'care',
        tags: ['mumbai', 'monsoon', 'watering', 'plant-care'],
        author_id: admin.id,
        status: 'published',
        city_slug: 'mumbai',
        seo_title: 'Watering Plants in Mumbai Monsoon | Ghar Ka Mali',
        seo_description: 'Protect your Mumbai garden during monsoon. Expert advice on drainage, waterlogging, and fungal prevention.',
        published_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
      },
      {
        title: 'Complete Guide to Terrace Farming in Indian Cities',
        slug: 'complete-guide-terrace-farming-indian-cities',
        excerpt: 'Grow your own vegetables on your rooftop. This guide covers soil, containers, crops, and seasonal planning for Indian climates.',
        content: '<h2>Why Terrace Farming?</h2><p>With rising vegetable prices and awareness about organic food, thousands of Indian families are turning their terraces into productive kitchen gardens.</p><h2>Getting Started</h2><h3>Containers</h3><p>Use grow bags (12-18 inch) or repurposed containers. Avoid shallow pots — most vegetables need at least 8-10 inches of soil depth.</p><h3>Soil Mix</h3><p>Never use plain garden soil on a terrace. Use a mix of: 60% cocopeat, 30% compost, 10% perlite for drainage.</p><h2>Easy Crops to Start With</h2><ul><li>Cherry tomatoes — ready in 60 days</li><li>Spinach — ready in 30 days</li><li>Chillies — low maintenance, high yield</li><li>Methi (fenugreek) — ready in 3 weeks</li></ul>',
        category: 'guides',
        tags: ['terrace-farming', 'vegetables', 'organic', 'urban-gardening'],
        author_id: admin.id,
        status: 'published',
        seo_title: 'Complete Guide to Terrace Farming in India | Ghar Ka Mali',
        seo_description: 'Step-by-step guide to growing vegetables on your Indian city terrace. Soil, containers, crops, and seasonal planning.',
        published_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago
      }
    ];
    for (const b of blogsData) {
      await Blog.findOrCreate({ where: { slug: b.slug }, defaults: b });
    }
    console.log('✅ Blog posts: 3');

    // ── SUMMARY ────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════');
    console.log('✅  SEED COMPLETED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════');
    console.log('\n📋 Login Credentials (all use static OTP: 123456 for OTP flows)\n');
    console.log('  ADMIN       phone: 9999999999   password: Admin@123');
    console.log('  SUPERVISOR  phone: 9111111111   password: Supervisor@123  (Delhi)');
    console.log('  SUPERVISOR  phone: 9222222222   password: Supervisor@123  (Mumbai)');
    console.log('  GARDENER    phone: 9333333333   OTP: 123456  (Delhi — Ramu Kaka)');
    console.log('  GARDENER    phone: 9444444444   OTP: 123456  (Delhi — Shyam Lal)');
    console.log('  GARDENER    phone: 9555555555   OTP: 123456  (Mumbai — Ganesh Patil)');
    console.log('  CUSTOMER    phone: 9666666666   OTP: 123456  (Anjali Singh, Delhi)');
    console.log('  CUSTOMER    phone: 9777777777   OTP: 123456  (Vikram Mehta, Delhi)');
    console.log('  CUSTOMER    phone: 9888888888   OTP: 123456  (Sneha D\'Souza, Mumbai)');
    console.log('\n  Swagger UI: GET /api-docs');
    console.log('═══════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seed();
