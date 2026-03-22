const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ─── USER MODEL ───────────────────────────────────────────────────────────────
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  phone: { type: DataTypes.STRING(15), allowNull: false, unique: true },
  email: { type: DataTypes.STRING(100), unique: true },
  password: { type: DataTypes.STRING(255) },
  role: { type: DataTypes.ENUM('admin', 'supervisor', 'gardener', 'customer'), defaultValue: 'customer' },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  is_approved: { type: DataTypes.BOOLEAN, defaultValue: false },
  profile_image: { type: DataTypes.STRING(500) },
  fcm_token: { type: DataTypes.STRING(500) },
  otp: { type: DataTypes.STRING(10) },
  otp_expires_at: { type: DataTypes.DATE },
  last_login: { type: DataTypes.DATE },
  latitude: { type: DataTypes.DECIMAL(10, 8) },
  longitude: { type: DataTypes.DECIMAL(11, 8) },
  address: { type: DataTypes.TEXT },
  city: { type: DataTypes.STRING(100) },
  state: { type: DataTypes.STRING(100) },
  pincode: { type: DataTypes.STRING(10) },
  wallet_balance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  total_spent: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  referral_code: { type: DataTypes.STRING(20), unique: true },
  referred_by: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } }
}, { tableName: 'users' });

// ─── GARDENER PROFILE ─────────────────────────────────────────────────────────
const GardenerProfile = sequelize.define('GardenerProfile', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  supervisor_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  experience_years: { type: DataTypes.INTEGER, defaultValue: 0 },
  bio: { type: DataTypes.TEXT },
  id_proof_type: { type: DataTypes.STRING(50) },
  id_proof_image: { type: DataTypes.STRING(500) },
  id_proof_number: { type: DataTypes.STRING(50) },
  bank_account: { type: DataTypes.STRING(30) },
  bank_ifsc: { type: DataTypes.STRING(15) },
  bank_name: { type: DataTypes.STRING(100) },
  rating: { type: DataTypes.DECIMAL(3, 2), defaultValue: 5.0 },
  total_jobs: { type: DataTypes.INTEGER, defaultValue: 0 },
  completed_jobs: { type: DataTypes.INTEGER, defaultValue: 0 },
  cancelled_jobs: { type: DataTypes.INTEGER, defaultValue: 0 },
  total_earnings: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  pending_earnings: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  is_available: { type: DataTypes.BOOLEAN, defaultValue: true },
  current_latitude: { type: DataTypes.DECIMAL(10, 8) },
  current_longitude: { type: DataTypes.DECIMAL(11, 8) },
  last_location_update: { type: DataTypes.DATE }
}, { tableName: 'gardener_profiles' });

// ─── SERVICE ZONE ─────────────────────────────────────────────────────────────
const ServiceZone = sequelize.define('ServiceZone', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  city: { type: DataTypes.STRING(100), allowNull: false },
  state: { type: DataTypes.STRING(100), allowNull: false },
  polygon_coordinates: { type: DataTypes.JSON },
  center_latitude: { type: DataTypes.DECIMAL(10, 8) },
  center_longitude: { type: DataTypes.DECIMAL(11, 8) },
  radius_km: { type: DataTypes.DECIMAL(5, 2) },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  base_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  price_per_plant: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  min_plants: { type: DataTypes.INTEGER, defaultValue: 1 },
  description: { type: DataTypes.TEXT }
}, { tableName: 'service_zones' });

// ─── GARDENER ZONE ASSIGNMENT ─────────────────────────────────────────────────
const GardenerZone = sequelize.define('GardenerZone', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  gardener_id: { type: DataTypes.INTEGER, allowNull: false },
  zone_id: { type: DataTypes.INTEGER, allowNull: false }
}, { tableName: 'gardener_zones' });

