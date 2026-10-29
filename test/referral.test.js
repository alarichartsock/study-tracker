'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const billing = require('../lib/billing');
const CFG = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: { monthly: 'price_m', yearly: 'price_y' }, trialDays: 30 };
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ref-')), dataFile = path.join(dir, 'data.json');
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true, baseUrl: 'https://studyhertz.test', billing: CFG, stripeFetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = ''; return async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json() }; }; };
  const hook = async ev => { const raw = JSON.stringify(ev); return fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': billing.sign(raw, CFG.webhookSecret) }, body: raw }); };
  return { client, hook, dataFile, close: () => new Promise(r => server.close(r)) };
}
const reg = (c, name, ref) => c('/api/register', 'POST', { username: name, password: 'pass-12345', agree: true, birthYear: 1990, ...(ref ? { ref } : {}) });
const sess = c => c('/api/sessions', 'POST', { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' });

test('billing.status: trialBonusDays extends the trial', () => {
  const u = { id: 2, created: '2026-10-01T00:00:00Z', billing: { trialBonusDays: 30 } };
  assert.equal(billing.status(u, null, CFG, Date.parse('2026-11-15T00:00:00Z')).trial, true);
  assert.equal(billing.status(u, null, CFG, Date.parse('2026-11-30T00:00:01Z')).readOnly, true);
});

test('referrals: 60-day trial for the friend, +30 days for the referrer after the first session, abuse rules', async t => {
  const app = await start({ referralCap: 2 }); t.after(app.close);
  const own = app.client(), amy = app.client(), anon = app.client();
  await reg(own, 'owner'); await reg(amy, 'amy');
  const rf = (await amy('/api/referral')).body; assert.match(rf.code, /^[A-Z2-9]{8}$/); assert.equal(rf.link, 'https://studyhertz.test/?ref=' + rf.code);
  assert.equal((await amy('/api/referral')).body.code, rf.code, 'code is stable');
  assert.deepEqual((await anon('/api/referral/check?code=' + rf.code)).body, { valid: true, days: 30, trialDays: 60 });
  assert.equal((await anon('/api/referral/check?code=NOPE1234')).body.valid, false);
  assert.equal((await anon('/api/referral')).status, 401);
  // friend signs up with the code -> 60-day trial
  const ben = app.client(); const r = await reg(ben, 'ben', rf.code.toLowerCase()); assert.equal(r.body.referral, true);
  let bb = (await ben('/api/me')).body.billing; assert.equal(bb.trial, true); assert.equal(bb.trialBonusDays, 30); assert.ok(bb.trialDaysLeft >= 59 && bb.trialDaysLeft <= 60, String(bb.trialDaysLeft));
  // bad code: normal 30-day trial, no referral flag
  const cal = app.client(); assert.equal((await reg(cal, 'cal', 'ZZZZZZZZ')).body.referral, undefined); assert.equal((await cal('/api/me')).body.billing.trialDaysLeft, 30);
  // reward only after the friend's first session, and only once
  const before = (await amy('/api/me')).body.billing.trialDaysLeft; assert.equal(before, 30);
  assert.equal((await amy('/api/referral')).body.credits, 0);
  await sess(ben); await sess(ben);
  let ar = (await amy('/api/referral')).body; assert.equal(ar.credits, 1); assert.equal(ar.unseen, 1); assert.equal(ar.invited, 1); assert.equal(ar.daysEarned, 30);
  assert.equal((await amy('/api/me')).body.billing.trialDaysLeft, 60);
  await amy('/api/referral/seen', 'POST'); assert.equal((await amy('/api/referral')).body.unseen, 0);
  // the timer path rewards too; cap of 2 is enforced
  const dan = app.client(), eve = app.client(); await reg(dan, 'dan', rf.code); await reg(eve, 'eve', rf.code);
  await dan('/api/timer/start', 'POST', { subject: 'CARS' }); await dan('/api/timer/stop', 'POST', {});
  await sess(eve);
  ar = (await amy('/api/referral')).body; assert.equal(ar.credits, 2, 'capped at 2'); assert.equal(ar.invited, 3);
  assert.equal((await eve('/api/me')).body.billing.trialBonusDays, 30, 'friend still gets the 60-day trial after the cap');
});

test('referrals: expired referrer is revived; subscriber credit is recorded for Stripe, not auto-applied', async t => {
  const app = await start({ billing: { ...CFG, trialDays: 0 } }); t.after(app.close);
  const own = app.client(), amy = app.client(), ben = app.client(), sub = app.client();
  await reg(own, 'owner'); await reg(amy, 'amy'); await reg(sub, 'sue');
  assert.equal((await amy('/api/me')).body.billing.readOnly, true);
  const code = (await amy('/api/referral')).body.code;
  await reg(ben, 'ben', code); assert.equal((await ben('/api/me')).body.billing.trial, true, 'friend: 0 + 30 bonus days');
  assert.equal((await sess(ben)).status, 200);
  const am = (await amy('/api/me')).body.billing; assert.equal(am.trial, true); assert.equal(am.trialDaysLeft, 30, 'expired referrer gets 30 days from now');
  // subscriber referrer
  await app.hook({ id: 'evt_s', type: 'customer.subscription.updated', livemode: false, data: { object: { id: 'sub_9', customer: 'cus_9', status: 'active', metadata: { uid: '3' }, items: { data: [{ price: { id: 'price_m' }, current_period_end: 1830000000 }] } } } });
  assert.equal((await sub('/api/me')).body.billing.subscribed, true);
  const sc = (await sub('/api/referral')).body.code, fr = app.client(); await reg(fr, 'fran', sc); await sess(fr);
  const sr = (await sub('/api/referral')).body; assert.equal(sr.credits, 1); assert.equal(sr.pendingStripe, 1);
});

