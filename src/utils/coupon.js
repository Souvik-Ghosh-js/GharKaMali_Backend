// Shared coupon validation + discount computation.
// Used by the public /coupons/validate route and the order / booking /
// subscription controllers so the price the customer is quoted always matches
// what the server charges.

const { Coupon } = require('../models');

/**
 * Validate a coupon code against a cart subtotal and compute the discount.
 *
 * @param {string} code        Coupon code (case-insensitive).
 * @param {number} subtotal    Pre-GST amount the coupon applies to, in rupees
 *                             (cart subtotal, or the service's base + add-ons).
 * @param {string} scope       What is being purchased: 'products' (shop cart),
 *                             'subscription' (monthly plan) or 'booking'
 *                             (one-time visit). Defaults to 'products'.
 * @returns {Promise<{ ok: boolean, reason?: string, discount: number, coupon: object|null }>}
 */
const SCOPES = ['products', 'subscription', 'booking'];
const SCOPE_LABEL = { products: 'shop products', subscription: 'monthly plans', booking: 'one-time visits' };

async function validateCoupon(code, subtotal, scope = 'products') {
  const fail = (reason) => ({ ok: false, reason, discount: 0, coupon: null });

  if (!code || typeof code !== 'string') return fail('Enter a coupon code');
  const normalized = code.trim().toUpperCase();
  if (!normalized) return fail('Enter a coupon code');

  const coupon = await Coupon.findOne({ where: { code: normalized } });
  if (!coupon) return fail('Invalid coupon code');
  if (!coupon.is_active) return fail('This coupon is no longer active');

  const now = new Date();
  if (coupon.valid_from && now < new Date(coupon.valid_from)) return fail('This coupon is not active yet');
  if (coupon.valid_to && now > new Date(coupon.valid_to)) return fail('This coupon has expired');

  // Scope check: a coupon applies to everything ('all') or to exactly one of
  // products / subscription / booking.
  const wanted = SCOPES.includes(scope) ? scope : 'products';
  const appliesTo = coupon.applies_to || 'all';
  if (appliesTo !== 'all' && appliesTo !== wanted) {
    return fail(`This coupon is valid only for ${SCOPE_LABEL[appliesTo] || appliesTo}`);
  }

  if (coupon.usage_limit != null && coupon.usage_count >= coupon.usage_limit) {
    return fail('This coupon has reached its usage limit');
  }

  const sub = Number(subtotal) || 0;
  const minOrder = Number(coupon.min_order_amount) || 0;
  if (minOrder > 0 && sub < minOrder) {
    return fail(`Add ₹${(minOrder - sub).toFixed(0)} more to use this coupon (min order ₹${minOrder.toFixed(0)})`);
  }

  const discount = computeDiscount(coupon, sub);
  if (discount <= 0) return fail('This coupon does not apply to your cart');

  return { ok: true, discount, coupon };
}

/**
 * Compute the rupee discount for a coupon against a subtotal.
 * Never returns more than the subtotal itself.
 */
function computeDiscount(coupon, subtotal) {
  const sub = Number(subtotal) || 0;
  const value = Number(coupon.discount_value) || 0;
  let discount;
  if (coupon.discount_type === 'percentage') {
    discount = (sub * value) / 100;
    const cap = coupon.max_discount != null ? Number(coupon.max_discount) : null;
    if (cap != null && cap > 0) discount = Math.min(discount, cap);
  } else {
    discount = value; // fixed rupee amount
  }
  discount = Math.min(discount, sub); // never discount more than the cart
  return Math.round(discount * 100) / 100;
}

module.exports = { validateCoupon, computeDiscount, SCOPES };
