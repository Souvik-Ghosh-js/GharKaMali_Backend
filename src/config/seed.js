require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, ServiceZone, ServicePlan } = require('../models');

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('Seeding database...');

    // Create Admin
    const hashedPw = await bcrypt.hash('Admin@123', 10);
    const [admin] = await User.findOrCreate({
      where: { phone: '9999999999' },
      defaults: {
        name: 'Super Admin',
        phone: '9999999999',
        email: 'admin@gharkamali.com',
        password: hashedPw,
        role: 'admin',
        is_active: true,
        is_approved: true,
        referral_code: 'ADMIN001'
      }
    });
    console.log('Admin created:', admin.phone);

    // Create Service Zones
    const zones = [
      { name: 'South Delhi', city: 'Delhi', state: 'Delhi', base_price: 299, price_per_plant: 15, min_plants: 5, center_latitude: 28.5355, center_longitude: 77.3910, radius_km: 5 },
      { name: 'Bandra West', city: 'Mumbai', state: 'Maharashtra', base_price: 399, price_per_plant: 20, min_plants: 5, center_latitude: 19.0596, center_longitude: 72.8295, radius_km: 4 },
      { name: 'Koramangala', city: 'Bangalore', state: 'Karnataka', base_price: 349, price_per_plant: 18, min_plants: 5, center_latitude: 12.9279, center_longitude: 77.6271, radius_km: 4 },
      { name: 'Banjara Hills', city: 'Hyderabad', state: 'Telangana', base_price: 299, price_per_plant: 15, min_plants: 5, center_latitude: 17.4156, center_longitude: 78.4347, radius_km: 5 },
      { name: 'Salt Lake', city: 'Kolkata', state: 'West Bengal', base_price: 249, price_per_plant: 12, min_plants: 5, center_latitude: 22.5726, center_longitude: 88.4196, radius_km: 5 }
    ];

    for (const zone of zones) {
      await ServiceZone.findOrCreate({ where: { name: zone.name, city: zone.city }, defaults: zone });
    }
    console.log('Service zones created');

    // Create Service Plans
    const plans = [
      { name: 'Basic Monthly', plan_type: 'subscription', visits_per_month: 8, price: 999, duration_days: 30, max_plants: 10, description: '8 visits/month, up to 10 plants', features: ['8 visits', '10 plants max', 'WhatsApp updates', 'Rating system'] },
      { name: 'Standard Monthly', plan_type: 'subscription', visits_per_month: 12, price: 1499, duration_days: 30, max_plants: 20, description: '12 visits/month, up to 20 plants', features: ['12 visits', '20 plants max', 'WhatsApp updates', 'Priority support', 'Free plant identification'] },
      { name: 'Premium Monthly', plan_type: 'subscription', visits_per_month: 24, price: 2499, duration_days: 30, max_plants: 50, description: '24 visits/month, up to 50 plants', features: ['24 visits', '50 plants max', 'WhatsApp updates', 'Dedicated gardener', 'Free plant identification', 'Fertilizer included'] },
      { name: 'On-Demand Visit', plan_type: 'ondemand', visits_per_month: 1, price: 199, price_per_visit: 199, duration_days: 1, max_plants: 5, description: 'Single visit on demand', features: ['Single visit', 'Up to 5 plants', 'WhatsApp updates'] }
    ];

    for (const plan of plans) {
      await ServicePlan.findOrCreate({ where: { name: plan.name }, defaults: plan });
    }
    console.log('Service plans created');


    // Create Add-On Services
    const { AddOnService } = require('../models');
    const addons = [
      { name: 'Deep Fertilizing',   description: 'Premium organic fertilizer treatment for all plants', price: 299, duration_mins: 45, icon: '🌱', category: 'nutrition' },
      { name: 'Pest Control',       description: 'Eco-friendly pesticide spray for common garden pests', price: 399, duration_mins: 60, icon: '🐛', category: 'health' },
      { name: 'Pruning & Shaping',  description: 'Professional pruning and shape trimming for shrubs and hedges', price: 349, duration_mins: 60, icon: '✂️', category: 'grooming' },
      { name: 'Soil Replacement',   description: 'Replace old soil with premium potting mix (up to 5 pots)', price: 499, duration_mins: 90, icon: '🪴', category: 'soil' },
      { name: 'Plant Repotting',    description: 'Repot plants into new containers (per plant)', price: 150, duration_mins: 20, icon: '🏺', category: 'care' },
      { name: 'Lawn Mowing',        description: 'Professional lawn mowing and edging (up to 500 sq ft)', price: 599, duration_mins: 60, icon: '🌾', category: 'lawn' },
      { name: 'Composting Setup',   description: 'Set up a compost bin and initial composting guidance', price: 799, duration_mins: 90, icon: '♻️', category: 'nutrition' },
      { name: 'Plant Health Check', description: 'Detailed health assessment report for all your plants', price: 199, duration_mins: 30, icon: '🔍', category: 'health' },
    ];
    for (const addon of addons) {
      await AddOnService.findOrCreate({ where: { name: addon.name }, defaults: addon });
    }
    console.log('Add-on services created');

    console.log('\n✅ Seed completed!');
    console.log('Admin credentials:');
    console.log('  Phone: 9999999999');
    console.log('  Password: Admin@123');
    console.log('  Static OTP: 123456');
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();
