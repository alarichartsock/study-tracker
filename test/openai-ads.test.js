'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { createApp } = require('../server');
const billing = require('../lib/billing');
const CFG = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: { monthly: 'price_m', yearly: 'price_y' }, trialDays: 0 };
async function start(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-oai-')), stripe = [], subs = { sub_1: { id: 'sub_1', customer: 'cus_2', status: 'active', metadata: { uid: '2' }, items: { data: [{ price: { id: 'price_m' }, current_period_end: 1830000000 }] } } };
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
const reg = (c, n) => c('/api/register', 'POST', { email: 'u' + Math.random().toString(36).slice(2) + '@example.com', username: n, password: 'pass-12345', agree: true, birthYear: 1990 });
const done = (meta) => ({ id: 'evt_' + Math.random(), type: 'checkout.session.completed', data: { object: { id: 'cs_9', mode: 'subscription', client_reference_id: '2', customer: 'cus_2', subscription: 'sub_1', amount_total: 499, currency: 'usd', metadata: meta } } });

const usage = require('../lib/usage');
const OENV = { OPENAI_ADS_PIXEL_ID: 'px_test', OPENAI_CONVERSIONS_API_KEY: 'key_secret_x' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const OPP = 'gAAAAAb' + 'x'.repeat(180) + '-_=';

test('ChatGPT ad signup: oppref stored unmodified, source ChatGPT ad, registration + trial sent once with consent', async t => {
  const sent = []; const app = await start({ oaiEnv: OENV, oaiFetch: async (url, o) => { sent.push({ url, auth: o.headers.Authorization, body: JSON.parse(o.body) }); return { ok: true, status: 200, text: async () => '' }; } }); t.after(app.close);
  const own = app.client(), c = app.client(); await reg(own, 'owner');
  const r = await c('/api/register', 'POST', { email: 'u' + Math.random().toString(36).slice(2) + '@example.com', username: 'gpt', password: 'pass-12345', agree: true, birthYear: 1990, ads: true, ft: { oppref: OPP, olref: 'ol1', landing: '/' } });
  assert.equal(r.status, 200); await wait(50);
  assert.equal(sent.length, 1); assert.equal(sent[0].url, 'https://bzr.openai.com/v1/events?pid=px_test'); assert.equal(sent[0].auth, 'Bearer key_secret_x');
  const [e1, e2] = sent[0].body.events; assert.equal(sent[0].body.validate_only, false);
  assert.equal(e1.type, 'registration_completed'); assert.equal(e1.oppref, OPP); assert.deepEqual(e1.data, { type: 'customer_action' }); assert.equal(e1.action_source, 'web'); assert.match(e1.source_url, /^https:\/\//); assert.match(e1.user.external_ids_sha256[0], /^[0-9a-f]{64}$/);
  assert.equal(e2.type, 'trial_started'); assert.deepEqual(e2.data, { type: 'plan_enrollment' });
  await c('/api/attribution', 'POST', { oppref: OPP, ads: true }); await c('/api/ads-consent', 'POST', { ok: true }); await wait(50);
  assert.equal(sent.length, 1, 'sent once');
  await app.hook(done({ uid: '2', plan: 'monthly' })); await wait(50);
  assert.equal(sent.length, 2); const s = sent[1].body.events[0]; assert.equal(s.type, 'subscription_created'); assert.equal(s.id, 'cs_9'); assert.deepEqual(s.data, { type: 'plan_enrollment', plan_id: 'monthly', amount: 499, currency: 'USD' }); assert.equal(s.oppref, OPP);
});

test('no consent: nothing sent until the user accepts ad cookies; not configured: nothing sent', async t => {
  const sent = []; const app = await start({ oaiEnv: OENV, oaiFetch: async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200 }; } }); t.after(app.close);
  const own = app.client(), c = app.client(); await reg(own, 'owner');
  await c('/api/register', 'POST', { email: 'u' + Math.random().toString(36).slice(2) + '@example.com', username: 'gpt', password: 'pass-12345', agree: true, birthYear: 1990, ft: { oppref: 'abc' } }); await wait(30);
  assert.equal(sent.length, 0); await c('/api/ads-consent', 'POST', { ok: true }); await wait(50); assert.equal(sent.length, 1); assert.equal(sent[0].events[0].oppref, 'abc');
  const off = await start({ oaiEnv: {}, oaiFetch: async () => { throw new Error('should not fetch'); } }); t.after(off.close);
  const d = off.client(); await reg(d, 'x'); await d('/api/ads-consent', 'POST', { ok: true });
});

test('usage source labels ChatGPT ads', () => {
  const pu = a => usage.perUser({ id: 1, username: 'a', attribution: a }, {}).source;
  assert.equal(pu({ oppref: 'x', utm_source: 'google' }), 'ChatGPT ad'); assert.equal(pu({ utm_source: 'chatgpt.com' }), 'ChatGPT ad'); assert.equal(pu({ gclid: 'g' }), 'google (gclid)'); assert.equal(pu({ msclkid: 'm' }), 'Microsoft ad'); assert.equal(pu({ ttclid: 't' }), 'TikTok ad');
  const lib = require('../lib/openai-ads'); assert.equal(lib.create({}).enabled, false);
  assert.equal(lib.create(OENV).build({ id: 'o1', type: 'order_created', url: 'https://x.com/', amount: 10000, currency: 'usd' }).data.type, 'contents');
});

test('TikTok Events API: CompleteRegistration once with consent (ttclid, hashed email/external_id, shared event_id), Subscribe on payment, off without token', async t => {
  const sent = []; const app = await start({ ttEnv: { TIKTOK_EVENTS_API_TOKEN: 'tt_secret_x' }, ttFetch: async (url, o) => { sent.push({ url, tok: o.headers['Access-Token'], body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ code: 0 }) }; } }); t.after(app.close);
  const own = app.client(), c = app.client(); await reg(own, 'owner');
  await c('/api/register', 'POST', { email: 'Tik@Example.com', username: 'tik', password: 'pass-12345', agree: true, birthYear: 1990, ft: { ttclid: 'ttc1', landing: '/' } }); await wait(30);
  assert.equal(sent.length, 0, 'no consent, nothing sent');
  await c('/api/ads-consent', 'POST', { ok: true }); await wait(50); await c('/api/ads-consent', 'POST', { ok: true }); await wait(30);
  assert.equal(sent.length, 1); assert.equal(sent[0].url, 'https://business-api.tiktok.com/open_api/v1.3/event/track/'); assert.equal(sent[0].tok, 'tt_secret_x');
  const b = sent[0].body, e = b.data[0]; assert.equal(b.event_source, 'web'); assert.equal(b.event_source_id, 'DBKKRPBC77U0QLCJSAV0');
  assert.equal(e.event, 'CompleteRegistration'); assert.equal(e.event_id, 'reg_u2'); assert.equal(e.user.ttclid, 'ttc1');
  assert.equal(e.user.email, require('crypto').createHash('sha256').update('tik@example.com').digest('hex')); assert.match(e.user.external_id, /^[0-9a-f]{64}$/);
  const co = await c('/api/billing/checkout', 'POST', { plan: 'yearly' }); assert.equal(co.body.id, 'cs_9'); await wait(50);
  assert.equal(sent.length, 2); const ic = sent[1].body.data[0]; assert.equal(ic.event, 'InitiateCheckout'); assert.equal(ic.event_id, 'ic_cs_9'); assert.equal(ic.properties.value, 39); assert.equal(ic.properties.content_id, 'studyhertz_yearly');
  await app.hook(done({ uid: '2', plan: 'monthly' })); await wait(50);
  assert.equal(sent.length, 3); const [p, s] = sent[2].body.data; assert.equal(p.event, 'Purchase'); assert.equal(p.event_id, 'cs_9'); assert.equal(p.properties.value, 4.99); assert.equal(p.properties.currency, 'USD'); assert.equal(p.properties.content_id, 'studyhertz_monthly');
  assert.equal(s.event, 'Subscribe'); assert.equal(s.event_id, 'sub_cs_9');
  const logs = []; const lib = require('../lib/tiktok-ads'); assert.equal(lib.create({}).enabled, false);
  const bad = lib.create({ TIKTOK_EVENTS_API_TOKEN: 'tok_hidden' }, { fetch: async () => ({ ok: false, status: 401, json: async () => ({ code: 40001, message: 'bad' }) }), log: m => logs.push(m) });
  assert.equal((await bad.send([{ id: 'x', event: 'Subscribe', url: 'https://x/' }])).sent, false); assert.match(logs[0], /^tiktok-ads: HTTP 401/); assert.ok(!logs[0].includes('tok_hidden'));
});
