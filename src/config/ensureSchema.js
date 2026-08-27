// ─────────────────────────────────────────────────────────────────────────────
// Startup schema guard — applies small, idempotent ALTERs that new model
// attributes depend on. Plain sequelize.sync() only CREATES missing tables; it
// never adds columns to existing ones, so a deploy that adds a model attribute
// breaks every query on that model ("Unknown column 'Booking.coupon_code'")
// until someone remembers to hit /admin/maintenance/sync-db. Running this at
// boot removes that manual step. Every statement is safe to re-run:
// "Duplicate column" is expected on subsequent boots and stays silent; any
// other failure is logged loudly but never blocks startup.
// ─────────────────────────────────────────────────────────────────────────────
const STATEMENTS = [
  // Shop order line items remember the GST rate they were charged at.
  "ALTER TABLE order_items ADD COLUMN gst_rate INT NULL",
  // Admin manual invoices for shop-product sales.
  "ALTER TABLE manual_invoices MODIFY COLUMN invoice_type ENUM('ondemand','plan','products') DEFAULT 'ondemand'",
  // Coupon scoping + coupons on service bookings / subscriptions.
  "ALTER TABLE coupons ADD COLUMN applies_to ENUM('all','products','subscription','booking') NOT NULL DEFAULT 'all'",
  "ALTER TABLE bookings ADD COLUMN coupon_code VARCHAR(40) NULL",
  "ALTER TABLE bookings ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
  "ALTER TABLE subscriptions ADD COLUMN coupon_code VARCHAR(40) NULL",
  "ALTER TABLE subscriptions ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
  // Manual invoices: admin chooses Paid / Unpaid on the Create Invoice form.
  "ALTER TABLE manual_invoices ADD COLUMN payment_status ENUM('paid','pending') NOT NULL DEFAULT 'paid'",
  // Field-service MVP: geo-verified gardener check-in/out on a visit.
  "ALTER TABLE bookings ADD COLUMN checkin_latitude DECIMAL(10,8) NULL",
  "ALTER TABLE bookings ADD COLUMN checkin_longitude DECIMAL(11,8) NULL",
  "ALTER TABLE bookings ADD COLUMN checkout_latitude DECIMAL(10,8) NULL",
  "ALTER TABLE bookings ADD COLUMN checkout_longitude DECIMAL(11,8) NULL",
  "ALTER TABLE bookings ADD COLUMN checkin_distance_m INT NULL",
];

const IGNORABLE = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_CANT_DROP_FIELD_OR_KEY']);

async function ensureSchema(sequelize) {
  let applied = 0;
  for (const sql of STATEMENTS) {
    try {
      await sequelize.query(sql);
      applied++;
    } catch (e) {
      const code = e?.original?.code || e?.parent?.code || e?.code;
      if (IGNORABLE.has(code)) continue; // already applied on a previous boot
      console.error('⚠️  ensureSchema FAILED:', sql, '->', e.message);
    }
  }
  if (applied) console.log(`✅ ensureSchema: applied ${applied} schema statement(s)`);
}

module.exports = { ensureSchema, STATEMENTS };
