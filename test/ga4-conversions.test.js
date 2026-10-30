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

const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('every homepage CTA has a unique cta_id; pricing CTAs carry their plan', () => {
  const h = pub('index.html'), ids = [...h.matchAll(/data-cta="([a-z]+)" data-cta-id="([a-z_]+)"/g)].map(m => m[2]);
  assert.deepEqual(ids.sort(), ['final_trial', 'header_trial', 'hero_trial', 'how_trial', 'mid_trial', 'pricing_lifetime', 'pricing_monthly', 'pricing_yearly', 'tour_trial']);
  assert.equal((h.match(/data-cta="/g) || []).length, ids.length, 'no CTA without an id');
  for (const p of ['monthly', 'yearly', 'lifetime']) assert.match(h, new RegExp(`data-cta-id="pricing_${p}" data-plan="${p}"`));
  const a = pub('app.js');
  for (const ev of ["'sign_up', { method: m }", "'trial_start'", "'login', { method: 'email' }", "'generate_lead'", "viewList('pricing'", "viewList('paywall'", 'selectItem(', 'identify(ME.id']) assert.ok(a.includes(ev), ev);
  assert.ok(!a.includes('begin_trial'), 'old event name gone');
});

function consentSandbox(store = { adsConsent: 'denied' }) {
  const events = [], ls = { ...store }, ss = {};
  const mkSt = o => ({ getItem: k => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); } });
  const win = { dataLayer: [], location: { href: 'https://studyhertz.com/?utm_source=google&utm_medium=cpc&utm_campaign=mcat&gclid=abc', pathname: '/' } };
  const ctx = { window: win, location: win.location, navigator: {}, localStorage: mkSt(ls), sessionStorage: mkSt(ss), URL, JSON, setTimeout, Promise,
    document: { readyState: 'complete', head: { appendChild() {} }, createElement: () => ({}), getElementById: () => null, addEventListener() {}, body: { appendChild() {} } },
    fetch: async () => ({ json: async () => ({ gaId: 'G-T' }) }) };
  vm.createContext(ctx); vm.runInContext(pub('consent.js'), ctx);
  win.dataLayer.push = a => events.push([...a]);
  return { S: win.SHConsent, events, ls };
}
const tick = () => new Promise(r => setTimeout(r, 10));

test('view_item_list fires once per list, select_item and identify carry the right params, first touch includes gclid', async () => {
  const { S, events, ls } = consentSandbox();
  assert.match(ls.shFirstTouch, /"gclid":"abc"/);
  S.viewList('pricing'); S.viewList('pricing'); S.selectItem('yearly', 'pricing'); S.identify(7, { plan: 'trial', language: 'es', bad: 'a@b.c' }); S.identify(7, { plan: 'trial' });
  S.ecommerce('begin_checkout', { plan: 'yearly', value: 39 }); await tick();
  const ev = n => events.filter(e => e[0] === 'event' && e[1] === n);
  assert.equal(ev('view_item_list').length, 1, 'no double firing');
  assert.equal(ev('view_item_list')[0][2].items.length, 3);
  const si = ev('select_item')[0][2]; assert.equal(si.items[0].item_id, 'studyhertz_yearly'); assert.equal(si.first_source, 'google'); assert.equal(si.first_click, 'gclid');
  const cfgUid = events.filter(e => e[0] === 'config' && e[2] && e[2].user_id); assert.equal(cfgUid.length, 1); assert.equal(cfgUid[0][2].user_id, 'u7');
  const up = events.find(e => e[0] === 'set' && e[1] === 'user_properties'); assert.deepEqual({ ...up[2] }, { plan: 'trial', language: 'es' });
  assert.equal(ev('begin_checkout')[0][2].first_campaign, 'mcat');
});

test('first-touch attribution is stored once on the user and carried on the server-side purchase', async t => {
  const mp = []; const app = await start({ gaApiSecret: 'sec_x', mpFetch: async (url, o) => { mp.push(JSON.parse(o.body)); return { ok: true, status: 204 }; } }); t.after(app.close);
  const own = app.client(), bob = app.client(); await reg(own, 'owner'); await reg(bob, 'bob');
  assert.equal((await bob('/api/attribution', 'POST', { utm_source: 'facebook', utm_campaign: 'fall', fbclid: 'fb1', evil: 'x', utm_medium: 'me@x.com' })).status, 200);
  await bob('/api/attribution', 'POST', { utm_source: 'later' }); // first touch wins
  await bob('/api/billing/checkout', 'POST', { plan: 'monthly', gaCid: '123.456' });
  await app.hook(done({ uid: '2', plan: 'monthly', ga_cid: '123.456' }));
  assert.equal(mp.length, 1); assert.equal(mp[0].user_id, 'u2');
  const p = mp[0].events[0].params; assert.equal(p.campaign_source, 'facebook'); assert.equal(p.campaign_name, 'fall'); assert.equal(p.first_click, 'fbclid'); assert.equal(p.campaign_medium, undefined);
});
