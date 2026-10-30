'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const billing = require('../lib/billing');
const CFG = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: { monthly: 'price_m', yearly: 'price_y', lifetime: 'price_l' }, trialDays: 30 };
const DAY = 864e5;
async function start(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-aff-')), clock = { t: Date.parse('2026-11-01T12:00:00Z') }, calls = [];
  const affFetch = async (url, o) => { const u = new URL(url), body = Object.fromEntries(new URLSearchParams(o.body || '')); calls.push({ path: u.pathname, method: o.method, auth: o.headers.Authorization, idem: o.headers['Idempotency-Key'], body });
    const ok = j => ({ ok: true, status: 200, json: async () => j });
    if (u.pathname === '/v1/accounts' && o.method === 'POST') return ok({ id: 'acct_test1' });
    if (u.pathname === '/v1/account_links') return ok({ url: 'https://connect.stripe.com/setup/e/test' });
    if (u.pathname.startsWith('/v1/accounts/')) return ok({ id: 'acct_test1', payouts_enabled: true, capabilities: { transfers: 'active' } });
    if (u.pathname === '/v1/transfers') return ok({ id: 'tr_test_' + calls.length });
    return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) }; };
  const stripeFetch = async (url) => ({ ok: true, status: 200, json: async () => (new URL(url).pathname === '/v1/customers' ? { id: 'cus_' + Math.random().toString(36).slice(2, 8) } : { data: [] }) });
  const server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, trustProxy: true, baseUrl: 'https://studyhertz.test', billing: CFG, stripeFetch, affFetch, affConnectKey: 'sk_test_aff', affPayoutsLive: false, now: () => clock.t, ...extra });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const client = (ip = '10.0.0.' + Math.floor(Math.random() * 200 + 2)) => { const jar = {}; const c = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { 'X-Forwarded-For': ip, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'), i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(sc)) delete jar[k]; else jar[k] = v; }
    return { status: r.status, body: await r.json().catch(() => ({})) }; }; c.jar = jar; return c; };
  const hook = async ev => { const raw = JSON.stringify({ livemode: false, ...ev }); return fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': billing.sign(raw, CFG.webhookSecret) }, body: raw }); };
  return { client, hook, calls, clock, server, close: () => new Promise(r => server.close(r)) };
}
const reg = (c, n, extra = {}) => c('/api/register', 'POST', { username: n, password: 'pass-12345', agree: true, birthYear: 1990, ...extra });
const APP = { name: 'Dr Prep', email: 'prep@example.com', website: 'https://youtube.com/@prep', audience: '40k pre-med students' };
async function setup(t, extra) {
  const app = await start(extra); t.after(app.close);
  const own = app.client('10.9.9.9'); await reg(own, 'owner'); await own('/api/admin/config', 'POST', { openRegistration: true });
  const af = app.client('10.1.1.1'); await reg(af, 'creator');
  assert.equal((await af('/api/affiliates/apply', 'POST', APP)).status, 201);
  const id = (await own('/api/admin/affiliates')).body.affiliates[0].id;
  const ok = await own('/api/admin/affiliates/' + id, 'POST', { status: 'approved', rate: 25, months: 12 }); assert.equal(ok.status, 200);
  return { app, own, af, id, code: ok.body.code };
}
const invoice = (cus, id, amount, extra = {}) => ({ id: 'evt_' + id + Math.random(), type: 'invoice.paid', data: { object: { id, customer: cus, amount_paid: amount, payment_intent: 'pi_' + id, ...extra } } });
const custOf = (app, uid) => app.server.store.sql.subscription(uid)?.customer_id;