// ─── SERVICE PLAN ─────────────────────────────────────────────────────────────
const ServicePlan = sequelize.define('ServicePlan', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  description: { type: DataTypes.TEXT },
  plan_type: { type: DataTypes.ENUM('subscription', 'ondemand'), defaultValue: 'subscription' },
  visits_per_month: { type: DataTypes.INTEGER, defaultValue: 8 },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  price_per_visit: { type: DataTypes.DECIMAL(10, 2) },
  duration_days: { type: DataTypes.INTEGER, defaultValue: 30 },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  features: { type: DataTypes.JSON },
  max_plants: { type: DataTypes.INTEGER, defaultValue: 20 },
  is_weekend_included: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'service_plans' });

// ─── SUBSCRIPTION ─────────────────────────────────────────────────────────────
const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  customer_id: { type: DataTypes.INTEGER, allowNull: false },
  plan_id: { type: DataTypes.INTEGER, allowNull: false },
  zone_id: { type: DataTypes.INTEGER },
  preferred_gardener_id: { type: DataTypes.INTEGER },
  status: { type: DataTypes.ENUM('active', 'paused', 'cancelled', 'expired'), defaultValue: 'active' },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  auto_renew: { type: DataTypes.BOOLEAN, defaultValue: true },
  visits_used: { type: DataTypes.INTEGER, defaultValue: 0 },
  visits_total: { type: DataTypes.INTEGER, allowNull: false },
  amount_paid: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  service_address: { type: DataTypes.TEXT },
  service_latitude: { type: DataTypes.DECIMAL(10, 8) },
  service_longitude: { type: DataTypes.DECIMAL(11, 8) },
  plant_count: { type: DataTypes.INTEGER, defaultValue: 1 },
  notes: { type: DataTypes.TEXT },
  payment_id: { type: DataTypes.STRING(100) }
}, { tableName: 'subscriptions' });

// ─── BOOKING / JOB ────────────────────────────────────────────────────────────
const Booking = sequelize.define('Booking', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  booking_number: { type: DataTypes.STRING(20), unique: true },
  customer_id: { type: DataTypes.INTEGER, allowNull: false },
  gardener_id: { type: DataTypes.INTEGER },
  subscription_id: { type: DataTypes.INTEGER },
  zone_id: { type: DataTypes.INTEGER },
  booking_type: { type: DataTypes.ENUM('subscription', 'ondemand'), defaultValue: 'ondemand' },
  status: {
    type: DataTypes.ENUM('pending', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'failed'),
    defaultValue: 'pending'
  },
  scheduled_date: { type: DataTypes.DATEONLY, allowNull: false },
  scheduled_time: { type: DataTypes.TIME },
  otp: { type: DataTypes.STRING(6) },
  otp_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
  otp_verified_at: { type: DataTypes.DATE },
  started_at: { type: DataTypes.DATE },
  completed_at: { type: DataTypes.DATE },
  gardener_arrived_at: { type: DataTypes.DATE },
  service_address: { type: DataTypes.TEXT, allowNull: false },
  service_latitude: { type: DataTypes.DECIMAL(10, 8), allowNull: false },
  service_longitude: { type: DataTypes.DECIMAL(11, 8), allowNull: false },
  plant_count: { type: DataTypes.INTEGER, defaultValue: 1 },
  extra_plants: { type: DataTypes.INTEGER, defaultValue: 0 },
  base_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  extra_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  total_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  payment_status: { type: DataTypes.ENUM('pending', 'paid', 'refunded'), defaultValue: 'pending' },
  before_image: { type: DataTypes.STRING(500) },
  after_image: { type: DataTypes.STRING(500) },
  gardener_notes: { type: DataTypes.TEXT },
  customer_notes: { type: DataTypes.TEXT },
  cancellation_reason: { type: DataTypes.TEXT },
  rating: { type: DataTypes.INTEGER },
  review: { type: DataTypes.TEXT },
  rated_at: { type: DataTypes.DATE }
}, { tableName: 'bookings' });

