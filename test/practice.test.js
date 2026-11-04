'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const P = require('../public/practice.js'), T = require('../public/templates.js');
const { createApp } = require('../server');
const D = { date: '2026-10-01' };

test('scales and totals per template match the official rules', () => {
  assert.equal(P.clean('gre', { ...D, v: 160, q: 165, awa: 4.5 }).total, 325);
  assert.throws(() => P.clean('gre', { ...D, v: 171, q: 165 }), /Verbal/); assert.throws(() => P.clean('gre', { ...D, v: 160, q: 165, awa: 4.2 }), /AWA/);
  assert.equal(P.clean('sat', { ...D, rw: 700, m: 750 }).total, 1450); assert.throws(() => P.clean('sat', { ...D, rw: 705, m: 750 }), /steps of 10/);
  const a = P.clean('act', { ...D, e: 30, m: 31, r: 29, s: 20 }); assert.equal(a.total, 30); assert.equal(a.stem, 26); // (30+31+29)/3 = 30; STEM (31+20)/2 = 25.5 -> 26
  assert.equal(P.clean('act', { ...D, e: 30, m: 31, r: 30 }).total, 30); assert.equal(P.clean('act', { ...D, e: 31, m: 31, r: 30 }).total, 31); // 30.33 -> 30, 30.67 -> 31
  assert.equal(P.clean('act', { ...D, e: 1, m: 1, r: 1, s: 36 }).total, 1); // science excluded from composite
  assert.equal(P.clean('act', { ...D, e: 30, m: 31, r: 29 }).stem, null);
  assert.equal(P.clean('gmat', { ...D, q: 80, v: 82, di: 79, total: 655 }).total, 655); assert.throws(() => P.clean('gmat', { ...D, q: 80, v: 82, di: 79, total: 650 }), /end in 5/);
  assert.throws(() => P.clean('gmat', { ...D, q: 59, v: 82, di: 79, total: 655 }), /60 to 90/);
  const d = P.clean('dat', { ...D, bio: 420, gc: 400, oc: 410, pat: 500, rc: 430, qr: 390 }); assert.equal(d.total, 410); assert.equal(d.ts, 410); // AA mean 410; PAT excluded
  assert.equal(P.clean('dat', { ...D, bio: 600, gc: 600, oc: 600, pat: 200, rc: 200, qr: 200 }).total, 440); // 2200/5 = 440
  assert.equal(P.clean('lsat', { ...D, lr: 45, total: 165 }).total, 165); assert.equal(P.clean('lsat', { ...D, total: 170 }).rc, null); assert.throws(() => P.clean('lsat', { ...D, total: 119 }), /120 to 180/);
  const u = P.clean('usmle1', { ...D, pct: 72, three: 210 }); assert.equal(u.total, 72); assert.equal(P.SPECS.usmle1.pass.at, 196);
  const cs = P.cleanCustomSections([{ l: 'Theory', min: 0, max: 50 }, { l: '', min: 0, max: 1 }, { l: 'Ear', min: 10, max: 40 }]); assert.equal(cs.length, 2);
  assert.equal(P.clean('custom', { ...D, s1: 40, s2: 30 }, {}, cs).total, 70); assert.throws(() => P.clean('custom', { ...D, s1: 51, s2: 30 }, {}, cs));
  assert.throws(() => P.cleanCustomSections([{ l: 'X', min: 5, max: 5 }]));
  assert.deepEqual(T.get('dat').score, [200, 600]);
  for (const id of ['lsat', 'gre', 'gmat', 'sat', 'act', 'usmle1', 'dat']) { assert.ok(P.SPECS[id] && P.SOURCES[id], id); }
  const s = P.summary([{ id: 1, exam: 'gre', date: '2026-01-01', v: 150, q: 150, total: 300 }, { id: 2, exam: 'gre', date: '2026-02-01', v: 155, q: 160, total: 315 }, { id: 3, date: '2026-03-01', total: 510 }], 'gre');
  assert.equal(s.n, 2); assert.equal(s.change.total.prev, 15); assert.equal(s.change.q.first, 10);
});

test('API: practice exams follow the template; MCAT unchanged; records stay with their template', async t => {
  const server = createApp({ dataFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-px-')), 'data.json'), minSessionSec: 0, quiet: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close()); const base = `http://127.0.0.1:${server.address().port}`; let cookie = '';
  const c = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc && /^sid=/.test(sc)) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => null) }; };
  await c('/api/register', 'POST', { agree: true, birthYear: 1990, username: 'pxu', password: 'pass-12345', email: 'p@example.com' });
  const m = await c('/api/practice', 'POST', { date: '2026-10-01', cp: 128, cars: 127, bb: 129, ps: 130 }); assert.equal(m.status, 200); assert.equal(m.body.total, 514); assert.equal(m.body.exam, undefined);
  assert.equal((await c('/api/template', 'POST', { template: 'act' })).status, 200);
  const a = await c('/api/practice', 'POST', { date: '2026-10-02', e: 30, m: 31, r: 29 }); assert.equal(a.status, 200); assert.equal(a.body.total, 30); assert.equal(a.body.exam, 'act');
  assert.equal((await c('/api/practice', 'POST', { date: '2026-10-02', e: 37, m: 31, r: 29 })).status, 400);
  assert.equal((await c('/api/practice/' + m.body.id, 'PUT', { cp: 127 })).status, 400); // MCAT record not editable as ACT
  assert.equal((await c('/api/practice-goal', 'POST', { goal: 34 })).status, 200); assert.equal((await c('/api/state')).body.settings.practiceGoals.act, 34);
  assert.equal((await c('/api/practice-goal', 'POST', { goal: 40 })).status, 400);
  await c('/api/template', 'POST', { template: 'custom', subjects: ['Theory'] });
  assert.equal((await c('/api/practice', 'POST', { date: '2026-10-03', s1: 5 })).status, 400); // no sections yet
  assert.equal((await c('/api/practice-sections', 'POST', { sections: [{ l: 'Theory', min: 0, max: 50 }, { l: 'Ear', min: 0, max: 50 }] })).status, 200);
  const cu = await c('/api/practice', 'POST', { date: '2026-10-03', s1: 40, s2: 35 }); assert.equal(cu.status, 200); assert.equal(cu.body.total, 75);
  await c('/api/template', 'POST', { template: 'mcat' });
  const st = (await c('/api/state')).body; assert.equal(st.practice.length, 3); assert.equal(st.practice.find(x => x.id === m.body.id).total, 514);
  assert.equal((await c('/api/practice/' + m.body.id, 'PUT', { cp: 127 })).body.total, 513);
});
