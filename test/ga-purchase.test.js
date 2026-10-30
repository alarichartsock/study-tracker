'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { createApp } = require('../server');
const billing = require('../lib/billing');
const CFG = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: { monthly: 'price_m', yearly: 'price_y' }, trialDays: 0 };
async function start(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ga-')), stripe = [], subs = { sub_1: { id: 'sub_1', customer: 'cus_2', status: 'active', metadata: { uid: '2' }, items: { data: [{ price: { id: 'price_m' }, current_period_end: 1830000000 }] } } };
  const stripeFetch = async (url, o) => { const u = new URL(url), body = Object.fromEntries(new URLSearchParams(o.body || '')); stripe.push({ path: u.pathname, body }); const ok = j => ({ ok: true, status: 200, json: async () => j });
    if (u.pathname === '/v1/customers') return ok({ id: 'cus_2' }); if (u.pathname === '/v1/checkout/sessions') return ok({ id: 'cs_9', url: 'https://checkout.stripe.com/x' });
    const m = /^\/v1\/subscriptions\/(.+)$/.exec(u.pathname); return ok(subs[m[1]]); };
  const server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, minSessionSec: 0, baseUrl: 'https://studyhertz.test', billing: CFG, stripeFetch, gaId: 'G-TEST1234', ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let ck = ''; return async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { Cookie: ck } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, body: await r.json() }; }; };
  const hook = async ev => { const raw = JSON.stringify(ev); return fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': billing.sign(raw, CFG.webhookSecret) }, body: raw }); };
  return { client, hook, stripe, close: () => new Promise(r => server.close(r)) };
}
const reg = (c, n) => c('/api/register', 'POST', { username: n, password: 'pass-12345', agree: true, birthYear: 1990 });
const done = (meta) => ({ id: 'evt_' + Math.random(), type: 'checkout.session.completed', data: { object: { id: 'cs_9', mode: 'subscription', client_reference_id: '2', customer: 'cus_2', subscription: 'sub_1', amount_total: 499, currency: 'usd', metadata: meta } } });

test('purchase conversion is returned without an Ads label, with plan; no Measurement Protocol without a secret', async t => {
  const mp = []; const app = await start({ gaApiSecret: '', mpFetch: async (...a) => { mp.push(a); return { ok: true, status: 204 }; } }); t.after(app.close);
  const own = app.client(), bob = app.client(); await reg(own, 'owner'); await reg(bob, 'bob');
  assert.equal((await bob('/api/billing/checkout', 'POST', { plan: 'monthly', gaCid: 'bad<cid>' })).status, 200);
  const cs = app.stripe.find(x => x.path === '/v1/checkout/sessions'); assert.equal(cs.body['metadata[ga_cid]'], undefined, 'invalid client id dropped');
  await app.hook(done({ uid: '2', plan: 'monthly', ga_cid: '123.456' }));
  assert.deepEqual((await bob('/api/billing')).body.conversion, { value: 4.99, currency: 'USD', txn: 'cs_9', plan: 'monthly' });
  assert.equal(mp.length, 0);
});

test('server-side GA4 purchase via Measurement Protocol when a secret and consented client id exist', async t => {
  const mp = []; const app = await start({ gaApiSecret: 'sec_x', mpFetch: async (url, o) => { mp.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 204 }; } }); t.after(app.close);
  const own = app.client(), bob = app.client(); await reg(own, 'owner'); await reg(bob, 'bob');
  await bob('/api/billing/checkout', 'POST', { plan: 'monthly', gaCid: '123.456' });
  assert.equal(app.stripe.find(x => x.path === '/v1/checkout/sessions').body['metadata[ga_cid]'], '123.456');
  const ev = done({ uid: '2', plan: 'monthly', ga_cid: '123.456' }); await app.hook(ev); await app.hook(ev); // duplicate webhook delivery
  assert.equal(mp.length, 1, 'exactly once');
  assert.match(mp[0].url, /measurement_id=G-TEST1234&api_secret=sec_x/);
  assert.deepEqual(mp[0].body.events[0], { name: 'purchase', params: { transaction_id: 'cs_9', value: 4.99, currency: 'USD', engagement_time_msec: 1,
    items: [{ item_id: 'studyhertz_monthly', item_name: 'StudyHertz Monthly', item_category: 'subscription', price: 4.99, quantity: 1 }] } });
  assert.equal(mp[0].body.client_id, '123.456');
  assert.equal((await bob('/api/billing')).body.conversion.mp, true, 'browser told not to resend');
});

test('client: begin_checkout and purchase carry items; purchase deduped per transaction', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'consent.js'), 'utf8'), calls = [], store = {};
  const ctx = { window: {}, navigator: {}, document: { readyState: 'complete', createElement: () => ({}), head: { appendChild() {} }, getElementById: () => ({}), addEventListener() {}, body: { appendChild() {} } },
    location: { href: 'https://studyhertz.com/', pathname: '/' }, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, sessionStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ json: async () => ({ gaId: 'G-TEST1234' }) }), URL, setTimeout, Promise, Date, JSON, Object, Number, String, isFinite };
  ctx.window = ctx; vm.runInNewContext(src, ctx);
  ctx.dataLayer.push = a => calls.push(Array.from(a));
  ctx.SHConsent.ecommerce('begin_checkout', { plan: 'yearly', value: 39 }); ctx.SHConsent.ecommerce('purchase', { txn: 'cs_9', value: 39, currency: 'USD', plan: 'yearly' }); ctx.SHConsent.ecommerce('purchase', { value: 39 });
  return new Promise(r => setTimeout(r, 20)).then(() => {
    const ev = calls.filter(c => c[0] === 'event' && c[1] !== 'page_view');
    assert.deepEqual(ev.map(e => e[1]), ['begin_checkout', 'purchase'], 'purchase without a transaction id is not sent');
    assert.equal(ev[1][2].transaction_id, 'cs_9'); assert.equal(ev[1][2].value, 39); assert.equal(ev[1][2].currency, 'USD'); assert.equal(ev[1][2].send_to, 'G-TEST1234');
    assert.deepEqual(JSON.parse(JSON.stringify(ev[1][2].items)), [{ item_id: 'studyhertz_yearly', item_name: 'StudyHertz Yearly', item_category: 'subscription', price: 39, quantity: 1 }]);
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.match(app, /const k = 'shPurchase_' \+ cv\.txn; if \(cv\.txn && !cv\.mp && !localStorage\[k\]\) \{ localStorage\[k\] = '1'; window\.SHConsent\?\.ecommerce\('purchase'/);
    assert.match(app, /SHConsent\?\.ecommerce\('begin_checkout'/);
  });
});