test('apply -> admin approve with custom rate/duration; admin endpoints are admin-only; public page served', async t => {
  const { app, af, code, id } = await setup(t);
  assert.match(code, /^[A-Z0-9]{7}$/);
  assert.equal((await af('/api/admin/affiliates')).status, 403);
  assert.equal((await af('/api/admin/affiliates/' + id, 'POST', { rate: 90 })).status, 403);
  const me = (await af('/api/affiliates/me')).body; assert.equal(me.affiliate.status, 'approved'); assert.equal(me.affiliate.rate, 25); assert.equal(me.link, 'https://studyhertz.test/?aff=' + code);
  assert.equal((await af('/api/affiliates/apply', 'POST', APP)).status, 409, 'one application per account');
  const bad = app.client(); await reg(bad, 'bad1'); assert.equal((await bad('/api/affiliates/apply', 'POST', { name: 'x' })).status, 400);
  const page = await fetch(app.server.address ? `http://127.0.0.1:${app.server.address().port}/affiliates` : ''); assert.equal(page.status, 200); assert.match(await page.text(), /affiliate program/i);
});

test('click cookie (60 days, last click wins) attributes the signup; affiliate beats a referral code; self/same-network signups do not count', async t => {
  const { app, own, af, code } = await setup(t);
  const v = app.client('10.2.2.2'); assert.equal((await v('/api/aff/click', 'POST', { code: code.toLowerCase() })).body.ok, true); assert.match(v.jar.sh_aff, new RegExp('^' + code + '\\.'));
  await v('/api/aff/click', 'POST', { code }); // same IP same day: counted once
  const refCode = (await own('/api/referral')).body.code;
  const r = await reg(v, 'visitor', { ref: refCode }); assert.equal(r.body.affiliate, true); assert.equal(r.body.referral, undefined, 'affiliate wins over referral'); assert.equal(v.jar.sh_aff, undefined, 'cookie cleared');
  const same = app.client('10.1.1.1'); await same('/api/aff/click', 'POST', { code }); assert.equal((await reg(same, 'sock')).body.affiliate, undefined, 'affiliate network IP blocked');
  const late = app.client('10.3.3.3'); await late('/api/aff/click', 'POST', { code }); app.clock.t += 61 * DAY; assert.equal((await reg(late, 'late')).body.affiliate, undefined, 'cookie expires after 60 days');
  assert.equal((await af('/api/aff/click', 'POST', { code: 'NOPE123' })).body.ok, false);
  const st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.clicks, 3); assert.equal(st.signups, 1);
});

test('commissions: invoices + lifetime on amount paid, idempotent, 30-day hold, refunds reverse, window ends after the duration', async t => {
  const { app, own, af, id, code } = await setup(t);
  const v = app.client('10.4.4.4'); await v('/api/aff/click', 'POST', { code }); const vid = (await reg(v, 'buyer')).body.user.id;
  await v('/api/billing/checkout', 'POST', { plan: 'monthly' }); const cus = custOf(app, vid); assert.ok(cus);
  await app.hook(invoice(cus, 'in_1', 399)); await app.hook(invoice(cus, 'in_1', 399)); // discounted first month; duplicate delivery
  let st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.earned, 99); assert.equal(st.pending, 99); assert.equal(st.payable, 0); assert.equal(st.paying, 1);
  await app.hook({ id: 'evt_life', type: 'checkout.session.completed', data: { object: { id: 'cs_life', mode: 'payment', payment_status: 'paid', client_reference_id: String(vid), customer: cus, amount_total: 10000, currency: 'usd', payment_intent: 'pi_life', metadata: { plan: 'lifetime', uid: String(vid) } } } });
  st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.earned, 99 + 2500);
  await app.hook({ id: 'evt_rf', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_life', amount: 10000, amount_refunded: 10000 } } });
  st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.earned, 99, 'full refund reverses the lifetime commission');
  await app.hook({ id: 'evt_rf2', type: 'charge.refunded', data: { object: { id: 'ch_2', payment_intent: 'pi_in_1', amount: 399, amount_refunded: 200 } } });
  st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.earned, 99 - 50, 'partial refund reverses proportionally');
  app.clock.t += 31 * DAY; st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.pending, 0); assert.equal(st.payable, 49);
  app.clock.t += 365 * DAY; await app.hook(invoice(cus, 'in_late', 499)); st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.earned, 49, 'no commission after the 12-month window');
  await own('/api/admin/affiliates/' + id, 'POST', { months: 24 }); await app.hook(invoice(cus, 'in_late2', 499)); st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.earned, 49 + 124, 'duration edit extends existing referrals');
  const self = (await af('/api/affiliates/me')).body.affiliate; assert.equal(self.code, code);
});

