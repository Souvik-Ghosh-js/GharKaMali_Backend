// ─────────────────────────────────────────────────────────────────────────────
// Customer wallet — cashback + top-ups, all amounts in integer PAISE.
//
// Money lives in wallet_credits rows; each credit expires independently
// (cashback: validity_days from the config; top-ups/refunds: never). Spendable
// balance = SUM(remaining_paise) of unexpired credits. Spends decrement credits
// soonest-expiring first and are logged in wallet_debits. users.wallet_balance
// is only a display cache, re-synced here after every wallet operation.
//
// Cashback tiers (admin-configurable in system_settings under 'wallet_config'):
// the HIGHEST tier whose min_order the paid total reaches wins. Defaults match
// the launch offer: ₹50 on ₹1000, ₹100 on ₹1500, ₹150 on ₹2000, ₹250 on ₹3000,
// each credit valid 30 days from the day it is added.
// ─────────────────────────────────────────────────────────────────────────────
const { Op } = require('sequelize');

const DEFAULT_CONFIG = {
  enabled: true,
  tiers: [
    { min_order: 1000, cashback: 50 },
    { min_order: 1500, cashback: 100 },
    { min_order: 2000, cashback: 150 },
    { min_order: 3000, cashback: 250 },
  ],
  validity_days: 30,
};

const SETTING_KEY = 'wallet_config';
let cache = { config: null, at: 0 };
const CACHE_MS = 60 * 1000;

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return 'config must be an object';
  if (!Array.isArray(cfg.tiers) || !cfg.tiers.length) return 'tiers must be a non-empty array';
  let prevMin = 0;
  for (const t of cfg.tiers) {
    const min = Number(t?.min_order), cb = Number(t?.cashback);
    if (!Number.isFinite(min) || min <= 0) return 'each tier needs a positive min_order';
    if (!Number.isFinite(cb) || cb < 0) return 'each tier needs a non-negative cashback';
    if (min <= prevMin) return 'tiers must be in ascending min_order with no duplicates';
    if (cb >= min) return `tier ₹${min}: cashback must be below the order value`;
    prevMin = min;
  }
  const days = Number(cfg.validity_days);
  if (!Number.isInteger(days) || days < 1 || days > 365) return 'validity_days must be 1–365';
  return null;
}

async function getWalletConfig() {
  if (cache.config && Date.now() - cache.at < CACHE_MS) return cache.config;
  try {
    const { SystemSetting } = require('../models');
    const row = await SystemSetting.findOne({ where: { key: SETTING_KEY } });
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (!validateConfig(parsed)) {
        cache = { config: parsed, at: Date.now() };
        return parsed;
      }
    }
  } catch (e) {
    console.error('[wallet] config read failed, using defaults:', e.message);
  }
  cache = { config: DEFAULT_CONFIG, at: Date.now() };
  return DEFAULT_CONFIG;
}

function invalidateWalletConfigCache() { cache = { config: null, at: 0 }; }

// Unexpired-credit filter. bufferMs > 0 excludes credits about to expire, so an
// amount quoted at checkout is still there minutes later at fulfillment.
function unexpiredWhere(bufferMs = 0) {
  return { [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: new Date(Date.now() + bufferMs) } }] };
}

// Spendable balance in paise.
async function balancePaise(userId, { bufferMs = 0, transaction } = {}) {
  const { WalletCredit } = require('../models');
  const sum = await WalletCredit.sum('remaining_paise', {
    where: { user_id: userId, remaining_paise: { [Op.gt]: 0 }, ...unexpiredWhere(bufferMs) },
    transaction,
  });
  return Number(sum) || 0;
}

// Recompute the users.wallet_balance display cache from the ledger.
async function syncBalanceCache(userId, transaction) {
  const { User } = require('../models');
  const paise = await balancePaise(userId, { transaction });
  await User.update({ wallet_balance: (paise / 100).toFixed(2) }, { where: { id: userId }, transaction });
  return paise;
}