// ─── BOOKING TRACKING ─────────────────────────────────────────────────────────
const BookingTracking = sequelize.define('BookingTracking', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  booking_id: { type: DataTypes.INTEGER, allowNull: false },
  gardener_id: { type: DataTypes.INTEGER, allowNull: false },
  latitude: { type: DataTypes.DECIMAL(10, 8), allowNull: false },
  longitude: { type: DataTypes.DECIMAL(11, 8), allowNull: false },
  status: { type: DataTypes.STRING(50) }
}, { tableName: 'booking_tracking' });

// ─── NOTIFICATION ─────────────────────────────────────────────────────────────
const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.STRING(50) },
  data: { type: DataTypes.JSON },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
  read_at: { type: DataTypes.DATE }
}, { tableName: 'notifications' });

// ─── REWARD / PENALTY ─────────────────────────────────────────────────────────
const RewardPenalty = sequelize.define('RewardPenalty', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  gardener_id: { type: DataTypes.INTEGER, allowNull: false },
  type: { type: DataTypes.ENUM('reward', 'penalty'), allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  reason: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT },
  booking_id: { type: DataTypes.INTEGER },
  status: { type: DataTypes.ENUM('pending', 'applied', 'reversed'), defaultValue: 'pending' },
  applied_at: { type: DataTypes.DATE }
}, { tableName: 'reward_penalties' });

// ─── PLANT IDENTIFICATION ─────────────────────────────────────────────────────
const PlantIdentification = sequelize.define('PlantIdentification', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  image_url: { type: DataTypes.STRING(500), allowNull: false },
  plant_name: { type: DataTypes.STRING(200) },
  scientific_name: { type: DataTypes.STRING(200) },
  description: { type: DataTypes.TEXT },
  care_instructions: { type: DataTypes.JSON },
  watering_schedule: { type: DataTypes.STRING(200) },
  fertilizer_tips: { type: DataTypes.TEXT },
  sunlight_requirement: { type: DataTypes.STRING(100) },
  confidence_score: { type: DataTypes.DECIMAL(5, 2) },
  raw_response: { type: DataTypes.JSON }
}, { tableName: 'plant_identifications' });

// ─── BLOG ─────────────────────────────────────────────────────────────────────
const Blog = sequelize.define('Blog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(300), allowNull: false },
  slug: { type: DataTypes.STRING(300), unique: true, allowNull: false },
  content: { type: DataTypes.TEXT('long'), allowNull: false },
  excerpt: { type: DataTypes.TEXT },
  featured_image: { type: DataTypes.STRING(500) },
  category: { type: DataTypes.STRING(100) },
  tags: { type: DataTypes.JSON },
  author_id: { type: DataTypes.INTEGER },
  status: { type: DataTypes.ENUM('draft', 'published', 'archived'), defaultValue: 'draft' },
  seo_title: { type: DataTypes.STRING(300) },
  seo_description: { type: DataTypes.TEXT },
  city_slug: { type: DataTypes.STRING(100) },
  views: { type: DataTypes.INTEGER, defaultValue: 0 },
  published_at: { type: DataTypes.DATE }
}, { tableName: 'blogs' });

// ─── CITY PAGE ────────────────────────────────────────────────────────────────
const CityPage = sequelize.define('CityPage', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  city_name: { type: DataTypes.STRING(100), allowNull: false },
  slug: { type: DataTypes.STRING(100), unique: true, allowNull: false },
  state: { type: DataTypes.STRING(100) },
  hero_title: { type: DataTypes.STRING(300) },
  hero_description: { type: DataTypes.TEXT },
  content: { type: DataTypes.TEXT('long') },
  seo_title: { type: DataTypes.STRING(300) },
  seo_description: { type: DataTypes.TEXT },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  total_gardeners: { type: DataTypes.INTEGER, defaultValue: 0 },
  total_customers: { type: DataTypes.INTEGER, defaultValue: 0 }
}, { tableName: 'city_pages' });

