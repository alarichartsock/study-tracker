'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server');
const CFG = { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: { monthly: 'price_m', yearly: 'price_y' }, trialDays: 30 };
async function start(stripeFetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-del-')), dataFile = path.join(dir, 'data.json');
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true, baseUrl: 'https://studyhertz.test', billing: CFG, stripeFetch });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { const c = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0]; return { status: r.status, body: await r.json(), setCookie: sc }; }; c.cookie = ''; return c; };
  return { base, client, db: () => new DatabaseSync(path.join(dir, 'data.db'), { readOnly: true }), close: () => new Promise(r => server.close(r)) };
}
const reg = (c, name) => c('/api/register', 'POST', { username: name, password: 'pass-12345', agree: true, birthYear: 1990 });
const rows = (db, uid) => { const n = (t, col = 'user_id') => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = ? OR ${col} = ?`).get(uid, String(uid)).n;
  return { users: n('users', 'id'), tokens: n('tokens', 'uid'), user_data: n('user_data'), sessions: n('sessions'), subjects: n('subjects'), activities: n('activities'), exams: n('exams'), tasks: n('tasks'), subscriptions: n('subscriptions'),
    reports: db.prepare('SELECT data FROM reports').all().filter(r => JSON.parse(r.data).uid === uid).length }; };
const sub = { id: 'sub_9', customer: 'cus_9', status: 'active', items: { data: [{ price: { id: 'price_m' } }] }, current_period_end: 2e9 };

test('self-delete: wrong password refused, then all rows wiped, Stripe canceled, cookie cleared, others kept', async t => {
  const calls = [], ok = j => ({ ok: true, status: 200, json: async () => j });
  const app = await start(async (url, o) => { calls.push(o.method + ' ' + new URL(url).pathname); return ok({ ...sub, status: o.method === 'DELETE' ? 'canceled' : 'active' }); }); t.after(app.close);
  const own = app.client(), amy = app.client(), anon = app.client();
  await reg(own, 'owner'); await reg(amy, 'amy');
  assert.equal((await amy('/api/sessions', 'POST', { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' })).status, 200);
  await amy('/api/exams', 'POST', { name: 'FL1', date: '2026-11-01' }); await amy('/api/tasks', 'POST', { title: 'x' });
  assert.equal((await amy('/api/reports', 'POST', { title: 'Timer bug', description: 'The timer broke when I paused it twice.', page: 'timer' })).status, 200);
  const me = (await amy('/api/me')).body.user; assert.equal(me.hasPassword, true);
  // a webhook-style subscription row for amy
  const raw = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: { ...sub, metadata: { uid: String(me.id) } } } });
  const billing = require('../lib/billing');
  assert.equal((await fetch(app.base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': billing.sign(raw, CFG.webhookSecret) }, body: raw })).status, 200);
  let db = app.db(); const before = rows(db, me.id); db.close();
  assert.ok(before.users && before.tokens && before.sessions && before.exams && before.tasks && before.subscriptions && before.reports, JSON.stringify(before));
  assert.equal((await anon('/api/account/delete', 'POST', { confirm: 'DELETE' })).status, 401);
  assert.equal((await amy('/api/account/delete', 'POST', { confirm: 'nope', password: 'pass-12345' })).status, 400);
  assert.equal((await amy('/api/account/delete', 'POST', { confirm: 'DELETE', password: 'wrong-pass' })).status, 403);
  assert.equal((await amy('/api/me')).body.user.username, 'amy', 'still there after wrong password');
  assert.ok(!calls.some(c => c.startsWith('DELETE')), 'no Stripe call before the password checks out');
  const r = await amy('/api/account/delete', 'POST', { confirm: 'DELETE', password: 'pass-12345' });
  assert.equal(r.status, 200); assert.match(r.setCookie, /sid=;.*Max-Age=0/);
  assert.ok(calls.includes('DELETE /v1/subscriptions/sub_9'));
  db = app.db(); const after = rows(db, me.id); db.close();
  for (const [k, v] of Object.entries(after)) assert.equal(v, 0, k);
  assert.equal((await amy('/api/me')).body.user, null);
  assert.equal((await own('/api/me')).body.user.username, 'owner', 'other users untouched');
  assert.equal((await own('/api/account/delete', 'POST', { confirm: 'DELETE', password: 'pass-12345' })).status, 403, 'admin cannot self-delete');
});

test('admin endpoint: non-admin refused, admin cannot delete itself, admin deletes a user', async t => {
  const app = await start(async () => ({ ok: false, status: 500, json: async () => ({}) })); t.after(app.close);
  const own = app.client(), bob = app.client(), cat = app.client();
  await reg(own, 'owner'); await reg(bob, 'bob'); await reg(cat, 'cat');
  const ids = Object.fromEntries((await own('/api/admin/users')).body.map(u => [u.username, u.id]));
  assert.equal((await bob('/api/admin/users/' + ids.cat + '/delete', 'POST', { confirm: 'cat' })).status, 403);
  assert.equal((await app.client()('/api/admin/users/' + ids.cat + '/delete', 'POST', { confirm: 'cat' })).status, 401);
  assert.equal((await own('/api/admin/users/' + ids.owner + '/delete', 'POST', { confirm: 'owner' })).status, 403);
  assert.equal((await own('/api/admin/users/' + ids.cat + '/delete', 'POST', { confirm: 'wrong' })).status, 400);
  assert.equal((await own('/api/admin/users/' + ids.cat + '/delete', 'POST', { confirm: 'cat' })).status, 200);
  assert.deepEqual((await own('/api/admin/users')).body.map(u => u.username).sort(), ['bob', 'owner']);
  assert.equal((await cat('/api/me')).body.user, null);
});

test('Stripe failure aborts the deletion', async t => {
  const app = await start(async (url, o) => o.method === 'DELETE' ? { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) } : { ok: true, status: 200, json: async () => sub }); t.after(app.close);
  const own = app.client(), dan = app.client(); await reg(own, 'owner'); await reg(dan, 'dan');
  const id = (await dan('/api/me')).body.user.id, billing = require('../lib/billing');
  const raw = JSON.stringify({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { ...sub, metadata: { uid: String(id) } } } });
  await fetch(app.base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': billing.sign(raw, CFG.webhookSecret) }, body: raw });
  const r = await dan('/api/account/delete', 'POST', { confirm: 'DELETE', password: 'pass-12345' });
  assert.equal(r.status, 502); assert.match(r.body.error, /nothing was deleted/);
  assert.equal((await dan('/api/me')).body.user.username, 'dan');
  assert.equal((await own('/api/admin/users/' + id + '/delete', 'POST', { confirm: 'dan' })).status, 502);
  const db = app.db(); assert.equal(rows(db, id).users, 1); db.close();
});
