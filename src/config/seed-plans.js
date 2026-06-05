/**
 * One-off: replace the service plans with the canonical GharKaMali plans
 * (mirrors https://gharkamali.com/pages/plans), with MONTHLY + ANNUAL variants.
 *
 * Run on the server:
 *   cd /var/www/gharkamali && node src/config/seed-plans.js
 *
 * Generates: One-Time (on-demand) + for each of the 5 tiers a monthly plan AND
 * an annual plan (slug `<tier>-annual`, duration_days 365, real yearly price).
 *
 * Cleanup is SAFE: a plan still referenced by a subscription is deactivated
 * (kept for history, its subs stay valid); unreferenced plans are deleted.
 * Re-runnable — clears the old set each time before inserting.
 */
require('dotenv').config();
const { sequelize, ServicePlan, Subscription } = require('../models');

const round2 = (n) => Number(n.toFixed(2));
// Indian-style grouping without relying on Intl/ICU being present.
const inr = (n) => {
  const s = String(Math.round(n));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
};

// On-demand single visit — no annual variant.
const ONE_TIME = {
  name: 'One-Time',
  slug: 'one-time',
  tagline: 'Urgent gardening help',
  description: 'A single on-demand visit for urgent gardening help. Up to 5 plants.',
  plan_type: 'ondemand',
  visits_per_month: 1,
  price: 599.00,
  price_subtitle: 'One-time',
  price_per_visit: 599.00,
  plan_summary: 'Pay per visit',
  duration_days: 1,
  max_plants: 5,
  is_best_value: false,
  button_text: 'Book Now',
  is_active: true,
  features: [
    'Basic pruning',
    'Aeration (soil care)',
    'Basic monitoring',
    'Light cleaning',
    'Basic pest monitoring',
  ],
};

// Each tier yields a monthly plan and an annual plan.
const TIERS = [
  {
    name: 'Basic', slug: 'basic', tagline: 'Small balcony upkeep',
    visits: 2, maxPlants: 15, monthly: 1999, yearly: 19670, popular: true,
    features: [
      'Regular pruning', 'Aeration', 'Monitoring', 'Waste removal',
      'Basic pest monitoring', 'Light cleaning', '1 free plant', '5% discount',
    ],
  },
  {
    name: 'Plus', slug: 'plus', tagline: 'Growing & improving plants',
    visits: 2, maxPlants: 25, monthly: 2499, yearly: 24590, popular: false,
    features: [
      'Regular pruning', 'Aeration', 'Improved monitoring', 'Fertilizer / compost included',
      'Waste removal', 'Deep cleaning', 'Basic disease treatment', 'Watering guidance',
      'Advanced nutrients', 'Priority booking', 'Basic garden advice', '1 free plant', '10% discount',
    ],
  },
  {
    name: 'Premium', slug: 'premium', tagline: 'Serious plant lovers',
    visits: 3, maxPlants: 40, monthly: 3999, yearly: 39350, popular: false,
    features: [
      'Deep pruning', 'Soil refresh', 'Recovery diagnostics', 'Fertilizer / compost included',
      'Deep cleaning', 'Preventive pest monitoring', 'Advanced disease treatment', 'Watering guidance',
      'Advanced nutrients', 'Priority booking', '1 emergency visit/month', 'Expert garden advice',
      'Limited repotting', 'Seasonal plan included', '15% discount',
    ],
  },
  {
    name: 'Elite', slug: 'elite', tagline: 'Large balcony / terrace gardens',
    visits: 4, maxPlants: 100, monthly: 7999, yearly: 78710, popular: false,
    features: [
      'Advanced pruning', 'Custom soil enrichment', 'Recovery diagnostics', 'Premium fertilizer / compost',
      'Premium cleaning', 'Priority waste removal', 'Advanced pest monitoring', 'Priority disease treatment',
      'Smart watering guidance', 'Premium nutrients', 'Fast-track priority booking', '2 emergency visits/month',
      'Dedicated gardener', 'Expert garden advice', 'Unlimited repotting', 'Advanced seasonal plan',
      '2 free plants/month', '20% discount',
    ],
  },
  {
    name: 'Elite Plus', slug: 'elite-plus', tagline: 'Luxury gardening & full automation',
    visits: 5, maxPlants: 150, monthly: 8999, yearly: 88550, popular: false,
    features: [
      'Expert pruning', 'Custom soil enrichment', 'Doctor-level diagnostics', 'Premium fertilizer / compost',
      'Premium cleaning', 'Priority waste removal', 'Hybrid pest / disease management', 'Doctor-level disease treatment',
      'Smart watering guidance', 'Custom nutrients', 'Manager-level priority booking', 'Unlimited emergency visits',
      'Dedicated gardener', 'Landscape advice', 'Unlimited repotting', 'Custom seasonal plan',
      '3 premium free plants/month', '25% discount',
    ],
  },
];

const monthlyPlan = (t) => ({
  name: t.name,
  slug: t.slug,
  tagline: t.tagline,
  description: `${t.tagline} — ${t.visits} visits/month for up to ${t.maxPlants} plants.`,
  plan_type: 'subscription',
  visits_per_month: t.visits,
  price: round2(t.monthly),
  price_subtitle: 'per month',
  price_per_visit: round2(t.monthly / t.visits),
  plan_summary: `₹${inr(t.monthly)}/month`,
  duration_days: 30,
  max_plants: t.maxPlants,
  is_best_value: !!t.popular,
  button_text: 'Select',
  is_active: true,
  features: t.features,
});

const annualPlan = (t) => {
  const saving = t.monthly * 12 - t.yearly;
  return {
    name: `${t.name} (Annual)`,
    slug: `${t.slug}-annual`,
    tagline: t.tagline,
    description: `${t.tagline} — billed annually (₹${inr(t.yearly)}/year ≈ ₹${inr(Math.round(t.yearly / 12))}/month). ${t.visits} visits/month for up to ${t.maxPlants} plants.`,
    plan_type: 'subscription',
    visits_per_month: t.visits,
    price: round2(t.yearly),
    price_subtitle: 'per year',
    price_per_visit: round2(t.yearly / (t.visits * 12)),
    plan_summary: `Save ₹${inr(saving)} vs monthly`,
    duration_days: 365,
    max_plants: t.maxPlants,
    is_best_value: false,
    button_text: 'Select',
    is_active: true,
    features: t.features,
  };
};

const PLANS = [ONE_TIME, ...TIERS.flatMap((t) => [monthlyPlan(t), annualPlan(t)])];

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // ── Clean up existing plans ──────────────────────────────────────────────
    const existing = await ServicePlan.findAll();
    console.log(`Found ${existing.length} existing plan(s).`);
    for (const p of existing) {
      const inUse = await Subscription.count({ where: { plan_id: p.id } });
      if (inUse > 0) {
        await p.update({ is_active: false, slug: null }); // hide, free the slug
        console.log(`  • Deactivated in-use plan #${p.id} "${p.name}" (${inUse} subscription(s))`);
      } else {
        await p.destroy();
        console.log(`  • Deleted unused plan #${p.id} "${p.name}"`);
      }
    }

    // ── Insert the canonical plans (One-Time + monthly/annual per tier) ───────
    for (const plan of PLANS) {
      const created = await ServicePlan.create(plan);
      console.log(`  ✓ Created "${created.name}" (#${created.id}) — ₹${created.price} ${created.price_subtitle}`);
    }

    console.log(`\n🎉 Done. ${PLANS.length} plans created.`);
    process.exit(0);
  } catch (e) {
    console.error('❌ Seed failed:', e.message);
    process.exit(1);
  }
})();
