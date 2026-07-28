// ─────────────────────────────────────────────────────────────────────────────
// Financial-year sequential invoice numbering (GST-compliant).
//
// Rules this enforces:
//   • Stable   — an entity keeps the SAME invoice number AND issue date forever.
//                Re-downloading a PDF must never mint a new number.
//   • Sequential per financial year — GKM/25-26/000001, 000002, …
//   • Numbered at CREATION — afterCreate hooks (registered below) mint the
//                number as soon as a booking/order/subscription/manual invoice
//                is created, so numbers follow booking order and match the
//                invoice date (the date the customer booked/paid). Download-time
//                minting remains only as a fallback for pre-existing records.
//   • Concurrency-safe — the counter row is locked FOR UPDATE while incrementing,
//                so two simultaneous requests can't claim the same sequence.
// ─────────────────────────────────────────────────────────────────────────────
const {
  InvoiceCounter, IssuedInvoice, Booking, Order, Subscription, ManualInvoice, sequelize,
} = require('../models');
const { financialYear, formatInvoiceNumber } = require('../config/invoice.config');

const issuedAtOf = (row) => row.createdAt || row.created_at || new Date();

/**
 * Get (or mint) the invoice number + issue date for an entity.
 * The financial year and issue date are decided at MINT time (first download),
 * never re-derived later — both are frozen in the issued_invoices row.
 * @param {'booking'|'subscription'|'order'|'manual'} entityType
 * @param {number} entityId
 * @returns {Promise<{number: string, issuedAt: Date}>}
 */
async function getOrCreateInvoiceIssue(entityType, entityId) {
  // Fast path — already issued.
  const existing = await IssuedInvoice.findOne({ where: { entity_type: entityType, entity_id: entityId } });
  if (existing) return { number: existing.invoice_number, issuedAt: issuedAtOf(existing) };

  const now = new Date();
  const fy = financialYear(now);

  try {
    return await sequelize.transaction(async (t) => {
      // Re-check inside the transaction (another request may have just issued it).
      const again = await IssuedInvoice.findOne({
        where: { entity_type: entityType, entity_id: entityId }, transaction: t,
      });
      if (again) return { number: again.invoice_number, issuedAt: issuedAtOf(again) };

      // Lock (or create) this financial year's counter row. Deterministic order
      // guards against duplicate counter rows on a live table missing the
      // unique(financial_year) constraint.
      let counter = await InvoiceCounter.findOne({
        where: { financial_year: fy }, order: [['id', 'ASC']],
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!counter) {
        counter = await InvoiceCounter.create({ financial_year: fy, last_seq: 0 }, { transaction: t });
      }

      // Self-heal: the issued-invoice history is the authority, not the counter.
      // If the counter row was ever lost/reset (fresh table, restored DB, second
      // environment), resume AFTER the highest sequence already issued this FY —
      // sequences must never go backwards or collide.
      const maxIssued = await IssuedInvoice.max('seq', {
        where: { financial_year: fy }, transaction: t,
      });
      const seq = Math.max(Number(counter.last_seq) || 0, Number(maxIssued) || 0) + 1;
      await counter.update({ last_seq: seq }, { transaction: t });

      const invoice_number = formatInvoiceNumber(seq, now);
      const issued = await IssuedInvoice.create({
        entity_type: entityType, entity_id: entityId, invoice_number, financial_year: fy, seq,
      }, { transaction: t });

      return { number: invoice_number, issuedAt: issuedAtOf(issued) };
    });
  } catch (err) {
    // A unique-constraint race means someone else issued it — read theirs.
    const fallback = await IssuedInvoice.findOne({ where: { entity_type: entityType, entity_id: entityId } });
    if (fallback) return { number: fallback.invoice_number, issuedAt: issuedAtOf(fallback) };
    throw err;
  }
}

/** Back-compat wrapper — returns just the number string. */
async function getOrCreateInvoiceNumber(entityType, entityId) {
  const issue = await getOrCreateInvoiceIssue(entityType, entityId);
  return issue.number;
}

// ── Mint at creation ─────────────────────────────────────────────────────────
// Every invoice-able entity gets its number the moment it is created, so the
// number series follows booking/payment order. Runs AFTER COMMIT (a rolled-back
// booking must never consume a sequence number) and is best-effort: a minting
// hiccup must never fail the booking itself — the download path re-mints.
const mint = (entityType, id) => {
  getOrCreateInvoiceIssue(entityType, id).catch((e) =>
    console.error(`[invoiceNumber] mint on create failed (${entityType} ${id}):`, e.message));
};
for (const [Model, entityType] of [
  [Booking, 'booking'], [Order, 'order'], [Subscription, 'subscription'], [ManualInvoice, 'manual'],
]) {
  Model.afterCreate((row, options) => {
    if (options && options.transaction) options.transaction.afterCommit(() => mint(entityType, row.id));
    else mint(entityType, row.id);
  });
}

module.exports = { getOrCreateInvoiceIssue, getOrCreateInvoiceNumber };
