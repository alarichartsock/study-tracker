'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const billing = require('../lib/billing');
const { Store } = require('../lib/store');

const CFG = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: { monthly: 'price_m', yearly: 'price_y' }, trialDays: 30, purchaseLabel: 'PurchLbl' };
function fakeStripe() {
  const calls = [], subs = {};
  const f = async (url, o) => { const u = new URL(url), body = Object.fromEntries(new URLSearchParams(o.body || '')); calls.push({ method: o.method, path: u.pathname, body, headers: o.headers });
    const ok = j => ({ ok: true, status: 200, json: async () => j });
    if (u.pathname === '/v1/customers') return ok({ id: 'cus_' + body['metadata[uid]'] });
    if (u.pathname === '/v1/checkout/sessions') return ok({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    if (u.pathname === '/v1/billing_portal/sessions') return ok({ url: 'https://billing.stripe.com/p/session/x' });
    const m = /^\/v1\/subscriptions\/(.+)$/.exec(u.pathname); if (m) return ok(subs[m[1]]);
    return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) }; };
  return { f, calls, subs };
}
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-bill-')), dataFile = path.join(dir, 'data.json');
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true, baseUrl: 'https://studyhertz.test', ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = ''; return async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; } return { status: r.status, body: json }; }; };
  const hook = async (ev, secret = CFG.webhookSecret, sig) => { const raw = JSON.stringify(ev);
    const r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig || billing.sign(raw, secret) }, body: raw }); return { status: r.status, body: await r.json() }; };
  return { base, client, hook, dataFile, close: () => new Promise(r => server.close(r)) };
}
const reg = (c, name) => c('/api/register', 'POST', { username: name, password: 'pass-12345', agree: true, birthYear: 1990 });

test('lib: signature verification, form encoding, status rules, live keys stay off', () => {
  const raw = '{"id":"evt_1"}', h = billing.sign(raw, 'whsec_a');
  assert.ok(billing.verifySignature(raw, h, 'whsec_a'));
  assert.ok(!billing.verifySignature(raw, h, 'whsec_b'));
  assert.ok(!billing.verifySignature(raw + ' ', h, 'whsec_a'));
  assert.ok(!billing.verifySignature(raw, billing.sign(raw, 'whsec_a', Math.floor(Date.now() / 1000) - 600), 'whsec_a'), 'replay window');
  assert.equal(billing.form({ a: 1, line_items: [{ price: 'p', quantity: 1 }], m: { uid: '2' } }), 'a=1&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&m%5Buid%5D=2');
  const now = Date.parse('2026-11-01T00:00:00Z'), u = { id: 2, created: '2026-10-20T00:00:00Z' };
  assert.deepEqual(billing.status(u, null, { ...CFG, secretKey: '' }), { enabled: false, active: true });
  let s = billing.status(u, null, CFG, now); assert.equal(s.trial, true); assert.equal(s.trialDaysLeft, 18);
  s = billing.status(u, null, CFG, Date.parse('2026-11-20T00:00:01Z')); assert.equal(s.active, false); assert.equal(s.readOnly, true);
  assert.equal(billing.status(u, { status: 'active' }, CFG, Date.parse('2027-06-01')).subscribed, true);
  assert.equal(billing.status(u, { status: 'past_due' }, CFG, Date.parse('2027-06-01')).active, true);
  assert.equal(billing.status(u, { status: 'canceled' }, CFG, Date.parse('2027-06-01')).active, false);
  assert.equal(billing.status({ ...u, admin: true }, null, CFG, Date.parse('2027-06-01')).exempt, 'admin');
  assert.equal(billing.status({ ...u, billing: { comp: true } }, null, CFG, Date.parse('2027-06-01')).active, true);
  assert.equal(billing.enabled({ ...CFG, secretKey: 'sk_live_x' }), false, 'live key ignored');
  assert.equal(billing.enabled({ ...CFG, secretKey: 'sk_live_x', allowLive: true }), true);
});

