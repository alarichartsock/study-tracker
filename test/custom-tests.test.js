'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server.js'); const P = require('../public/practice.js');
async function start() { const app = createApp({ dataFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-')), 'data.json'), quiet: true, minSessionSec: 0 });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.address().port;
  const client = () => { let ck = ''; return async (p, m = 'GET', b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; }; };
  return { app, client, close: () => app.close() }; }
const reg = (c, u, template) => c('/api/register', 'POST', { agree: true, birthYear: 1990, username: u, password: 'pass-12345', email: u + '@example.com', template });

test('practice providers: every built-in template has a verified source list', () => {
  for (const id of ['lsat', 'gre', 'gmat', 'sat', 'act', 'usmle1', 'usmle2', 'bar', 'dat']) assert.ok(P.PROVIDERS[id].length >= 4, id);
  assert.ok(P.PROVIDERS.gmat.includes('GMAT Official Practice Exam 6')); assert.ok(P.PROVIDERS.sat.includes('Bluebook Practice Test 11')); assert.ok(!P.PROVIDERS.sat.includes('Bluebook Practice Test 1'));
  assert.ok(P.PROVIDERS.usmle1.includes('NBME CBSSA 34')); assert.ok(P.PROVIDERS.gre.includes('POWERPREP PLUS Test 3'));
});

test('custom tests: sum / avg / none rules, keys kept on edit, validation', () => {
  const T = P.cleanTests([{ name: ' Orgo  final ', total: 'avg', sections: [{ l: 'A', min: 0, max: 50 }, { l: 'B', min: 0, max: 50 }] }, { name: '', sections: [] }, { name: 'Quiz', total: 'weird', sections: [{ l: 'Q', min: 0, max: 10 }] }], []);
  assert.equal(T.length, 2); assert.equal(T[0].name, 'Orgo final'); assert.equal(T[0].id, 'ct_1'); assert.equal(T[1].total, 'sum');
  assert.equal(P.clean('ct_1', { date: '2026-11-01', s1: 40, s2: 45 }, {}, null, T).total, 42.5);
  assert.throws(() => P.clean('ct_1', { date: '2026-11-01', s1: 51, s2: 1 }, {}, null, T), /A must be from 0 to 50/);
  const T2 = P.cleanTests([{ id: 'ct_1', name: 'Orgo', total: 'none', sections: [{ k: 's2', l: 'B', min: 0, max: 50 }] }], T); assert.equal(T2[0].id, 'ct_1'); assert.equal(T2[0].sections[0].k, 's2');
  assert.equal(P.clean('ct_1', { date: '2026-11-01', s2: 3 }, {}, null, T2).total, null); assert.throws(() => P.cleanGoal('ct_1', 5, null, T2), /no total/);
  assert.throws(() => P.cleanTests([{ name: 'X', sections: [] }], []), /at least one section/);
});

test('custom tests over the API on the MCAT template: MCAT records untouched, goal, exam date range, delete removes scores', async t => {
  const s = await start(); t.after(s.close); const own = s.client(); await reg(own, 'owner'); await own('/api/admin/config', 'POST', { openRegistration: true });
  const a = s.client(); assert.equal((await reg(a, 'amy', 'mcat')).status, 200);
  assert.equal((await a('/api/practice', 'POST', { date: '2026-10-01', source: 'AAMC FL1', cp: 125, cars: 126, bb: 127, ps: 128 })).status, 200);
  const r = await a('/api/practice-tests', 'POST', { tests: [{ name: 'Physics midterm', total: 'sum', sections: [{ l: 'MC', min: 0, max: 60 }, { l: 'FR', min: 0, max: 40 }] }] }); assert.equal(r.status, 200); const id = r.body.tests[0].id;
  const x = await a('/api/practice', 'POST', { exam: id, date: '2026-10-02', source: 'Prof practice', s1: 50, s2: 30 }); assert.equal(x.status, 200);
  assert.equal((await a('/api/practice', 'POST', { exam: 'ct_99', date: '2026-10-02', s1: 1 })).status, 400);
  assert.equal((await a('/api/practice-goal', 'POST', { exam: id, goal: 90 })).status, 200); assert.equal((await a('/api/practice-goal', 'POST', { exam: id, goal: 101 })).status, 400);
  assert.equal((await a('/api/practice-goal', 'POST', { goal: 515 })).status, 200); // MCAT goal path unchanged
  assert.equal((await a('/api/exams', 'POST', { name: 'Physics midterm', date: '2026-12-01', test: id, grade: 99 })).status, 200);
  assert.equal((await a('/api/exams', 'POST', { name: 'Physics midterm', date: '2026-12-01', test: id, grade: 101 })).status, 400);
  assert.equal((await a('/api/exams', 'POST', { name: 'MCAT', date: '2027-01-10', grade: 515 })).status, 200);
  let ud = s.app.store.data(s.app.store.db.users.find(u => u.username === 'amy').id);
  assert.equal(ud.practice.length, 2); assert.equal(ud.practice.find(p => !p.exam).total, 506); assert.equal(ud.practice.find(p => p.exam === id).total, 80);
  assert.equal(ud.settings.practiceGoals[id], 90); assert.equal(ud.settings.mcatGoal, 515); assert.equal(ud.exams.find(e => e.test === id).grade, 99);
  assert.equal((await a('/api/practice-tests', 'POST', { tests: [] })).status, 200);
  ud = s.app.store.data(s.app.store.db.users.find(u => u.username === 'amy').id);
  assert.equal(ud.practice.length, 1); assert.ok(!ud.practice[0].exam); assert.equal(ud.exams.length, 2); assert.ok(ud.exams.every(e => !e.test)); assert.equal(ud.settings.practiceGoals[id], undefined);
});