// ─── PAYMENT ──────────────────────────────────────────────────────────────────
const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  booking_id: { type: DataTypes.INTEGER },
  subscription_id: { type: DataTypes.INTEGER },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  type: { type: DataTypes.ENUM('booking', 'subscription', 'refund', 'wallet_topup'), allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'success', 'failed', 'refunded'), defaultValue: 'pending' },
  payment_method: { type: DataTypes.STRING(50) },
  transaction_id: { type: DataTypes.STRING(100) },
  gateway_response: { type: DataTypes.JSON },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'payments' });

// ─── PRICE HIKE LOG ───────────────────────────────────────────────────────────
const PriceHikeLog = sequelize.define('PriceHikeLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  zone_id: { type: DataTypes.INTEGER },
  plan_id: { type: DataTypes.INTEGER },
  old_price: { type: DataTypes.DECIMAL(10, 2) },
  new_price: { type: DataTypes.DECIMAL(10, 2) },
  hike_percentage: { type: DataTypes.DECIMAL(5, 2) },
  reason: { type: DataTypes.STRING(200) },
  applied_by: { type: DataTypes.INTEGER }
}, { tableName: 'price_hike_logs' });


// ─── PRICE HIKE SCHEDULE ──────────────────────────────────────────────────────
const PriceHikeSchedule = sequelize.define('PriceHikeSchedule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100) },
  zone_ids: { type: DataTypes.JSON },
  plan_ids: { type: DataTypes.JSON },
  percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  reason: { type: DataTypes.STRING(200) },
  scheduled_at: { type: DataTypes.DATE, allowNull: false },
  is_applied: { type: DataTypes.BOOLEAN, defaultValue: false },
  applied_at: { type: DataTypes.DATE },
  created_by: { type: DataTypes.INTEGER }
}, { tableName: 'price_hike_schedules' });


// ─── COMPLAINT ────────────────────────────────────────────────────────────────
const Complaint = sequelize.define('Complaint', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  booking_id:    { type: DataTypes.INTEGER, references: { model: 'bookings', key: 'id' } },
  customer_id:   { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  gardener_id:   { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  assigned_to:   { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } }, // supervisor
  type: { type: DataTypes.ENUM('service_quality','late_arrival','no_show','rude_behavior','billing','damage','other'), allowNull: false },
  description:   { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.ENUM('open','in_review','resolved','closed'), defaultValue: 'open' },
  priority: { type: DataTypes.ENUM('low','medium','high'), defaultValue: 'medium' },
  resolution_notes: { type: DataTypes.TEXT },
  resolved_at:   { type: DataTypes.DATE },
  resolved_by:   { type: DataTypes.INTEGER }
}, { tableName: 'complaints' });


// ─── SLA CONFIG ───────────────────────────────────────────────────────────────
const SLAConfig = sequelize.define('SLAConfig', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  max_arrival_delay_mins:   { type: DataTypes.INTEGER, defaultValue: 30 },
  max_service_duration_hrs: { type: DataTypes.DECIMAL(4,1), defaultValue: 3.0 },
  response_time_hrs:        { type: DataTypes.INTEGER, defaultValue: 24 },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  updated_by: { type: DataTypes.INTEGER }
}, { tableName: 'sla_configs' });

// ─── SLA BREACH ───────────────────────────────────────────────────────────────
const SLABreach = sequelize.define('SLABreach', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  booking_id:  { type: DataTypes.INTEGER, allowNull: false },
  gardener_id: { type: DataTypes.INTEGER },
  breach_type: { type: DataTypes.ENUM('late_arrival','service_overtime','no_start','no_completion'), allowNull: false },
  expected_by: { type: DataTypes.DATE },
  detected_at: { type: DataTypes.DATE },
  delay_minutes: { type: DataTypes.INTEGER },
  supervisor_notified: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_resolved: { type: DataTypes.BOOLEAN, defaultValue: false },
  resolved_at: { type: DataTypes.DATE }
}, { tableName: 'sla_breaches' });