test('billing disabled: no UI, no lock-out, webhook 404', async t => {
  const app = await start({ billing: { ...CFG, secretKey: '' }, trialDays: 0 }); t.after(app.close);
  const c = app.client(); await reg(c, 'owner'); const b = app.client(); await reg(b, 'bob');
  assert.equal((await app.client()('/api/public-config')).body.billing, null);
  assert.equal((await b('/api/me')).body.billing.enabled, false);
  assert.equal((await b('/api/sessions', 'POST', { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' })).status, 200);
  assert.equal((await app.hook({ id: 'evt_x', type: 'ping' })).status, 404);
});

test('trial, read-only paywall, checkout, signed webhook, portal, comp, legacy', async t => {
  const fk = fakeStripe(), app = await start({ billing: { ...CFG, trialDays: 0 }, stripeFetch: fk.f }); t.after(app.close);
  const own = app.client(), bob = app.client(), anon = app.client();
  await reg(own, 'owner'); await reg(bob, 'bob');
  assert.deepEqual((await anon('/api/public-config')).body.billing.plans.monthly.amount, '4.99');
  assert.equal((await own('/api/me')).body.billing.exempt, 'admin');
  assert.equal((await own('/api/sessions', 'POST', { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' })).status, 200, 'admin never locked out');
  const me = (await bob('/api/me')).body; assert.equal(me.billing.readOnly, true);
  // read-only: writes blocked, reads + export still work, nothing deleted
  const w = await bob('/api/sessions', 'POST', { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' }); assert.equal(w.status, 402); assert.equal(w.body.paywall, true);
  assert.equal((await bob('/api/state')).status, 200); assert.equal((await bob('/api/export.json')).status, 200);
  assert.equal((await bob('/api/logout', 'POST')).status, 200); await bob('/api/login', 'POST', { username: 'bob', password: 'pass-12345' });
  // checkout
  const co = await bob('/api/billing/checkout', 'POST', { plan: 'yearly' }); assert.equal(co.status, 200); assert.match(co.body.url, /^https:\/\/checkout\.stripe\.com\//);
  const cs = fk.calls.find(x => x.path === '/v1/checkout/sessions');
  assert.equal(cs.body.mode, 'subscription'); assert.equal(cs.body['line_items[0][price]'], 'price_y'); assert.equal(cs.body.customer, 'cus_2'); assert.equal(cs.body.client_reference_id, '2');
  assert.equal(cs.body.success_url, 'https://studyhertz.test/?billing=success'); assert.ok(!Object.keys(cs.body).some(k => k.startsWith('payment_method_types')));
  assert.equal(cs.headers['Stripe-Version'], billing.API_VERSION); assert.equal(cs.headers.Authorization, 'Bearer sk_test_x');
  // webhook: bad signature rejected, good one activates
  const sub = { id: 'sub_1', customer: 'cus_2', status: 'active', cancel_at_period_end: false, metadata: { uid: '2' }, items: { data: [{ price: { id: 'price_y' }, current_period_end: 1830000000 }] } }; fk.subs.sub_1 = sub;
  const evc = { id: 'evt_1', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_1', mode: 'subscription', client_reference_id: '2', customer: 'cus_2', subscription: 'sub_1', amount_total: 3900, currency: 'usd' } } };
  assert.equal((await app.hook(evc, 'whsec_wrong')).status, 400);
  assert.equal((await bob('/api/me')).body.billing.readOnly, true);
  assert.equal((await app.hook(evc)).status, 200);
  assert.equal((await app.hook(evc)).body.duplicate, true, 'idempotent');
  let bl = (await bob('/api/billing')).body; assert.equal(bl.subscribed, true); assert.equal(bl.subscription.plan, 'yearly'); assert.deepEqual(bl.conversion, { label: 'PurchLbl', value: 39, currency: 'USD', txn: 'cs_1' });
  await bob('/api/billing/conversion-seen', 'POST', {}); assert.equal((await bob('/api/billing')).body.conversion, undefined);
  assert.equal((await bob('/api/sessions', 'POST', { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' })).status, 200);
  assert.equal((await bob('/api/billing/checkout', 'POST', { plan: 'monthly' })).status, 409);
  assert.match((await bob('/api/billing/portal', 'POST', {})).body.url, /billing\.stripe\.com/);
  // payment failure keeps access (past_due), cancellation returns to read-only
  fk.subs.sub_1 = { ...sub, status: 'past_due' };
  assert.equal((await app.hook({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { customer: 'cus_2', parent: { subscription_details: { subscription: 'sub_1' } } } } })).status, 200);
  bl = (await bob('/api/billing')).body; assert.equal(bl.active, true); assert.equal(bl.subscription.paymentFailed, true);
  await app.hook({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } });
  assert.equal((await bob('/api/billing')).body.readOnly, true);
  assert.equal((await app.hook({ id: 'evt_4', type: 'customer.subscription.updated', livemode: true, data: { object: sub } })).body.ignored, 'livemode');
  // admin comp
  assert.equal((await bob('/api/admin/users/2/comp', 'POST', { comp: true })).status, 403);
  const users = (await own('/api/admin/users')).body; assert.equal(users.find(u => u.username === 'bob').billing.readOnly, true);
  assert.equal((await own('/api/admin/users/2/comp', 'POST', { comp: true })).status, 200);
  assert.equal((await bob('/api/me')).body.billing.exempt, 'comp');
  // existing accounts at upgrade time are legacy-comped
  await app.close(); const st = new Store(app.dataFile); st.db.config.billingGrant = undefined; st.db.users.forEach(u => { u.billing = {}; }); st.save(); st.close();
  const app2 = await start({ dataFile: app.dataFile, billing: { ...CFG, trialDays: 0 }, stripeFetch: fk.f }); t.after(app2.close);
  const b2 = app2.client(); await b2('/api/login', 'POST', { username: 'bob', password: 'pass-12345' });
  assert.equal((await b2('/api/me')).body.billing.exempt, 'legacy');
  const c3 = app2.client(); await reg(c3, 'carol'); assert.equal((await c3('/api/me')).body.billing.readOnly, true, 'new sign-ups are not legacy');
});

test('new user gets a 30-day trial from sign-up', async t => {
  const app = await start({ billing: CFG, stripeFetch: fakeStripe().f }); t.after(app.close);
  const a = app.client(), b = app.client(); await reg(a, 'owner'); await reg(b, 'newbie');
  const s = (await b('/api/me')).body.billing; assert.equal(s.trial, true); assert.equal(s.trialDaysLeft, 30);
  assert.equal((await b('/api/sessions', 'POST', { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' })).status, 200);
});

test('loadConfig resolves GROK_FULL_ACCESS and STRIPE_LIVE_* names for live keys', () => {
  const base = { STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_t', STRIPE_PRICE_MONTHLY: 'pm_t', STRIPE_PRICE_YEARLY: 'py_t', STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_l', STRIPE_LIVE_PRICE_MONTHLY: 'pm_l', STRIPE_LIVE_PRICE_YEARLY: 'py_l' };
  let c = billing.loadConfig(base);
  assert.equal(c.secretKey, 'sk_test_a'); assert.equal(c.webhookSecret, 'whsec_t'); assert.deepEqual(c.prices, { monthly: 'pm_t', yearly: 'py_t' }); assert.ok(billing.enabled(c));
  c = billing.loadConfig({ ...base, GROK_FULL_ACCESS: 'sk_live_b' });
  assert.equal(c.secretKey, 'sk_live_b'); assert.equal(c.webhookSecret, 'whsec_l'); assert.deepEqual(c.prices, { monthly: 'pm_l', yearly: 'py_l' });
  assert.equal(billing.enabled(c), false, 'live key needs STRIPE_ALLOW_LIVE=1');
  assert.ok(billing.enabled(billing.loadConfig({ ...base, GROK_FULL_ACCESS: 'sk_live_b', STRIPE_ALLOW_LIVE: '1' })));
  c = billing.loadConfig({ GROK_FULL_ACCESS: 'sk_live_b', STRIPE_WEBHOOK_SECRET: 'whsec_t', STRIPE_PRICE_MONTHLY: 'pm_t', STRIPE_PRICE_YEARLY: 'py_t' });
  assert.equal(c.webhookSecret, 'whsec_t'); assert.deepEqual(c.prices, { monthly: 'pm_t', yearly: 'py_t' });
  c = billing.loadConfig({ ...base, GROK_FULL_ACCESS: 'rk_live_r' });
  assert.equal(c.webhookSecret, 'whsec_l'); assert.deepEqual(c.prices, { monthly: 'pm_l', yearly: 'py_l' }, 'restricted live keys use live names too');
});
