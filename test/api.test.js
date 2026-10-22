'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');

async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcat-')), dataFile = path.join(dir, 'data.json');
  if (opts.seed) fs.writeFileSync(dataFile, JSON.stringify(opts.seed));
  const server = createApp({ dataFile, minSessionSec: 0, ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (p, method = 'GET', body) => {
      const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
      const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
      return { status: r.status, body: json, headers: r.headers };
    };
  };
  return { server, base, client, dataFile, dir, close: () => new Promise(r => server.close(r)) };
}

test('auth flow, admin, registration lock, isolation, logout', async t => {
  const app = await start(); t.after(app.close);
  const a = app.client(), b = app.client(), anon = app.client();
  assert.deepEqual((await anon('/api/me')).body, { user: null, needsSetup: true, registrationOpen: true });
  assert.equal((await anon('/api/state')).status, 401);
  assert.equal((await a('/api/register', 'POST', { username: 'al', password: '12345678' })).status, 400);
  assert.equal((await a('/api/register', 'POST', { username: 'alaric', password: 'short' })).status, 400);
  const r = await a('/api/register', 'POST', { username: 'alaric', password: 'secret-pass-1' });
  assert.equal(r.status, 200); assert.equal(r.body.user.admin, true);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/); assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
  // password is not stored in plaintext
  const raw = fs.readFileSync(app.dataFile, 'utf8'); assert.ok(!raw.includes('secret-pass-1')); assert.ok(!raw.includes(r.headers.get('set-cookie').split(';')[0].slice(4)));
  // registration closed by default after first user
  assert.equal((await b('/api/register', 'POST', { username: 'bob', password: '12345678' })).status, 403);
  assert.equal((await b('/api/admin/config', 'POST', { openRegistration: true })).status, 401);
  assert.equal((await a('/api/admin/config', 'POST', { openRegistration: true })).body.openRegistration, true);
  assert.equal((await b('/api/register', 'POST', { username: 'alaric', password: '12345678' })).status, 409);
  const rb = await b('/api/register', 'POST', { username: 'bob', password: '12345678' });
  assert.equal(rb.body.user.admin, false); assert.equal((await b('/api/admin/users')).status, 403);
  // isolation
  await a('/api/sessions', 'POST', { subject: 'CARS', start: '2026-10-20T16:00:00Z', end: '2026-10-20T17:00:00Z' });
  await a('/api/settings', 'POST', { dailyGoalMin: 240, busyIp: '10.0.0.5', busyToken: 'tok' });
  await a('/api/subjects', 'POST', { name: 'Anki' });
  const sb = (await b('/api/state')).body;
  assert.equal(sb.sessions.length, 0); assert.equal(sb.settings.dailyGoalMin, 360); assert.equal(sb.settings.busyIp, ''); assert.ok(!sb.subjects.includes('Anki'));
  const sa = (await a('/api/state')).body;
  assert.equal(sa.sessions.length, 1); assert.equal(sa.settings.busyToken, '********'); assert.ok(sa.subjects.includes('Anki'));
  assert.equal((await b('/api/sessions/' + sa.sessions[0].id, 'DELETE')).status, 404);
  // login / logout
  const a2 = app.client();
  assert.equal((await a2('/api/login', 'POST', { username: 'alaric', password: 'nope-nope' })).status, 401);
  assert.equal((await a2('/api/login', 'POST', { username: 'ALARIC', password: 'secret-pass-1' })).status, 200);
  assert.equal((await a2('/api/me')).body.user.username, 'alaric');
  assert.equal((await a2('/api/logout', 'POST')).status, 200);
  assert.equal((await a2('/api/state')).status, 401);
  assert.equal((await a('/api/state')).status, 200); // other session unaffected
});

test('login rate limiting returns 429', async t => {
  const app = await start({ userMaxAttempts: 3 }); t.after(app.close);
  const c = app.client();
  await c('/api/register', 'POST', { username: 'alaric', password: 'secret-pass-1' });
  for (let i = 0; i < 3; i++) assert.equal((await c('/api/login', 'POST', { username: 'alaric', password: 'bad-pass' })).status, 401);
  assert.equal((await c('/api/login', 'POST', { username: 'alaric', password: 'secret-pass-1' })).status, 429);
});

