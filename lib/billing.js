'use strict';
// StudyHertz billing: 30-day trial, then a Stripe subscription. Zero-dependency (fetch + node:crypto).
const crypto = require('crypto');
const API_VERSION = '2026-09-30.endive', DAY = 864e5;
const PLANS = { monthly: { amount: '4.99', label: '$4.99 / month' }, yearly: { amount: '39', label: '$39 / year' } };

function loadConfig(env = process.env) {
  // Key: GROK_FULL_ACCESS wins over STRIPE_SECRET_KEY. With a live key, the STRIPE_LIVE_* names win, falling back to the plain names.
  const secretKey = env.GROK_FULL_ACCESS || env.STRIPE_SECRET_KEY || '', live = /^sk_live_/.test(secretKey), pick = n => (live && env['STRIPE_LIVE_' + n]) || env['STRIPE_' + n] || '';
  return { secretKey, webhookSecret: pick('WEBHOOK_SECRET'), prices: { monthly: pick('PRICE_MONTHLY'), yearly: pick('PRICE_YEARLY') },
    trialDays: Number(env.TRIAL_DAYS || 30), purchaseLabel: String(env.CONVERSION_LABEL_PURCHASE || '').replace(/[^A-Za-z0-9_-]/g, ''),
    allowLive: env.STRIPE_ALLOW_LIVE === '1' };
}
const liveKey = c => /^(sk|rk)_live_/.test((c && c.secretKey) || '');
// Billing is on only when every key is present (and the key is a TEST key unless STRIPE_ALLOW_LIVE=1); otherwise nobody is locked out.
const enabled = c => !!(c && c.secretKey && c.webhookSecret && c.prices && c.prices.monthly && c.prices.yearly && (!liveKey(c) || c.allowLive));

// Stripe form encoding: nested objects/arrays as a[b][0][c]=v
function form(obj, pre = '', out = []) {
  for (const [k, v] of Object.entries(obj)) { if (v === undefined || v === null) continue; const key = pre ? `${pre}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v))); }
  return out.join('&');
}
function client(cfg, fetchFn = globalThis.fetch) {
  return async (method, p, params, idem) => {
    const r = await fetchFn('https://api.stripe.com/v1' + p + (method === 'GET' && params ? '?' + form(params) : ''), { method,
      headers: { Authorization: 'Bearer ' + cfg.secretKey, 'Stripe-Version': API_VERSION, ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: method !== 'GET' && params ? form(params) : undefined, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Stripe request failed'); e.status = r.status; throw e; }
    return j;
  };
}
// Verify the Stripe-Signature header (HMAC-SHA256 over "t.payload") with a replay window.
function verifySignature(raw, header, secret, tolSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = String(header).split(','), t = Number((parts.find(x => x.startsWith('t=')) || '').slice(2)), sigs = parts.filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > tolSec) return false;
  const exp = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex'));
  return sigs.some(s => { const b = Buffer.from(s); return b.length === exp.length && crypto.timingSafeEqual(b, exp); });
}
const sign = (raw, secret, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; // for tests
const ACTIVE = new Set(['active', 'trialing', 'past_due']); // past_due keeps access while Stripe retries the card
// Access state for one user. sub = row from the subscriptions table (or undefined).
function status(user, sub, cfg, now = Date.now()) {
  if (!enabled(cfg)) return { enabled: false, active: true };
  const b = user.billing || {}, out = { enabled: true, trialDays: cfg.trialDays };
  if (sub && sub.status) out.subscription = { status: sub.status, plan: sub.plan || null, currentPeriodEnd: sub.current_period_end || null, cancelAtPeriodEnd: !!sub.cancel_at_period_end, paymentFailed: !!sub.payment_failed };
  if (user.admin) return { ...out, active: true, exempt: 'admin' };
  if (b.comp) return { ...out, active: true, exempt: 'comp' };
  if (b.legacy) return { ...out, active: true, exempt: 'legacy' };
  if (sub && ACTIVE.has(sub.status)) return { ...out, active: true, subscribed: true };
  const bonus = Math.max(0, Number(b.trialBonusDays) || 0), start = Date.parse(b.trialStart || user.created) || now, ends = start + (cfg.trialDays + bonus) * DAY;
  if (bonus) out.trialBonusDays = bonus;
  out.trialEnds = new Date(ends).toISOString(); out.trialDaysLeft = Math.max(0, Math.ceil((ends - now) / DAY));
  out.active = now < ends; if (out.active) out.trial = true; else out.readOnly = true;
  return out;
}
const planOf = (sub, cfg) => { const pid = sub && sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  return pid === cfg.prices.yearly ? 'yearly' : pid === cfg.prices.monthly ? 'monthly' : null; };
// current_period_end lives on subscription items in recent API versions; fall back to the top level.
const periodEnd = sub => { const v = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || sub.current_period_end; return v ? new Date(v * 1000).toISOString() : null; };
module.exports = { API_VERSION, PLANS, loadConfig, enabled, liveKey, form, client, verifySignature, sign, status, planOf, periodEnd };
