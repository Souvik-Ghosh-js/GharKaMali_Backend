// ─────────────────────────────────────────────────────────────────────────────
// Shared invoice renumbering engine — used by scripts/backfill-invoice-numbers.js
// (CLI) and the /admin/maintenance/renumber-invoices route (for when there is
// no shell access to the server). Renumbers every invoice into the two-channel
// series (ONL = automatic, OFF = manual), each consecutive per financial year,
// ordered by booking/payment date. apply=false → plan only, nothing written.
// ─────────────────────────────────────────────────────────────────────────────
const { Op } = require('sequelize');
const {
  sequelize, Booking, Order, Subscription, ManualInvoice, IssuedInvoice, InvoiceCounter,
} = require('../models');
const { financialYear, formatInvoiceNumber } = require('../config/invoice.config');

const SKIP_BOOKING_STATUS = ['cancelled', 'failed'];
const SKIP_ORDER_STATUS = ['cancelled', 'returned'];
const channelFor = (entityType) => (entityType === 'manual' ? 'OFF' : 'ONL');
const createdAtOf = (e) => new Date(e.createdAt || e.created_at);

async function buildPlan() {
  const [bookings, orders, subscriptions, manuals, oldRows] = await Promise.all([
    Booking.findAll({ where: { status: { [Op.notIn]: SKIP_BOOKING_STATUS } } }),
    Order.findAll({ where: { status: { [Op.notIn]: SKIP_ORDER_STATUS } } }),
    Subscription.findAll(),
    ManualInvoice.findAll(),
    IssuedInvoice.findAll(),
  ]);
  const oldByKey = new Map(oldRows.map((r) => [`${r.entity_type}:${r.entity_id}`, r.invoice_number]));

  const entities = [
    ...bookings.map((e) => ({ entity_type: 'booking', entity_id: e.id, created_at: createdAtOf(e), ref: e.booking_number || `BKG-${e.id}` })),
    ...orders.map((e) => ({ entity_type: 'order', entity_id: e.id, created_at: createdAtOf(e), ref: e.order_number || `ORD-${e.id}` })),
    ...subscriptions.map((e) => ({ entity_type: 'subscription', entity_id: e.id, created_at: createdAtOf(e), ref: `SUB-${e.id}` })),
    ...manuals.map((e) => ({ entity_type: 'manual', entity_id: e.id, created_at: createdAtOf(e), ref: e.invoice_number })),
  ].sort((a, b) =>
    a.created_at - b.created_at ||
    a.entity_type.localeCompare(b.entity_type) ||
    a.entity_id - b.entity_id);

  const seqBy = {}; // `${fy}|${channel}` -> last seq
  const plan = entities.map((e) => {
    const fy = financialYear(e.created_at);
    const channel = channelFor(e.entity_type);
    const key = `${fy}|${channel}`;
    seqBy[key] = (seqBy[key] || 0) + 1;
    return {
      ...e, financial_year: fy, channel, seq: seqBy[key],
      invoice_number: formatInvoiceNumber(seqBy[key], e.created_at, channel),
      old_number: oldByKey.get(`${e.entity_type}:${e.entity_id}`) || null,
    };
  });

  const newKeys = new Set(plan.map((p) => `${p.entity_type}:${p.entity_id}`));
  const dropped = oldRows
    .filter((r) => !newKeys.has(`${r.entity_type}:${r.entity_id}`))
    .map((r) => ({ entity_type: r.entity_type, entity_id: r.entity_id, invoice_number: r.invoice_number }));

  return { plan, seqBy, dropped };
}

async function renumberInvoices({ apply = false } = {}) {
  const { plan, seqBy, dropped } = await buildPlan();

  if (apply) {
    await sequelize.transaction(async (t) => {
      await IssuedInvoice.destroy({ where: {}, transaction: t });
      await IssuedInvoice.bulkCreate(plan.map((p) => ({
        entity_type: p.entity_type, entity_id: p.entity_id,
        invoice_number: p.invoice_number, financial_year: p.financial_year,
        channel: p.channel, seq: p.seq,
        createdAt: p.created_at, updatedAt: p.created_at,
      })), { transaction: t });
      await InvoiceCounter.destroy({ where: {}, transaction: t });
      for (const [key, last] of Object.entries(seqBy)) {
        const [fy, channel] = key.split('|');
        await InvoiceCounter.create({ financial_year: fy, channel, last_seq: last }, { transaction: t });
      }
    });
  }

  return { applied: !!apply, total: plan.length, series: seqBy, dropped, plan };
}

module.exports = { renumberInvoices };
