'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const MCAT = require('../public/mcat.js');

test('MCAT percentile tables match AAMC 2026-27 spot values', () => {
  assert.equal(MCAT.TOTAL.length, 57); for (const k of ['cp', 'cars', 'bb', 'ps']) assert.equal(MCAT.SECTION[k].length, 15);
  assert.equal(MCAT.pctTotal(472), 0); assert.equal(MCAT.fmtPct(MCAT.pctTotal(472)), '<1'); assert.equal(MCAT.pctTotal(500), 48); assert.equal(MCAT.pctTotal(508), 74); assert.equal(MCAT.pctTotal(528), 100);
  assert.equal(MCAT.pctSection('cp', 125), 56); assert.equal(MCAT.pctSection('cars', 125), 62); assert.equal(MCAT.pctSection('bb', 125), 53); assert.equal(MCAT.pctSection('ps', 125), 44);
  assert.equal(MCAT.pctTotal(471), null); assert.equal(MCAT.pctSection('cp', 133), null); assert.equal(MCAT.pctTotal(500.5), null);
  for (const t of [MCAT.TOTAL, ...Object.values(MCAT.SECTION)]) for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1]);
});

test('cleanPractice validates and totals; summary computes changes', () => {
  assert.throws(() => MCAT.cleanPractice({ date: '2026-10-01', cp: 117, cars: 125, bb: 125, ps: 125 }), /C\/P/);
  assert.throws(() => MCAT.cleanPractice({ date: 'bad', cp: 125, cars: 125, bb: 125, ps: 125 }), /date/);
  assert.throws(() => MCAT.cleanPractice({ date: '2026-10-01', cp: 125.5, cars: 125, bb: 125, ps: 125 }));
  const a = MCAT.cleanPractice({ date: '2026-09-01', source: ' AAMC FL1 ', cp: '124', cars: 123, bb: 125, ps: 126 });
  assert.equal(a.total, 498); assert.equal(a.source, 'AAMC FL1');
  const s = MCAT.summary([{ id: 2, ...MCAT.cleanPractice({ date: '2026-10-01', cp: 128, cars: 126, bb: 128, ps: 129 }) }, { id: 1, ...a }, { id: 3, ...MCAT.cleanPractice({ date: '2026-09-15', cp: 129, cars: 127, bb: 129, ps: 130 }) }]);
  assert.equal(s.last.total, 511); assert.equal(s.best.total, 515); assert.equal(s.change.total.prev, -4); assert.equal(s.change.total.first, 13); assert.equal(s.change.cars.first, 3);
  assert.equal(MCAT.cleanGoal(''), null); assert.equal(MCAT.cleanGoal('515'), 515); assert.throws(() => MCAT.cleanGoal(530));
});

test('practice exam API: CRUD, validation, isolation, goal', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcat-px-')), server = createApp({ dataFile: path.join(dir, 'data.json'), minSessionSec: 0 });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = ''; return async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json() }; }; };
  const a = client(), b = client(), anon = client();
  await a('/api/register', 'POST', { agree: true, birthYear: 1990, username: 'alice', password: 'password123' });
  await a('/api/admin/registration', 'POST', { open: true }).catch(() => {});
  assert.equal((await anon('/api/practice')).status, 401);
  assert.equal((await a('/api/practice', 'POST', { date: '2026-10-01', cp: 140, cars: 125, bb: 125, ps: 125 })).status, 400);
  assert.equal((await a('/api/practice', 'POST', { date: '2026-10-01', cars: 125, bb: 125, ps: 125 })).status, 400);
  const r = await a('/api/practice', 'POST', { date: '2026-10-01', source: 'AAMC FL1', cp: 127, cars: 126, bb: 128, ps: 129, total: 999, notes: 'timing ok' });
  assert.equal(r.status, 200); assert.equal(r.body.total, 510); assert.ok(r.body.id);
  const up = await a('/api/practice/' + r.body.id, 'PUT', { cars: 128 }); assert.equal(up.body.total, 512); assert.equal(up.body.source, 'AAMC FL1');
  assert.equal((await a('/api/practice/' + r.body.id, 'PUT', { ps: 'x' })).status, 400);
  assert.equal((await a('/api/practice')).body.length, 1);
  assert.equal((await a('/api/state')).body.practice.length, 1);
  const bReg = await b('/api/register', 'POST', { agree: true, birthYear: 1990, username: 'bobby', password: 'password123' });
  if (bReg.status === 200) { assert.equal((await b('/api/practice')).body.length, 0); assert.equal((await b('/api/practice/' + r.body.id, 'DELETE')).status, 404); }
  assert.equal((await a('/api/practice-goal', 'POST', { goal: 600 })).status, 400);
  assert.equal((await a('/api/practice-goal', 'POST', { goal: '515' })).body.goal, 515);
  assert.equal((await a('/api/state')).body.settings.mcatGoal, 515);
  assert.equal((await a('/api/practice-goal', 'POST', { goal: '' })).body.goal, null);
  assert.equal((await a('/api/practice/' + r.body.id, 'DELETE')).status, 200);
  assert.equal((await a('/api/practice')).body.length, 0);
});
