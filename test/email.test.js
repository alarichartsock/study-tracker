'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
async function start(dataFile) {
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { const c = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc && /^sid=/.test(sc)) c.cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => null) }; }; c.cookie = ''; return c; };
  return { client, close: () => new Promise(r => server.close(r)) };
}
const L = { agree: true, birthYear: 1990, password: 'pass-12345' };

test('sign-up requires a valid, unique (case-insensitive) email; it is normalized, stored unverified and persists', async t => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-email-')), 'data.json');
  let app = await start(dataFile);
  const a = app.client();
  assert.equal((await a('/api/register', 'POST', { ...L, username: 'boss' })).status, 400);
  const bad = await a('/api/register', 'POST', { ...L, username: 'boss', email: 'not-an-email' }); assert.equal(bad.status, 400); assert.equal(bad.body.error, 'Enter a valid email address');
  const ok = await a('/api/register', 'POST', { ...L, username: 'boss', email: '  Boss@Example.COM ' }); assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'boss@example.com'); assert.equal(ok.body.user.emailVerified, false);
  await a('/api/admin/config', 'POST', { openRegistration: true });
  const b = app.client();
  const dup = await b('/api/register', 'POST', { ...L, username: 'other', email: 'BOSS@example.com' }); assert.equal(dup.status, 409); assert.match(dup.body.error, /already used/);
  assert.equal((await b('/api/register', 'POST', { ...L, username: 'boss', email: 'new@example.com' })).status, 409); // username taken
  assert.equal((await b('/api/register', 'POST', { ...L, username: 'other', email: 'other@example.com' })).status, 200);
  // change email: needs the current password once one is on file; uniqueness enforced
  assert.equal((await b('/api/account/email', 'POST', { email: 'x2@example.com' })).status, 403);
  assert.equal((await b('/api/account/email', 'POST', { email: 'boss@example.com', password: L.password })).status, 409);
  assert.equal((await b('/api/account/email', 'POST', { email: 'bad', password: L.password })).status, 400);
  const ch = await b('/api/account/email', 'POST', { email: 'X2@Example.com', password: L.password }); assert.equal(ch.status, 200); assert.equal(ch.body.user.email, 'x2@example.com');
  const us = await a('/api/admin/usage'); assert.equal(us.status, 200); assert.ok(us.body.users.every(u => u.hasEmail === true)); assert.ok(!JSON.stringify(us.body).includes('@example.com'));
  assert.equal((await b('/api/admin/usage')).status, 403);
  await app.close();
  app = await start(dataFile); t.after(app.close);
  const c = app.client(); assert.equal((await c('/api/login', 'POST', { username: 'other', password: L.password })).status, 200);
  assert.equal((await c('/api/me')).body.user.email, 'x2@example.com');
  assert.equal((await app.client()('/api/account/email', 'POST', { email: 'a@b.co' })).status, 401);
});