// ─── ADD-ON SERVICE ───────────────────────────────────────────────────────────
const AddOnService = sequelize.define('AddOnService', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:        { type: DataTypes.STRING(100), allowNull: false },
  description: { type: DataTypes.TEXT },
  price:       { type: DataTypes.DECIMAL(10,2), allowNull: false },
  duration_mins: { type: DataTypes.INTEGER, defaultValue: 30 },
  icon:        { type: DataTypes.STRING(10), defaultValue: '🌿' },
  is_active:   { type: DataTypes.BOOLEAN, defaultValue: true },
  category:    { type: DataTypes.STRING(50) }
}, { tableName: 'addon_services' });

// ─── BOOKING ADD-ON ───────────────────────────────────────────────────────────
const BookingAddOn = sequelize.define('BookingAddOn', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  booking_id: { type: DataTypes.INTEGER, allowNull: false },
  addon_id:   { type: DataTypes.INTEGER, allowNull: false },
  quantity:   { type: DataTypes.INTEGER, defaultValue: 1 },
  price:      { type: DataTypes.DECIMAL(10,2), allowNull: false },
  status:     { type: DataTypes.ENUM('pending','completed'), defaultValue: 'pending' }
}, { tableName: 'booking_addons' });

// ─── ASSOCIATIONS ─────────────────────────────────────────────────────────────
GardenerProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
GardenerProfile.belongsTo(User, { foreignKey: 'supervisor_id', as: 'supervisor' });
User.hasOne(GardenerProfile, { foreignKey: 'user_id', as: 'gardenerProfile' });

Booking.belongsTo(User, { foreignKey: 'customer_id', as: 'customer' });
Booking.belongsTo(User, { foreignKey: 'gardener_id', as: 'gardener' });
Booking.belongsTo(Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
Booking.belongsTo(ServiceZone, { foreignKey: 'zone_id', as: 'zone' });
Booking.hasMany(BookingTracking, { foreignKey: 'booking_id', as: 'tracking' });

Subscription.belongsTo(User, { foreignKey: 'customer_id', as: 'customer' });
Subscription.belongsTo(ServicePlan, { foreignKey: 'plan_id', as: 'plan' });
Subscription.belongsTo(User, { foreignKey: 'preferred_gardener_id', as: 'preferredGardener' });

GardenerZone.belongsTo(User, { foreignKey: 'gardener_id', as: 'gardener' });
GardenerZone.belongsTo(ServiceZone, { foreignKey: 'zone_id', as: 'zone' });
User.hasMany(GardenerZone, { foreignKey: 'gardener_id', as: 'assignedZones' });
ServiceZone.hasMany(GardenerZone, { foreignKey: 'zone_id', as: 'gardenerAssignments' });

RewardPenalty.belongsTo(User, { foreignKey: 'gardener_id', as: 'gardener' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Payment associations
Payment.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Payment.belongsTo(Booking, { foreignKey: 'booking_id', as: 'bookingRef' });
Payment.belongsTo(Subscription, { foreignKey: 'subscription_id', as: 'subscriptionRef' });

// Blog associations
Blog.belongsTo(User, { foreignKey: 'author_id', as: 'author' });

// Complaint associations
Complaint.belongsTo(User, { foreignKey: 'customer_id', as: 'customer' });
Complaint.belongsTo(User, { foreignKey: 'gardener_id', as: 'gardener' });
Complaint.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignedTo' });
Complaint.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });

SLABreach.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
SLABreach.belongsTo(User, { foreignKey: 'gardener_id', as: 'gardener' });
BookingAddOn.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
BookingAddOn.belongsTo(AddOnService, { foreignKey: 'addon_id', as: 'addon' });
Booking.hasMany(BookingAddOn, { foreignKey: 'booking_id', as: 'addons' });

module.exports = {
  AddOnService,
  BookingAddOn,
  SLAConfig,
  SLABreach,
  Complaint,
  PriceHikeSchedule,
  sequelize,
  User,
  GardenerProfile,
  ServiceZone,
  GardenerZone,
  ServicePlan,
  Subscription,
  Booking,
  BookingTracking,
  Notification,
  RewardPenalty,
  PlantIdentification,
  Blog,
  CityPage,
  Payment,
  PriceHikeLog
};