test('timer, sessions CRUD, stats, import/export, busy bar calls', async t => {
  const calls = [];
  const app = await start({ fetch: async (url, o) => { calls.push({ url, ...o }); return { ok: true }; } }); t.after(app.close);
  const c = app.client();
  await c('/api/register', 'POST', { username: 'alaric', password: 'secret-pass-1' });
  assert.equal((await c('/api/timer/stop', 'POST', {})).status, 409);
  await c('/api/timer/start', 'POST', { subject: 'CARS', note: 'p1' });
  assert.equal(calls.length, 0); // busy bar not configured -> no call
  assert.equal((await c('/api/timer/pause', 'POST')).body.paused, true);
  await c('/api/timer/start', 'POST', {});
  const stop = await c('/api/timer/stop', 'POST', { note: 'done' });
  assert.equal(stop.body.session.subject, 'CARS'); assert.equal(stop.body.session.note, 'done');
  assert.equal((await c('/api/sessions', 'POST', { subject: 'X', start: '2026-10-20T17:00:00Z', end: '2026-10-20T16:00:00Z' })).status, 400);
  const s = (await c('/api/sessions', 'POST', { subject: 'Bio/Biochem', start: new Date(Date.now() - 3600e3).toISOString(), end: new Date().toISOString() })).body;
  assert.equal((await c('/api/sessions/' + s.id, 'PUT', { subject: 'Psych/Soc', note: 'edited', start: s.start, end: s.end })).status, 200);
  let st = (await c('/api/stats')).body; assert.ok(st.today >= 3599); assert.ok(st.bySubject.week['Psych/Soc'] >= 3599); assert.equal(st.streak, 1);
  assert.equal((await c('/api/sessions/' + s.id, 'DELETE')).status, 200);
  assert.equal((await c('/api/sessions')).body.length, 1);
  const imp = (await c('/api/import', 'POST', { csv: 'Date,Start,End,Category\n2026-10-01,09:00,10:00,Anki\n2026-10-02,09:00,,CARS' })).body;
  assert.equal(imp.added, 1); assert.equal(imp.skipped, 1); assert.ok((await c('/api/state')).body.subjects.includes('Anki'));
  const ex = await c('/api/export.csv'); assert.match(ex.headers.get('content-type'), /text\/csv/); assert.match(ex.body, /Anki/);
  assert.equal((await c('/api/import', 'POST', 'x')).status, 400);
  // busy bar
  await c('/api/settings', 'POST', { busyIp: 'http://192.168.0.50/', busyToken: 'secret' });
  await c('/api/timer/start', 'POST', { subject: 'CARS' }); await c('/api/timer/stop', 'POST', {});
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls[0].url, 'http://192.168.0.50/api/display/draw'); assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['X-API-Token'], 'secret'); assert.equal(JSON.parse(calls[0].body).app_id, 'mcat');
  assert.equal(calls[1].method, 'DELETE');
  assert.equal((await c('/api/settings', 'POST', { busyToken: '********' })).status, 200);
  assert.equal(app.server.store.data(1).settings.busyToken, 'secret'); // masked value doesn't overwrite
});

test('busy bar failures are silent', async t => {
  const app = await start({ fetch: async () => { throw new Error('unreachable'); } }); t.after(app.close);
  const c = app.client();
  await c('/api/register', 'POST', { username: 'alaric', password: 'secret-pass-1' });
  await c('/api/settings', 'POST', { busyIp: '192.0.2.1' });
  assert.equal((await c('/api/timer/start', 'POST', { subject: 'CARS' })).status, 200);
  assert.deepEqual((await c('/api/busybar/test', 'POST')).body, { ok: false });
});

test('legacy v1 data.json is migrated to the first (admin) user with a backup', async t => {
  const seed = { sessions: [{ id: 1, subject: 'CARS', note: 'old', start: '2026-10-01T16:00:00.000Z', end: '2026-10-01T17:00:00.000Z' }], subjects: ['CARS', 'Custom'], settings: { dailyGoalMin: 300, busyIp: '', busyToken: '' }, active: null, nextId: 2 };
  const app = await start({ seed }); t.after(app.close);
  assert.ok(fs.existsSync(path.join(app.dir, 'data.v1-backup.json')));
  const c = app.client();
  await c('/api/register', 'POST', { username: 'alaric', password: 'secret-pass-1' });
  const s = (await c('/api/state')).body;
  assert.equal(s.sessions[0].note, 'old'); assert.deepEqual(s.subjects, ['CARS', 'Custom']); assert.equal(s.settings.dailyGoalMin, 300);
  assert.equal(JSON.parse(fs.readFileSync(app.dataFile, 'utf8')).version, 2);
});

test('static UI and JSON content-type guard', async t => {
  const app = await start(); t.after(app.close);
  const r = await fetch(app.base + '/'); assert.equal(r.status, 200); assert.match(await r.text(), /MCAT Tracker/);
  assert.equal((await fetch(app.base + '/app.js')).status, 200); assert.equal((await fetch(app.base + '/style.css')).status, 200);
  assert.equal((await fetch(app.base + '/../server.js')).status, 404);
  const f = await fetch(app.base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"username":"x"}' });
  assert.equal(f.status, 415);
});
