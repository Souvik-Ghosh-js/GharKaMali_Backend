// ─────────────────────────────────────────────────────────────────────────────
// Role-based access control for the admin panel — implements the
// "Admin Role & Permission Management" requirement doc (Nov 2026).
//
// Staff roles:
//   admin       → Super Admin. Always allowed everything; only role that can
//                 manage users, permissions, system settings and audit logs.
//   supervisor  → Operations. Governed by the per-route authorize() lists that
//                 already exist (zone/gardener scoping included) — the RBAC
//                 guard does not restrict supervisors further, so nothing
//                 operational regresses.
//   accounts / sales / business → new panel roles. DEFAULT-DENY: they can only
//                 reach a module the matrix (or their per-user override)
//                 grants. Baselines below mirror the requirement doc's matrix.
//
// Permissions are module × action. Actions kept deliberately coarse:
//   view   → GET requests in the module
//   manage → create/edit/approve/delete (any non-GET request)
//   export → CSV/PDF/report downloads (routes marked as exports)
// The Super Admin edits the matrix in Admin → Team & Roles; it is stored in
// SystemSetting 'rbac_config' and per-user overrides in users.permissions
// ({ "module:action": true|false }). Backend enforcement is authoritative —
// the dashboard only *also* hides what a role cannot use.
//
// Every non-GET /admin request (and export GETs) by any panel user, admin
// included, is written to audit_logs with a sanitized body snapshot.
// ─────────────────────────────────────────────────────────────────────────────
const { SystemSetting } = require('../models');

const SETTING_KEY = 'rbac_config';
const PANEL_ROLES = ['accounts', 'sales', 'business'];           // RBAC-enforced
const STAFF_ROLES = ['admin', 'supervisor', ...PANEL_ROLES];     // can open the panel
// Hard rule from the doc: role administration, system settings and audit logs
// are Super Admin territory no matter what the editable matrix says.
const ADMIN_ONLY_MODULES = ['users', 'settings', 'audit'];

const ACTIONS = ['view', 'manage', 'export'];

// Module catalog: label for the editor + which /admin/<prefix> paths it owns.
const MODULES = [
  { key: 'dashboard',     label: 'Dashboard & Search',        prefixes: ['dashboard', 'search'] },
  { key: 'analytics',     label: 'Analytics & Reports',       prefixes: ['analytics', 'reports', 'utilization'] },
  { key: 'leads',         label: 'Leads',                     prefixes: ['leads'] },
  { key: 'bookings',      label: 'Bookings',                  prefixes: ['bookings'] },
  { key: 'operations',    label: 'Field Ops & Attendance',    prefixes: ['visits', 'operations-status', 'checklist-templates', 'escalations', 'attendance', 'leaves'] },
  { key: 'subscriptions', label: 'Subscriptions',             prefixes: ['subscriptions'] },
  { key: 'customers',     label: 'Customers & Plant History', prefixes: ['customers', 'plants'] },
  { key: 'staff',         label: 'Gardeners & Supervisors',   prefixes: ['gardeners', 'supervisors'] },
  { key: 'payouts',       label: 'Payouts, Tips & Rewards',   prefixes: ['payouts', 'withdrawals', 'rewards', 'tips'] },
  { key: 'payments',      label: 'Payments & Transactions',   prefixes: ['payments'] },
  { key: 'invoices',      label: 'Invoices',                  prefixes: ['manual-invoice', 'manual-invoices'] },
  { key: 'wallet',        label: 'Wallet & Cashback',         prefixes: ['wallet'] },
  { key: 'shop',          label: 'Shop',                      prefixes: ['shop', 'product-zone-prices'] },
  { key: 'pricing',       label: 'Pricing, Plans & Zones',    prefixes: ['plans', 'addons', 'pricing', 'surcharges', 'price-hike', 'zones', 'geofence', 'blocked-dates', 'coupons'] },
  { key: 'marketing',     label: 'Content & Marketing',       prefixes: ['blogs', 'cities', 'faqs', 'taglines', 'tags', 'contacts', 'notifications', 'reviews'] },
  { key: 'support',       label: 'Complaints & SLA',          prefixes: ['complaints', 'sla'] },
  { key: 'settings',      label: 'System Settings',           prefixes: ['settings', 'maintenance'] },
  { key: 'users',         label: 'Team, Roles & Permissions', prefixes: ['panel-users', 'rbac'] },
  { key: 'audit',         label: 'Audit Logs',                prefixes: ['audit-logs'] },
];