// Add money. expiresAt null = never expires.
async function credit(userId, { type, amountPaise, sourceType = null, sourceId = null, note = null, expiresAt = null, transaction }) {
  const { WalletCredit } = require('../models');
  const amt = Math.round(Number(amountPaise));
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Invalid wallet credit amount');
  const row = await WalletCredit.create({
    user_id: userId, type, amount_paise: amt, remaining_paise: amt,
    source_type: sourceType, source_id: sourceId, note, expires_at: expiresAt,
  }, { transaction });
  await syncBalanceCache(userId, transaction);
  return row;
}

// Spend money: consume credits soonest-expiring first (never-expiring last),
// row-locked so concurrent spends can't double-use a credit. Returns the paise
// actually debited. Throws when insufficient unless allowPartial.
async function debit(userId, amountPaise, { purposeType = null, purposeId = null, note = null, allowPartial = false, transaction } = {}) {
  const { WalletCredit, WalletDebit, sequelize } = require('../models');
  const want = Math.round(Number(amountPaise));
  if (!Number.isInteger(want) || want <= 0) return 0;

  const run = async (t) => {
    const credits = await WalletCredit.findAll({
      where: { user_id: userId, remaining_paise: { [Op.gt]: 0 }, ...unexpiredWhere() },
      order: [[sequelize.literal('expires_at IS NULL'), 'ASC'], ['expires_at', 'ASC'], ['id', 'ASC']],
      transaction: t, lock: t.LOCK.UPDATE,
    });
    const available = credits.reduce((s, c) => s + c.remaining_paise, 0);
    if (available < want && !allowPartial) {
      const e = new Error(`Insufficient wallet balance (have ₹${(available / 100).toFixed(2)}, need ₹${(want / 100).toFixed(2)})`);
      e.httpStatus = 400;
      throw e;
    }
    let left = Math.min(want, available);
    const debited = left;
    for (const c of credits) {
      if (left <= 0) break;
      const take = Math.min(c.remaining_paise, left);
      await c.update({ remaining_paise: c.remaining_paise - take }, { transaction: t });
      left -= take;
    }
    if (debited > 0) {
      await WalletDebit.create({
        user_id: userId, amount_paise: debited,
        purpose_type: purposeType, purpose_id: purposeId, note,
      }, { transaction: t });
    }
    await syncBalanceCache(userId, t);
    return debited;
  };

  if (transaction) return run(transaction);
  return sequelize.transaction(run);
}

// Cashback for a paid entity: highest tier whose min_order the total reaches.
// Idempotent (unique index on type+source) and never throws — a cashback
// failure must not break payment fulfillment.
async function awardCashback(userId, totalRupees, sourceType, sourceId) {
  try {
    const cfg = await getWalletConfig();
    if (!cfg.enabled) return null;
    const total = Number(totalRupees) || 0;
    let tier = null;
    for (const t of cfg.tiers) { if (total >= Number(t.min_order)) tier = t; }
    if (!tier || !(Number(tier.cashback) > 0)) return null;

    const expiresAt = new Date(Date.now() + Number(cfg.validity_days) * 24 * 60 * 60 * 1000);
    const row = await credit(userId, {
      type: 'cashback',
      amountPaise: Math.round(Number(tier.cashback) * 100),
      sourceType, sourceId,
      note: `₹${tier.cashback} cashback on order of ₹${Math.round(total)}`,
      expiresAt,
    });

    // Tell the customer (best-effort).
    try {
      const notificationService = require('./notification.service');
      await notificationService.notifyUser(userId, {
        title: '🎉 Cashback Earned!',
        body: `₹${tier.cashback} cashback has been added to your wallet. Use it on your next order — valid for ${cfg.validity_days} days.`,
        type: 'success',
        data: { screen: 'wallet' },
      });
    } catch (_) { /* notification is optional */ }
    return row;
  } catch (e) {
    // Duplicate (already awarded for this entity) or any other failure: skip quietly.
    if (e?.name !== 'SequelizeUniqueConstraintError') {
      console.error(`[wallet] cashback failed for ${sourceType}#${sourceId}:`, e.message);
    }
    return null;
  }
}

module.exports = {
  DEFAULT_CONFIG, SETTING_KEY,
  getWalletConfig, invalidateWalletConfigCache, validateConfig,
  balancePaise, syncBalanceCache, credit, debit, awardCashback,
};
