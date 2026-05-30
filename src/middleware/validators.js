// Strict validation rules for every input-taking route.
// Grouped by domain. All rules trim, normalize, and reject anything not on the
// allow-list. Designed for INDIA-first inputs.
const { body, param, query } = require('express-validator');

// ── Reusable atoms ──────────────────────────────────────────────────────────
// Indian mobile: 10 digits, starts 6-9. Optionally accept +91 / 0 prefix.
const phone = (field = 'phone', optional = false) => {
  const chain = body(field)
    .customSanitizer(v => (typeof v === 'string' ? v.replace(/[\s-]/g, '').replace(/^(\+?91|0)/, '') : v))
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number');
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage('Phone is required');
};

const otp = (field = 'otp') =>
  body(field).trim().isString().matches(/^\d{4,6}$/).withMessage('OTP must be 4-6 digits');

const email = (field = 'email', optional = true) => {
  const chain = body(field).trim().toLowerCase()
    .isEmail({ allow_utf8_local_part: false }).withMessage('Enter a valid email')
    .isLength({ max: 120 }).withMessage('Email too long');
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage('Email is required');
};

const name = (field = 'name', { min = 2, max = 80, optional = false } = {}) => {
  const chain = body(field).trim()
    .isString().withMessage(`${field} must be text`)
    .isLength({ min, max }).withMessage(`${field} must be ${min}–${max} characters`)
    .matches(/^[A-Za-zऀ-ॿ .'\-]+$/).withMessage(`${field} contains invalid characters`);
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const pincode = (field = 'pincode', optional = true) => {
  const chain = body(field).trim().matches(/^[1-9][0-9]{5}$/).withMessage('Enter a valid 6-digit pincode');
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage('Pincode is required');
};

const gstin = (field = 'billing_gstin', optional = true) => {
  const chain = body(field).trim().toUpperCase()
    .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .withMessage('Invalid GSTIN — must be 15 characters in the official format');
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage('GSTIN is required');
};

const amount = (field, { min = 0, max = 1000000, optional = false } = {}) => {
  const chain = body(field).isFloat({ min, max }).withMessage(`${field} must be a number between ${min} and ${max}`).toFloat();
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const intInRange = (field, { min = 0, max = 100000, optional = false } = {}) => {
  const chain = body(field).isInt({ min, max }).withMessage(`${field} must be an integer between ${min} and ${max}`).toInt();
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const text = (field, { min = 0, max = 5000, optional = false } = {}) => {
  const chain = body(field).trim().isString().isLength({ min, max }).withMessage(`${field} must be ${min}–${max} characters`);
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const enumIn = (field, values, { optional = false } = {}) => {
  const chain = body(field).isIn(values).withMessage(`${field} must be one of: ${values.join(', ')}`);
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const lat = (field, optional = true) => {
  const chain = body(field).isFloat({ min: -90, max: 90 }).withMessage(`${field} must be a valid latitude`).toFloat();
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const lng = (field, optional = true) => {
  const chain = body(field).isFloat({ min: -180, max: 180 }).withMessage(`${field} must be a valid longitude`).toFloat();
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const isoDate = (field, optional = false) => {
  const chain = body(field).isISO8601().withMessage(`${field} must be a valid date (YYYY-MM-DD)`).toDate();
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const idParam = (paramName = 'id') =>
  param(paramName).isInt({ min: 1 }).withMessage(`Invalid ${paramName}`).toInt();

const url = (field, optional = true) => {
  const chain = body(field).trim().isURL({ require_protocol: true, protocols: ['http', 'https'] })
    .withMessage(`${field} must be a valid URL`).isLength({ max: 500 });
  return optional ? chain.optional({ values: 'falsy' }) : chain.notEmpty().withMessage(`${field} is required`);
};

const slug = (field) =>
  body(field).trim().toLowerCase().matches(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/)
    .withMessage(`${field} must be lowercase letters, numbers and hyphens only (max 80)`);

const password = (field = 'password') =>
  body(field).isString().isLength({ min: 8, max: 64 }).withMessage('Password must be 8–64 characters')
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
    .matches(/\d/).withMessage('Password must contain a number');

// ── Domain rule sets ────────────────────────────────────────────────────────

// AUTH
const auth = {
  sendOtp:        [phone()],
  verifyOtp:      [phone(), otp(), name('name', { optional: true }), lat('lat', true), lng('lng', true)],
  adminLogin:     [phone(), body('password').isString().notEmpty().withMessage('Password is required').isLength({ max: 128 })],
  gardenerLogin:  [phone(), otp()],
  gardenerRegister: [
    name('name'), phone(), email(),
    text('bio', { max: 1000, optional: true }),
    body('experience_years').optional({ values: 'falsy' }).isInt({ min: 0, max: 80 }).toInt(),
  ],
  updateProfile: [
    name('name', { optional: true }),
    email(),
    text('address', { max: 500, optional: true }),
    pincode('pincode', true),
  ],
};

// BOOKINGS
const booking = {
  create: [
    intInRange('plan_id', { min: 1, max: 1000000, optional: true }),
    intInRange('zone_id', { min: 1, optional: true }),
    intInRange('geofence_id', { min: 1, optional: true }),
    // Date/time optional — required only for scheduled bookings; instant bookings
    // get a server-computed slot when `is_instant: true`.
    body('scheduled_date').optional({ values: 'falsy' }).isISO8601().withMessage('scheduled_date must be ISO date'),
    body('scheduled_time').optional({ values: 'falsy' }).matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .withMessage('scheduled_time must be HH:mm'),
    body('is_instant').optional({ values: 'falsy' }).isBoolean().toBoolean(),
    text('service_address', { min: 5, max: 500 }),
    lat('service_latitude', false), lng('service_longitude', false),
    intInRange('plant_count', { min: 1, max: 1000, optional: true }),
    intInRange('preferred_gardener_id', { min: 1, optional: true }),
    text('customer_notes', { max: 1000, optional: true }),
  ],
  cancel: [
    intInRange('booking_id', { min: 1 }),
    text('reason', { max: 500, optional: true }),
  ],
  rate: [
    intInRange('booking_id', { min: 1 }),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5').toInt(),
    text('review', { max: 1000, optional: true }),
  ],
  reschedule: [
    intInRange('booking_id', { min: 1 }),
    isoDate('new_date'),
    body('new_time').optional({ values: 'falsy' }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('new_time must be HH:mm'),
  ],
  verifyOtp: [intInRange('booking_id', { min: 1 }), otp()],
  updateLocation: [
    lat('latitude', false), lng('longitude', false),
    intInRange('booking_id', { min: 1, optional: true }),
  ],
};

// ORDERS
const order = {
  create: [
    body('items').optional({ values: 'falsy' }).isArray({ max: 50 }).withMessage('items must be an array (max 50)'),
    body('items.*.product_id').optional().isInt({ min: 1 }).withMessage('items[].product_id must be a positive integer'),
    body('items.*.quantity').optional().isInt({ min: 1, max: 100 }).withMessage('items[].quantity must be 1-100'),
    text('shipping_address', { min: 5, max: 500 }),
    text('shipping_city', { max: 80, optional: true }),
    pincode('shipping_pincode', true),
    intInRange('geofence_id', { min: 1, optional: true }),
    intInRange('zone_id', { min: 1, optional: true }),
    lat('service_latitude', true), lng('service_longitude', true),
    text('notes', { max: 1000, optional: true }),
    body('apply_gst').optional({ values: 'falsy' }).isBoolean().toBoolean(),
    // If apply_gst is true, gstin + business name are required.
    body('billing_gstin').if(body('apply_gst').equals('true')).notEmpty().withMessage('GSTIN is required when claiming GST'),
    gstin('billing_gstin', true),
    text('billing_business_name', { max: 200, optional: true }),
    text('shipping_state', { max: 80, optional: true }),
    text('coupon_code', { max: 40, optional: true }),
    body('book_mali').optional({ values: 'falsy' }).isBoolean().toBoolean(),
    body('service_bookings').optional({ values: 'falsy' }).isArray({ max: 10 }),
  ],
  updateStatus: [enumIn('status', ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'])],
};

// COUPONS
const coupon = {
  // Public: customer applying a code at checkout.
  validate: [
    text('code', { min: 1, max: 40 }),
    amount('subtotal', { min: 0, max: 10000000 }),
  ],
  // Admin: create / update a coupon.
  save: [
    text('code', { min: 2, max: 40 }),
    text('description', { max: 255, optional: true }),
    enumIn('discount_type', ['percentage', 'fixed']),
    amount('discount_value', { min: 0, max: 1000000 }),
    amount('min_order_amount', { min: 0, max: 10000000, optional: true }),
    amount('max_discount', { min: 0, max: 1000000, optional: true }),
    intInRange('usage_limit', { min: 1, max: 10000000, optional: true }),
    isoDate('valid_from', true),
    isoDate('valid_to', true),
    body('is_active').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  ],
};

// COMPLAINTS
const complaint = {
  create: [
    enumIn('type', ['service_quality','late_arrival','no_show','rude_behavior','billing','damage','other']),
    text('description', { min: 5, max: 2000 }),
    intInRange('booking_id', { min: 1, optional: true }),
    intInRange('department_id', { min: 1, optional: true }),
    intInRange('geofence_id', { min: 1, optional: true }),
    text('subject', { max: 255, optional: true }),
    enumIn('priority', ['low', 'medium', 'high'], { optional: true }),
  ],
  comment: [
    text('comment', { max: 5000, optional: true }),
    body('is_internal').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  ],
  update: [
    enumIn('status', ['open','in_progress','awaiting_customer','in_review','resolved','closed','reopened'], { optional: true }),
    enumIn('priority', ['low', 'medium', 'high'], { optional: true }),
    intInRange('assigned_to', { min: 1, optional: true }),
    intInRange('department_id', { min: 1, optional: true }),
    text('subject', { max: 255, optional: true }),
    text('resolution_notes', { max: 2000, optional: true }),
  ],
  department: [
    text('name', { min: 2, max: 80 }),
    text('description', { max: 255, optional: true }),
    body('is_active').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  ],
};

// SHOP PRODUCTS / CATEGORIES (admin)
const product = {
  create: [
    text('name', { min: 2, max: 200 }),
    amount('price', { min: 0, max: 1000000 }),
    amount('mrp', { min: 0, max: 1000000, optional: true }),
    intInRange('stock_quantity', { min: 0, max: 1000000, optional: true }),
    intInRange('category_id', { min: 1, optional: true }),
    enumIn('gst_rate', [0, 5, 12, 18, 28], { optional: true }),
    text('description', { max: 1000, optional: true }),
    text('badge', { max: 80, optional: true }),
    text('icon_key', { max: 40, optional: true }),
  ],
  bulkImport: [
    body('products').isArray({ min: 1, max: 5000 }).withMessage('products must be a non-empty array (max 5000)'),
    body('products.*.name').isString().trim().notEmpty().withMessage('Each row must have a name').isLength({ max: 200 }),
    body('products.*.price').isFloat({ min: 0 }).withMessage('Each row must have a valid price'),
  ],
  category: [
    text('name', { min: 2, max: 100 }),
    text('slug', { max: 100, optional: true }),
    text('description', { max: 500, optional: true }),
  ],
};

// PAYMENTS
const payment = {
  initiate: [
    amount('amount', { min: 1, max: 1000000 }),
    intInRange('booking_id', { min: 1, optional: true }),
    intInRange('subscription_id', { min: 1, optional: true }),
    enumIn('payment_for', ['booking', 'subscription', 'wallet_topup', 'order', 'tip'], { optional: true }),
  ],
  walletTopup: [amount('amount', { min: 10, max: 100000 })],
};

// SUBSCRIPTIONS
const subscription = {
  create: [
    intInRange('plan_id', { min: 1 }),
    intInRange('geofence_id', { min: 1, optional: true }),
    text('service_address', { min: 5, max: 500, optional: true }),
    lat('service_latitude', true), lng('service_longitude', true),
    intInRange('plant_count', { min: 1, max: 1000, optional: true }),
    intInRange('preferred_gardener_id', { min: 1, optional: true }),
    body('auto_renew').optional({ values: 'falsy' }).isBoolean().toBoolean(),
    amount('total_amount', { min: 1, optional: true }),
  ],
};

// CONTACT
const contact = {
  create: [
    name('name'),
    email(),
    phone('phone', true),
    text('message', { min: 5, max: 2000 }),
  ],
};

// REVIEWS / TIPS
const review = {
  create: [
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5').toInt(),
    text('comment', { max: 1000, optional: true }),
  ],
  tip: [amount('amount', { min: 10, max: 100000 })],
};

// ADDRESSES
const address = {
  create: [
    text('label', { max: 50, optional: true }),
    text('flat_no', { max: 10, optional: true }),
    text('building', { max: 255, optional: true }),
    text('area', { max: 500, optional: true }),
    text('landmark', { max: 255, optional: true }),
    text('city', { max: 100, optional: true }),
    text('state', { max: 100, optional: true }),
    pincode('pincode', true),
    lat('latitude', false), lng('longitude', false),
    body('is_default').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  ],
};

// ADMIN — generic
const admin = {
  supervisor: [
    name('name'), phone(), email(),
    text('password', { min: 6, max: 128, optional: true }),
  ],
  plan: [
    text('name', { min: 2, max: 100 }),
    text('slug', { max: 120, optional: true }),
    amount('price', { min: 0, max: 1000000 }),
    text('description', { max: 1000, optional: true }),
  ],
  addon: [
    text('name', { min: 2, max: 100 }),
    amount('price', { min: 0, max: 100000 }),
    intInRange('duration_mins', { min: 1, max: 1440, optional: true }),
    text('description', { max: 500, optional: true }),
  ],
  zone: [
    text('name', { min: 2, max: 100 }),
    text('city', { max: 100, optional: true }),
  ],
  blog: [
    text('title', { min: 4, max: 200 }),
    slug('slug'),
    text('content', { min: 10, max: 200000 }),
    text('excerpt', { max: 500, optional: true }),
    text('category', { max: 80, optional: true }),
    text('meta_title', { max: 70, optional: true }),
    text('meta_description', { max: 200, optional: true }),
    text('meta_keywords', { max: 300, optional: true }),
    body('is_published').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  ],
  reassignBooking: [intInRange('gardener_id', { min: 1 }), text('reason', { max: 500, optional: true })],
  broadcast: [
    text('title', { min: 2, max: 120 }),
    text('body', { min: 2, max: 1000 }),
    enumIn('type', ['info', 'success', 'warning', 'alert', 'promo'], { optional: true }),
    intInRange('geofence_id', { min: 1, optional: true }),
    enumIn('target_role', ['admin', 'customer', 'gardener', 'all', 'user'], { optional: true }),
  ],
  priceHike: [
    amount('percentage', { min: 0.01, max: 100 }),
    text('reason', { max: 500, optional: true }),
  ],
  setting: [text('value', { max: 10000, optional: true })],
};

module.exports = {
  // atoms (exported in case a route needs ad-hoc rules)
  phone, otp, email, name, pincode, gstin, amount, intInRange, text, enumIn,
  lat, lng, isoDate, idParam, url, slug, password,
  // grouped
  auth, booking, order, complaint, product, payment, subscription, contact, review, address, admin, coupon,
};
