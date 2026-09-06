// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME MIGRATION — renumber ALL invoices into the two-channel GST series:
//   GKM/ONL/<fy>/000001…  online (automatic): bookings, subscriptions, orders
//   GKM/OFF/<fy>/000001…  offline (manual invoices from the admin panel)
// Each series is independently sequential per financial year, ordered by the
// date the customer booked/paid (created_at).
//
// What it does (inside one transaction):
//   1. Collects every invoice-able entity (excluding cancelled/failed ones).
//   2. Splits them into ONL (booking/subscription/order) and OFF (manual).
//   3. Assigns fresh per-channel sequences and REPLACES issued_invoices,
//      then updates invoice_counters (one row per FY per channel).
//
// Usage:
//   node scripts/backfill-invoice-numbers.js           # DRY RUN — prints plan only
//   node scripts/backfill-invoice-numbers.js --apply   # actually writes
//
// ⚠ Run ONLY while GST returns containing the old numbers have NOT been filed.
//   Re-download and re-share any PDFs that were already sent out — numbers change.
// ⚠ Requires the schema to be current (deploy the backend first; ensureSchema
//   adds the `channel` columns at boot).
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const {
  sequelize, Booking, Order, Subscription, ManualInvoice, IssuedInvoice, InvoiceCounter,
} = require('../src/models');
const { financialYear, formatInvoiceNumber } = require('../src/config/invoice.config');

const SKIP_BOOKING_STATUS = ['cancelled', 'failed'];
const SKIP_ORDER_STATUS = ['cancelled', 'returned'];
const channelFor = (entityType) => (entityType === 'manual' ? 'OFF' : 'ONL');

const createdAtOf = (e) => new Date(e.createdAt || e.created_at);

async function collectEntities() {
  const { Op } = require('sequelize');
  const [bookings, orders, subscriptions, manuals] = await Promise.all([
    Booking.findAll({ where: { status: { [Op.notIn]: SKIP_BOOKING_STATUS } } }),
    Order.findAll({ where: { status: { [Op.notIn]: SKIP_ORDER_STATUS } } }),
    Subscription.findAll(),
    ManualInvoice.findAll(),
  ]);
  const entities = [
    ...bookings.map((e) => ({ entity_type: 'booking', entity_id: e.id, created_at: createdAtOf(e), ref: e.booking_number || `BKG-${e.id}` })),
    ...orders.map((e) => ({ entity_type: 'order', entity_id: e.id, created_at: createdAtOf(e), ref: e.order_number || `ORD-${e.id}` })),
    ...subscriptions.map((e) => ({ entity_type: 'subscription', entity_id: e.id, created_at: createdAtOf(e), ref: `SUB-${e.id}` })),
    ...manuals.map((e) => ({ entity_type: 'manual', entity_id: e.id, created_at: createdAtOf(e), ref: e.invoice_number })),
  ];
  entities.sort((a, b) =>
    a.created_at - b.created_at ||
    a.entity_type.localeCompare(b.entity_type) ||
    a.entity_id - b.entity_id);
  return entities;
}

async function main() {
  const apply = process.argv.includes('--apply');
  await sequelize.authenticate();

  const oldRows = await IssuedInvoice.findAll();
  const oldByKey = new Map(oldRows.map((r) => [`${r.entity_type}:${r.entity_id}`, r.invoice_number]));

  const entities = await collectEntities();

  // Fresh sequences per (financial year, channel).
  const seqBy = {}; // `${fy}|${channel}` -> last seq
  const plan = entities.map((e) => {
    const fy = financialYear(e.created_at);
    const channel = channelFor(e.entity_type);
    const key = `${fy}|${channel}`;
    seqBy[key] = (seqBy[key] || 0) + 1;
    const seq = seqBy[key];
    return {
      ...e, financial_year: fy, channel, seq,
      invoice_number: formatInvoiceNumber(seq, e.created_at, channel),
      old_number: oldByKey.get(`${e.entity_type}:${e.entity_id}`) || null,
    };
  });

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (pass --apply to write)'} — ${plan.length} invoice numbers. Series totals:`, seqBy, '\n');
  console.log('date        | channel | type         | ref            | old number              -> new number');
  console.log('------------+---------+--------------+----------------+--------------------------------------------');
  for (const p of plan) {
    const d = p.created_at.toISOString().slice(0, 10);
    console.log(`${d}  | ${p.channel}     | ${p.entity_type.padEnd(12)} | ${String(p.ref).padEnd(14)} | ${(p.old_number || '(none)').padEnd(23)} -> ${p.invoice_number}`);
  }

  const newKeys = new Set(plan.map((p) => `${p.entity_type}:${p.entity_id}`));
  const dropped = oldRows.filter((r) => !newKeys.has(`${r.entity_type}:${r.entity_id}`));
  if (dropped.length) {
    console.log('\n⚠ Previously issued numbers on cancelled/excluded entities (will be removed):');
    dropped.forEach((r) => console.log(`   ${r.invoice_number} (${r.entity_type} ${r.entity_id})`));
  }

  if (!apply) { console.log('\nDry run complete — nothing written.'); process.exit(0); }

  await sequelize.transaction(async (t) => {
    await IssuedInvoice.destroy({ where: {}, transaction: t });
    await IssuedInvoice.bulkCreate(plan.map((p) => ({
      entity_type: p.entity_type, entity_id: p.entity_id,
      invoice_number: p.invoice_number, financial_year: p.financial_year,
      channel: p.channel, seq: p.seq,
      createdAt: p.created_at, updatedAt: p.created_at,
    })), { transaction: t });

    // One counter per FY per channel; zero out any stale counters not in the plan.
    await InvoiceCounter.destroy({ where: {}, transaction: t });
    for (const [key, last] of Object.entries(seqBy)) {
      const [fy, channel] = key.split('|');
      await InvoiceCounter.create({ financial_year: fy, channel, last_seq: last }, { transaction: t });
    }
  });

  console.log(`\n✅ Migration applied — ${plan.length} numbers written across ${Object.keys(seqBy).length} series.`);
  console.log('   Re-download any invoices you had already shared; their numbers changed.');
  process.exit(0);
}

main().catch((e) => { console.error('\nMigration failed (nothing partially written):', e); process.exit(1); });
