// ─────────────────────────────────────────────────────────────────────────────
// Financial-year sequential invoice numbering (GST-compliant).
//
// Rules this enforces:
//   • Stable   — an entity keeps the SAME invoice number forever. Re-downloading
//                a PDF must never mint a new number.
//   • Sequential per financial year — GKM/25-26/000001, 000002, …
//   • Concurrency-safe — the counter row is locked FOR UPDATE while incrementing,
//                so two simultaneous downloads can't claim the same sequence.
// ─────────────────────────────────────────────────────────────────────────────
const { InvoiceCounter, IssuedInvoice, sequelize } = require('../models');
const { financialYear, formatInvoiceNumber } = require('../config/invoice.config');

/**
 * Get (or mint) the invoice number for an entity.
 * @param {'booking'|'subscription'|'order'|'manual'} entityType
 * @param {number} entityId
 * @param {Date} [issuedAt] date that decides the financial year (default: now)
 * @returns {Promise<string>} e.g. "GKM/25-26/000123"
 */
async function getOrCreateInvoiceNumber(entityType, entityId, issuedAt = new Date()) {
  // Fast path — already issued.
  const existing = await IssuedInvoice.findOne({ where: { entity_type: entityType, entity_id: entityId } });
  if (existing) return existing.invoice_number;

  const fy = financialYear(issuedAt);

  try {
    return await sequelize.transaction(async (t) => {
      // Re-check inside the transaction (another request may have just issued it).
      const again = await IssuedInvoice.findOne({
        where: { entity_type: entityType, entity_id: entityId }, transaction: t,
      });
      if (again) return again.invoice_number;

      // Lock (or create) this financial year's counter row.
      let counter = await InvoiceCounter.findOne({
        where: { financial_year: fy }, transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!counter) {
        counter = await InvoiceCounter.create({ financial_year: fy, last_seq: 0 }, { transaction: t });
      }

      const seq = counter.last_seq + 1;
      await counter.update({ last_seq: seq }, { transaction: t });

      const invoice_number = formatInvoiceNumber(seq, issuedAt);
      await IssuedInvoice.create({
        entity_type: entityType, entity_id: entityId, invoice_number, financial_year: fy, seq,
      }, { transaction: t });

      return invoice_number;
    });
  } catch (err) {
    // A unique-constraint race means someone else issued it — read theirs.
    const fallback = await IssuedInvoice.findOne({ where: { entity_type: entityType, entity_id: entityId } });
    if (fallback) return fallback.invoice_number;
    throw err;
  }
}

module.exports = { getOrCreateInvoiceNumber };