const PREFIX_TO_MODULE = (() => {
  const m = {};
  for (const mod of MODULES) for (const p of mod.prefixes) m[p] = mod.key;
  return m;
})();

// ── Baseline matrix (requirement doc §2, least-privilege defaults) ──────────
// The Super Admin can grant/restrict any of this from the panel.
const DEFAULT_MATRIX = {
  accounts: {
    dashboard: ['view'], analytics: ['view', 'export'],
    payments: ['view', 'manage', 'export'], invoices: ['view', 'manage', 'export'],
    wallet: ['view'], payouts: ['view'],
    // export on bookings/subscriptions/shop = their tax-invoice PDF downloads
    bookings: ['view', 'export'], subscriptions: ['view', 'export'], customers: ['view'],
    shop: ['view', 'export'], pricing: ['view'],
  },
  sales: {
    dashboard: ['view'], analytics: ['view'],
    leads: ['view', 'manage'], bookings: ['view', 'manage'],
    customers: ['view', 'manage'], subscriptions: ['view'],
    payments: ['view'], shop: ['view'], pricing: ['view'],
  },
  business: {
    dashboard: ['view'], analytics: ['view', 'export'],
    leads: ['view'], bookings: ['view'], operations: ['view'],
    subscriptions: ['view'], customers: ['view'], staff: ['view'],
    payments: ['view'], invoices: ['view'], wallet: ['view'],
    shop: ['view'], pricing: ['view'], marketing: ['view'], support: ['view'],
  },
};

// ── Config (SystemSetting, 30s cache) ───────────────────────────────────────
let cache = null, cacheAt = 0;
const CACHE_MS = 30 * 1000;

function sanitizeMatrix(input) {
  const out = {};
  for (const role of PANEL_ROLES) {
    const src = (input && input[role]) || {};
    out[role] = {};
    for (const mod of MODULES) {
      if (ADMIN_ONLY_MODULES.includes(mod.key)) continue; // never grantable
      const acts = Array.isArray(src[mod.key]) ? src[mod.key].filter((a) => ACTIONS.includes(a)) : [];
      if (acts.length) out[role][mod.key] = [...new Set(acts)];
    }
  }
  return out;
}

async function getMatrix() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const row = await SystemSetting.findOne({ where: { key: SETTING_KEY } });
    cache = row && row.value ? sanitizeMatrix(JSON.parse(row.value)) : sanitizeMatrix(DEFAULT_MATRIX);
  } catch (e) {
    console.error('[rbac] config read failed:', e.message);
    cache = cache || sanitizeMatrix(DEFAULT_MATRIX);
  }
  cacheAt = Date.now();
  return cache;
}

async function saveMatrix(matrix) {
  const value = sanitizeMatrix(matrix);
  const json = JSON.stringify(value);
  const [row, created] = await SystemSetting.findOrCreate({ where: { key: SETTING_KEY }, defaults: { value: json } });
  if (!created) await row.update({ value: json });
  cache = value; cacheAt = Date.now();
  return value;
}

// ── Permission check ─────────────────────────────────────────────────────────
function parseOverrides(user) {
  const v = user && user.permissions;
  if (!v) return {};
  if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return v;
}

