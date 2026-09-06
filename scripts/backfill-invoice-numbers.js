// CLI wrapper around the shared renumbering engine (src/utils/renumberInvoices).
// Same behavior is available without shell access via:
//   GET /api/admin/maintenance/renumber-invoices?key=gharkamali[&apply=1]
//
// Usage:
//   node scripts/backfill-invoice-numbers.js           # DRY RUN
//   node scripts/backfill-invoice-numbers.js --apply   # write
require('dotenv').config();
const { renumberInvoices } = require('../src/utils/renumberInvoices');

(async () => {
  const apply = process.argv.includes('--apply');
  const r = await renumberInvoices({ apply });
  console.log('');
  console.log(`${r.applied ? 'APPLIED' : 'DRY RUN (pass --apply to write)'} — ${r.total} invoice numbers. Series:`, r.series);
  console.log('');
  for (const p of r.plan) {
    console.log(`${p.created_at.toISOString().slice(0, 10)}  ${p.channel}  ${p.entity_type.padEnd(12)} ${String(p.ref).padEnd(14)} ${(p.old_number || '(none)').padEnd(24)} -> ${p.invoice_number}`);
  }
  if (r.dropped.length) {
    console.log('');
    console.log('⚠ Numbers on cancelled/excluded entities (removed on apply):');
    r.dropped.forEach((d) => console.log(`   ${d.invoice_number} (${d.entity_type} ${d.entity_id})`));
  }
  process.exit(0);
})().catch((e) => { console.error('Failed (nothing partially written):', e); process.exit(1); });