test('Connect Express onboarding + monthly transfers run in TEST mode only, with a $25 minimum, once per month', async t => {
  const { app, own, af, code } = await setup(t);
  const on = await af('/api/affiliates/connect', 'POST', {}); assert.equal(on.status, 200); assert.equal(on.body.mode, 'test'); assert.match(on.body.url, /connect\.stripe\.com/);
  const acct = app.calls.find(c => c.path === '/v1/accounts'); assert.equal(acct.body.type, 'express'); assert.equal(acct.body['capabilities[transfers][requested]'], 'true');
  assert.ok(app.calls.every(c => c.auth === 'Bearer sk_test_aff'), 'only the test key is ever used');
  const v = app.client('10.5.5.5'); await v('/api/aff/click', 'POST', { code }); const vid = (await reg(v, 'payer')).body.user.id; await v('/api/billing/checkout', 'POST', { plan: 'yearly' }); const cus = custOf(app, vid);
  await app.hook(invoice(cus, 'in_y1', 3900)); app.clock.t += 31 * DAY;
  let r = (await own('/api/admin/affiliates/payouts', 'POST', {})).body; assert.equal(r.payouts.length, 0, '$9.75 is under the $25 minimum');
  await app.hook({ id: 'evt_life2', type: 'checkout.session.completed', data: { object: { id: 'cs_l2', mode: 'payment', payment_status: 'paid', client_reference_id: String(vid), customer: cus, amount_total: 10000, currency: 'usd', payment_intent: 'pi_l2', metadata: { plan: 'lifetime', uid: String(vid) } } } });
  app.clock.t += 31 * DAY;
  r = (await own('/api/admin/affiliates/payouts', 'POST', {})).body; assert.equal(r.mode, 'test'); assert.equal(r.payouts.length, 1); assert.equal(r.payouts[0].amount, 975 + 2500);
  const tr = app.calls.filter(c => c.path === '/v1/transfers'); assert.equal(tr.length, 1); assert.equal(tr[0].body.destination, 'acct_test1'); assert.equal(tr[0].body.currency, 'usd'); assert.match(tr[0].idem, /^aff-payout-/);
  const st = (await af('/api/affiliates/me')).body.stats; assert.equal(st.paid, 3475); assert.equal(st.payable, 0);
  assert.deepEqual(await app.server.aff.runPayouts(), { skipped: 'already ran ' + new Date(app.clock.t).toISOString().slice(0, 7) });
  // refund after payout: clawed back from the next payable balance
  await app.hook({ id: 'evt_rf3', type: 'charge.refunded', data: { object: { id: 'ch_3', payment_intent: 'pi_l2', amount: 10000, amount_refunded: 10000 } } });
  assert.equal((await af('/api/affiliates/me')).body.stats.payable, 0);
});

test('live safety: a live key without AFFILIATE_PAYOUTS_LIVE never calls Stripe Connect', async t => {
  const { app, own, af } = await setup(t, { affConnectKey: 'sk_live_xyz', affPayoutsLive: false });
  const on = await af('/api/affiliates/connect', 'POST', {}); assert.equal(on.status, 503);
  assert.equal((await own('/api/admin/affiliates/payouts', 'POST', {})).status, 400);
  assert.deepEqual(await app.server.aff.runPayouts({ force: true }), { skipped: 'payouts disabled' });
  assert.equal(app.calls.length, 0);
  assert.equal((await af('/api/affiliates/me')).body.affiliate.connect.available, false);
});

test('no key at all (production today): program works, payouts stay off', async t => {
  const { app, af } = await setup(t, { affConnectKey: '' });
  assert.equal((await af('/api/affiliates/connect', 'POST', {})).status, 503); assert.equal(app.calls.length, 0);
});
