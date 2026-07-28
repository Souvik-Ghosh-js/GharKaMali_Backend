// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME BACKFILL — renumber all invoice numbers in booking/payment order.
//
// Why: numbers used to be minted at first PDF download, so the sequence
// followed download order, not booking order (e.g. a 21-June booking got a
// higher number than a 23-July one). Invoices now print the booking/payment
// date as the Invoice Date, so the series must be renumbered by that date to
// be sequential for GST.
//
// What it does (inside one transaction):
//   1. Collects every invoice-able entity (bookings, orders, subscriptions,
//      manual invoices), excluding cancelled/failed ones.
//   2. Sorts them by created_at (the booking/payment date) and assigns fresh
//      sequential numbers per financial year: GKM/26-27/000001, 000002, …
//   3. REPLACES the issued_invoices table contents and updates the
//      invoice_counters row(s) to match.
//
// Usage:
//   node scripts/backfill-invoice-numbers.js           # DRY RUN — prints plan only
//   node scripts/backfill-invoice-numbers.js --apply   # actually writes
//
// ⚠ Run this ONLY while GST returns containing the old numbers have NOT been
//   filed. Previously downloaded PDFs keep their old numbers on paper — after
//   applying, re-download and re-share those invoices.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const {
  sequelize, Booking, Order, Subscription, ManualInvoice, IssuedInvoice, InvoiceCounter,
} = require('../src/models');
const { financialYear, formatInvoiceNumber } = require('../src/config/invoice.config');

// Entities that never represent a real supply get no invoice number.
const SKIP_BOOKING_STATUS = ['cancelled', 'failed'];
const SKIP_ORDER_STATUS = ['cancelled', 'returned'];

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
  // Booking/payment date order; ties broken deterministically.
  entities.sort((a, b) =>
    a.created_at - b.created_at ||
    a.entity_type.localeCompare(b.entity_type) ||
    a.entity_id - b.entity_id);
  return entities;
}

async function main() {
  const apply = process.argv.includes('--apply');
  await sequelize.authenticate();

  // Old numbers, for the audit mapping.
  const oldRows = await IssuedInvoice.findAll();
  const oldByKey = new Map(oldRows.map((r) => [`${r.entity_type}:${r.entity_id}`, r.invoice_number]));

  const entities = await collectEntities();

  // Assign fresh sequences per financial year of the booking/payment date.
  const seqByFy = {};
  const plan = entities.map((e) => {
    const fy = financialYear(e.created_at);
    seqByFy[fy] = (seqByFy[fy] || 0) + 1;
    const seq = seqByFy[fy];
    return {
      ...e, financial_year: fy, seq,
      invoice_number: formatInvoiceNumber(seq, e.created_at),
      old_number: oldByKey.get(`${e.entity_type}:${e.entity_id}`) || null,
    };
  });

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (pass --apply to write)'} — ${plan.length} invoice numbers, FY totals:`, seqByFy, '\n');
  console.log('date        | type         | ref            | old number        -> new number');
  console.log('------------+--------------+----------------+--------------------------------------');
  for (const p of plan) {
    const d = p.created_at.toISOString().slice(0, 10);
    console.log(`${d}  | ${p.entity_type.padEnd(12)} | ${String(p.ref).padEnd(14)} | ${(p.old_number || '(none)').padEnd(17)} -> ${p.invoice_number}`);
  }

  // Old numbers that vanish (their entity is cancelled/excluded) — flag them.
  const newKeys = new Set(plan.map((p) => `${p.entity_type}:${p.entity_id}`));
  const dropped = oldRows.filter((r) => !newKeys.has(`${r.entity_type}:${r.entity_id}`));
  if (dropped.length) {
    console.log('\n⚠ These previously issued numbers belong to cancelled/excluded entities and will be removed:');
    dropped.forEach((r) => console.log(`   ${r.invoice_number} (${r.entity_type} ${r.entity_id})`));
  }

  if (!apply) { console.log('\nDry run complete — nothing written.'); process.exit(0); }

  await sequelize.transaction(async (t) => {
    await IssuedInvoice.destroy({ where: {}, transaction: t });
    await IssuedInvoice.bulkCreate(plan.map((p) => ({
      entity_type: p.entity_type, entity_id: p.entity_id,
      invoice_number: p.invoice_number, financial_year: p.financial_year, seq: p.seq,
      // Keep the issue timestamp aligned with the booking/payment date.
      createdAt: p.created_at, updatedAt: p.created_at,
    })), { transaction: t });

    for (const [fy, last] of Object.entries(seqByFy)) {
      const [counter] = await InvoiceCounter.findOrCreate({
        where: { financial_year: fy }, defaults: { last_seq: 0 }, transaction: t,
      });
      await counter.update({ last_seq: last }, { transaction: t });
    }
  });

  console.log(`\n✅ Backfill applied — ${plan.length} numbers written, counters updated.`);
  console.log('   Re-download any invoices you had already shared; their numbers changed.');
  process.exit(0);
}

main().catch((e) => { console.error('\nBackfill failed (nothing partially written):', e); process.exit(1); });
