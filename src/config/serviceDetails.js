// ─────────────────────────────────────────────────────────────────────────────
// Standard Service Detail content — single source of truth for the customer
// app AND the website (served via GET /service-details). Content mirrors
// "GharKaMali Service Details & FAQs (Developer Copy)". Edit HERE only.
// ─────────────────────────────────────────────────────────────────────────────

// FAQs shared by every service.
const COMMON_FAQS = [
  { q: 'Do you bring tools?', a: 'Yes, our gardeners carry essential gardening tools.' },
  { q: 'Do I need to provide water?', a: 'Yes, please ensure water access is available.' },
  { q: 'Can I buy plants and fertilizers from GharKaMali?', a: 'Yes, these can be added during booking or purchased separately.' },
  { q: 'Can I reschedule?', a: 'Yes, subject to availability.' },
];

// Standard block for the specialist services (3–15 in the source doc).
const STD = {
  includes: ['Professional service', 'Site inspection', 'Expert guidance'],
  excludes: ['Items outside selected package'],
  steps: ['Inspection', 'Execution', 'Final quality check'],
  faqs: COMMON_FAQS,
};

const SERVICE_DETAILS = [
  {
    slug: 'one-time-plant-care',
    name: 'One-Time Plant Care',
    overview: 'Professional visit for complete plant maintenance and basic plantation.',
    includes: [
      'Watering plants', 'Dry leaf removal', 'Cleaning pots', 'Soil loosening',
      'Basic pruning', 'Basic weeding', 'Plant rearrangement', 'Garden cleanup',
      'Plant health inspection',
      'NEW: Plantation of customer-provided or GharKaMali purchased plants',
    ],
    excludes: ['Landscape design', 'Tree cutting', 'Civil work', 'Heavy pruning', 'Repotting (unless booked)'],
    steps: ['Garden inspection', 'Plant care & plantation', 'Final cleanup'],
    faqs: [
      ...COMMON_FAQS,
      { q: 'Is new plantation included?', a: 'Yes. Our gardener can plant new plants during the visit. Plants, pots and soil can be purchased from GharKaMali or provided by the customer.' },
    ],
  },
  {
    slug: 'monthly-plant-care',
    name: 'Monthly Plant Care Subscription',
    overview: 'Regular scheduled visits to keep your garden healthy throughout the month.',
    includes: [
      'Scheduled maintenance visits', 'Watering', 'Pruning', 'Weeding', 'Cleaning',
      'Soil loosening', 'Plant inspection', 'Garden cleanup',
      'NEW: Plantation of newly purchased plants during scheduled visits',
    ],
    excludes: ['Landscape execution', 'Civil work', 'Major tree cutting'],
    steps: ['Scheduled visit', 'Maintenance & plantation', 'Health check', 'Next visit scheduled'],
    faqs: [
      ...COMMON_FAQS,
      { q: 'Can I add new plants anytime?', a: 'Yes. New plantation is included during your scheduled maintenance visit.' },
    ],
  },
  { slug: 'balcony-garden-setup', name: 'Balcony Garden Setup', overview: 'Design and installation of balcony gardens.', ...STD },
  { slug: 'terrace-garden-setup', name: 'Terrace Garden Setup', overview: 'Complete terrace garden creation.', ...STD },
  { slug: 'lawn-installation', name: 'Lawn Installation', overview: 'Natural lawn installation.', ...STD },
  { slug: 'lawn-maintenance', name: 'Lawn Maintenance', overview: 'Routine lawn care.', ...STD },
  { slug: 'plant-repotting', name: 'Plant Repotting', overview: 'Repotting with fresh soil.', ...STD },
  { slug: 'plant-doctor', name: 'Plant Doctor', overview: 'Plant diagnosis and treatment advice.', ...STD },
  { slug: 'plant-pest-control', name: 'Plant Pest Control', overview: 'Treatment for pests and insects.', ...STD },
  { slug: 'kitchen-garden-setup', name: 'Kitchen Garden Setup', overview: 'Vegetable garden installation.', ...STD },
  { slug: 'vertical-garden', name: 'Vertical Garden', overview: 'Vertical green wall installation.', ...STD },
  { slug: 'office-plant-maintenance', name: 'Office Plant Maintenance', overview: 'Office plant care.', ...STD },
  { slug: 'society-garden-maintenance', name: 'Society Garden Maintenance', overview: 'Garden maintenance contracts.', ...STD },
  { slug: 'plant-shifting', name: 'Plant Shifting', overview: 'Safe relocation of plants.', ...STD },
  { slug: 'landscape-design', name: 'Landscape Design', overview: 'Custom landscape planning.', ...STD },
];

module.exports = { SERVICE_DETAILS };
