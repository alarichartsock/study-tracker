'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const billing = require('../lib/billing');
const CFG = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: { monthly: 'price_m', yearly: 'price_y', lifetime: 'price_l' }, trialDays: 0 };
async function start(cfg = CFG, fail = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-life-')), calls = [], subs = { sub_1: { id: 'sub_1', customer: 'cus_2', status: 'active', cancel_at_period_end: false, metadata: { uid: '2' }, items: { data: [{ price: { id: 'price_y' }, current_period_end: 1830000000 }] } } };
  const stripeFetch = async (url, o) => { const u = new URL(url), body = Object.fromEntries(new URLSearchParams(o.body || '')); calls.push({ method: o.method, path: u.pathname, body }); const ok = j => ({ ok: true, status: 200, json: async () => j });
    if (u.pathname === '/v1/customers') return ok({ id: 'cus_2' }); if (u.pathname === '/v1/checkout/sessions') return ok({ id: 'cs_x', url: 'https://checkout.stripe.com/c/pay/cs_x' });
    const m = /^\/v1\/subscriptions\/(.+)$/.exec(u.pathname); if (m) { if (o.method === 'POST' && fail) return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
      if (o.method === 'POST') subs[m[1]] = { ...subs[m[1]], cancel_at_period_end: body.cancel_at_period_end === 'true' }; return ok(subs[m[1]]); }
    return { ok: false, status: 404, json: async () => ({}) }; };
  const server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, minSessionSec: 0, baseUrl: 'https://studyhertz.test', billing: cfg, stripeFetch, gaApiSecret: '' });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let ck = ''; return async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { Cookie: ck } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, body: await r.json() }; }; };
  const hook = async ev => { const raw = JSON.stringify(ev); const r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': billing.sign(raw, CFG.webhookSecret) }, body: raw }); return r.status; };
  return { client, hook, calls, subs, close: () => new Promise(r => server.close(r)) };
}
const reg = (c, n) => c('/api/register', 'POST', { username: n, password: 'pass-12345', agree: true, birthYear: 1990 });
const paid = (id, extra = {}) => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_life', mode: 'payment', payment_status: 'paid', client_reference_id: '2', customer: 'cus_2', amount_total: 10000, currency: 'usd', metadata: { uid: '2', plan: 'lifetime' }, ...extra } } });

test('loadConfig resolves STRIPE_LIVE_PRICE_LIFETIME for live keys; plans offered only when configured', () => {
  const c = billing.loadConfig({ GROK_FULL_ACCESS: 'rk_live_x', STRIPE_PRICE_LIFETIME: 'pl_t', STRIPE_LIVE_PRICE_LIFETIME: 'pl_l' }); assert.equal(c.prices.lifetime, 'pl_l');
  assert.equal(billing.loadConfig({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_LIFETIME: 'pl_t', STRIPE_LIVE_PRICE_LIFETIME: 'pl_l' }).prices.lifetime, 'pl_t');
  assert.deepEqual(Object.keys(billing.plansFor({ prices: { lifetime: '' } })), ['monthly', 'yearly']);
  assert.equal(billing.plansFor(CFG).lifetime.amount, '100');
  const s = billing.status({ id: 2, created: '2020-01-01T00:00:00Z', billing: { lifetime: { at: '2026-10-29T00:00:00Z' } } }, null, CFG, Date.parse('2099-01-01'));
  assert.equal(s.active, true); assert.equal(s.lifetime, true); assert.equal(s.readOnly, undefined, 'never expires');
});

test('lifetime checkout is a payment-mode session; webhook grants lifetime, cancels the old plan at period end, GA conversion', async t => {
  const app = await start(); t.after(app.close);
  const own = app.client(), bob = app.client(); await reg(own, 'owner'); await reg(bob, 'bob');
  assert.ok((await bob('/api/billing')).body.plans.lifetime);
  const r = await bob('/api/billing/checkout', 'POST', { plan: 'lifetime' }); assert.equal(r.status, 200); assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
  const cs = app.calls.find(c => c.path === '/v1/checkout/sessions').body;
  assert.equal(cs.mode, 'payment'); assert.equal(cs['line_items[0][price]'], 'price_l'); assert.equal(cs['metadata[plan]'], 'lifetime'); assert.ok(!Object.keys(cs).some(k => k.startsWith('subscription_data')));
  // bob already has a yearly subscription
  await app.hook({ id: 'evt_s', type: 'customer.subscription.updated', data: { object: app.subs.sub_1 } });
  assert.equal((await bob('/api/billing')).body.subscribed, true);
  assert.equal(await app.hook(paid('evt_unpaid', { payment_status: 'unpaid' })), 200); assert.equal((await bob('/api/billing')).body.lifetime, undefined, 'unpaid sessions grant nothing');
  assert.equal(await app.hook(paid('evt_l1')), 200); assert.equal(await app.hook(paid('evt_l2')), 200); // retried delivery under a new event id
  const b = (await bob('/api/billing')).body;
  assert.equal(b.lifetime, true); assert.equal(b.active, true);
  assert.deepEqual(b.conversion, { value: 100, currency: 'USD', txn: 'cs_life', plan: 'lifetime' });
  const cancels = app.calls.filter(c => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1'); assert.equal(cancels.length, 1, 'canceled once');
  assert.equal(cancels[0].body.cancel_at_period_end, 'true'); assert.ok(!app.calls.some(c => /refund/.test(c.path) || c.method === 'DELETE'), 'never refunds or cancels immediately');
  assert.equal(b.subscription.cancelAtPeriodEnd, true);
  assert.equal((await bob('/api/billing/checkout', 'POST', { plan: 'lifetime' })).status, 409); assert.equal((await bob('/api/billing/checkout', 'POST', { plan: 'monthly' })).status, 409);
  const st = (await own('/api/admin/stats')).body.subscriptions; assert.equal(st.lifetime, 1); assert.equal(st.yearly, 0);
  assert.equal((await own('/api/admin/users')).body.find(u => u.username === 'bob').billing.lifetime, true);
});

test('lifetime: Stripe failure cancelling the old plan makes the webhook retry; lifetime not offered without a price', async t => {
  const app = await start(CFG, true); t.after(app.close);
  const own = app.client(), bob = app.client(); await reg(own, 'owner'); await reg(bob, 'bob');
  await app.hook({ id: 'evt_s', type: 'customer.subscription.updated', data: { object: app.subs.sub_1 } });
  assert.equal(await app.hook(paid('evt_f')), 500); assert.equal((await bob('/api/billing')).body.lifetime, true, 'grant kept; Stripe retries the cancel');
  const app2 = await start({ ...CFG, prices: { monthly: 'price_m', yearly: 'price_y' } }); t.after(app2.close);
  const o2 = app2.client(), c2 = app2.client(); await reg(o2, 'owner'); await reg(c2, 'cat');
  assert.equal((await c2('/api/billing')).body.plans.lifetime, undefined); assert.equal((await c2('/api/billing/checkout', 'POST', { plan: 'lifetime' })).status, 400);
});

test('client: lifetime in pricing, paywall and GA items; deletion text mentions non-refundable lifetime', () => {
  const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), h = pub('index.html'), js = pub('app.js'), c = pub('consent.js');
  assert.match(h, /id="planLifetime"[\s\S]*?\$100/); assert.match(js, /data-plan="lifetime"/); assert.match(js, /lifetime: 100/);
  assert.match(c, /plan === 'lifetime' \? 'Lifetime'/); assert.match(js, /lifetime access isn't refundable/);
});