// Effective check. `matrix` comes from getMatrix(); manage implies view.
function can(user, module, action, matrix) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ADMIN_ONLY_MODULES.includes(module)) return false;
  if (user.role === 'supervisor') return true; // governed by per-route authorize()
  if (!PANEL_ROLES.includes(user.role)) return false;
  const o = parseOverrides(user);
  const key = `${module}:${action}`;
  if (o[key] === false) return false;
  if (o[key] === true) return true;
  if (action === 'view' && (o[`${module}:manage`] === true)) return true;
  const acts = (matrix[user.role] && matrix[user.role][module]) || [];
  if (acts.includes(action)) return true;
  if (action === 'view' && acts.includes('manage')) return true;
  return false;
}

// Full effective module→actions map for one user (drives the dashboard UI).
async function effectivePermissions(user) {
  const matrix = await getMatrix();
  const out = {};
  for (const mod of MODULES) {
    const acts = ACTIONS.filter((a) => can(user, mod.key, a, matrix));
    if (acts.length) out[mod.key] = acts;
  }
  return out;
}

// ── Request guard + audit (mounted on /admin before the routes) ─────────────
const moduleForPath = (path) => {
  const seg = String(path || '').replace(/^\/+/, '').split('/')[0];
  return PREFIX_TO_MODULE[seg] || null;
};

// GET routes that are really exports/downloads (checked by suffix).
const isExportPath = (path) => /\/(invoice|export|download|report)s?(\/|\?|$)/.test(String(path || ''));

const SENSITIVE_BODY_KEYS = /pass(word)?|otp|token|secret/i;
function sanitizedBody(body) {
  try {
    const clone = {};
    for (const [k, v] of Object.entries(body || {})) {
      clone[k] = SENSITIVE_BODY_KEYS.test(k) ? '[redacted]' : v;
    }
    const s = JSON.stringify(clone);
    return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
  } catch { return null; }
}

function logAudit({ user, method, path, module, action, body, ip }) {
  // Fire-and-forget: auditing must never block or fail the request.
  setImmediate(async () => {
    try {
      const { AuditLog } = require('../models');
      await AuditLog.create({
        actor_id: user ? user.id : null,
        actor_name: user ? user.name : null,
        actor_role: user ? user.role : null,
        method, path: String(path).slice(0, 500),
        module, action,
        body: body || null,
        ip: String(ip || '').slice(0, 64) || null,
      });
    } catch (e) { console.error('[rbac] audit write failed:', e.message); }
  });
}

// Express middleware. Runs AFTER authenticate (mounted together in routes).
async function guard(req, res, next) {
  try {
    const user = req.user;
    if (!user || !STAFF_ROLES.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    // Everyone on the panel may read their own permissions — it drives the UI.
    if (req.method === 'GET' && req.path.replace(/^\/+|\/+$/g, '') === 'rbac/me') return next();

    const module = moduleForPath(req.path);
    const action = req.method === 'GET'
      ? (isExportPath(req.path) ? 'export' : 'view')
      : 'manage';

    // admin + supervisor: no RBAC restriction (per-route authorize applies),
    // but their changes are still audited like everyone else's.
    if (PANEL_ROLES.includes(user.role)) {
      const matrix = await getMatrix();
      if (!module || !can(user, module, action, matrix)) {
        return res.status(403).json({
          success: false,
          code: 'NO_PERMISSION',
          message: `Your role does not have ${action} access to this section. Ask the Super Admin to grant it in Team & Roles.`,
        });
      }
      req.rbacApproved = true; // lets the legacy per-route authorize() pass
    }

    if (req.method !== 'GET' || action === 'export') {
      logAudit({
        user, method: req.method, path: req.originalUrl || req.path,
        module: module || 'other', action,
        body: req.method !== 'GET' ? sanitizedBody(req.body) : null,
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip,
      });
    }
    next();
  } catch (err) {
    console.error('[rbac] guard error:', err.message);
    res.status(500).json({ success: false, message: 'Permission check failed' });
  }
}

module.exports = {
  PANEL_ROLES, STAFF_ROLES, ADMIN_ONLY_MODULES, MODULES, ACTIONS, DEFAULT_MATRIX,
  getMatrix, saveMatrix, can, effectivePermissions, guard, moduleForPath, logAudit,
};
