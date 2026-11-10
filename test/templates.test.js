'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const { Store, DEFAULT_SUBJECTS, DEFAULT_ACTIVITIES } = require('../lib/store');
const T = require('../public/templates.js');
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
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-tpl-')), 'data.json');

test('templates: MCAT is exactly the legacy defaults; every template is well-formed; resolve cleans input', () => {
  const m = T.get('mcat'); assert.deepEqual(m.subjects, DEFAULT_SUBJECTS); assert.deepEqual(m.activities, DEFAULT_ACTIVITIES); assert.deepEqual(m.score, [472, 528]);
  for (const id of ['lsat', 'gre', 'gmat', 'sat', 'act', 'usmle1', 'usmle2', 'dat', 'bar', 'custom']) assert.ok(T.get(id), id);
  assert.deepEqual(T.get('usmle1').subjects, ['Anatomy', 'Behavioral Science', 'Biochemistry', 'Microbiology', 'Pathology', 'Pharmacology', 'Physiology']);
  assert.equal(T.get('usmle1').score, null);
  assert.deepEqual(T.get('usmle2').subjects, ['Medicine', 'Pediatrics', 'Obstetrics & Gynecology', 'Psychiatry', 'Surgery']);
  assert.deepEqual(T.get('usmle2').score, [1, 300]);
  assert.deepEqual(T.get('bar').subjects, ['Contracts', 'Constitutional Law', 'Criminal Law and Procedure', 'Evidence', 'Real Property', 'Torts', 'Civil Procedure', 'MEE', 'MPT']);
  assert.deepEqual(T.get('bar').score, [0, 750]);
  const Color = require('../public/color-clamp.js'), { PALETTE } = require('../lib/store');
  for (const id of ['usmle2', 'bar']) { const cols = T.get(id).subjects.map((_, i) => Color.color(PALETTE[i % PALETTE.length]));
    assert.equal(new Set(cols).size, T.get(id).subjects.length, id + ' colors collide');
    for (const c of cols) { assert.ok(Color.contrast(c, '#ffffff') >= 3, c); assert.ok(Color.contrast(c, '#161920') >= 3, c); } }
  for (const t of T.LIST) { assert.ok(t.activities.length); if (t.score) assert.ok(t.score[0] < t.score[1]); if (t.id !== 'custom') assert.ok(t.subjects.length >= 2, t.id); }
  assert.deepEqual(T.get('lsat').score, [120, 180]);
  assert.deepEqual(T.resolve('custom', [' Algebra ', 'algebra', '', 'Geometry'], []).subjects, ['Algebra', 'Geometry']);
  assert.throws(() => T.resolve('custom', [], []), /at least one subject/); assert.throws(() => T.resolve('nope'), /Unknown/);
  assert.deepEqual(T.resolve('gre').subjects, T.get('gre').subjects);
});

test('signup with a template sets subjects/activities; custom lists; bad template rejected; score scale follows template', async t => {
  const app = await start(tmp()); t.after(app.close);
  const a = app.client(); assert.equal((await a('/api/register', 'POST', { ...L, username: 'boss', email: 'b@example.com' })).status, 200);
  let s = (await a('/api/state')).body; assert.equal(s.template, 'mcat'); assert.deepEqual(s.subjects, DEFAULT_SUBJECTS);
  await a('/api/admin/config', 'POST', { openRegistration: true });
  const b = app.client(); assert.equal((await b('/api/register', 'POST', { ...L, username: 'law', email: 'l@example.com', template: 'lsat' })).status, 200);
  s = (await b('/api/state')).body; assert.equal(s.template, 'lsat'); assert.deepEqual(s.subjects, T.get('lsat').subjects); assert.deepEqual(s.activities, T.get('lsat').activities);
  assert.ok(s.subjects.every(n => /^#[0-9a-f]{6}$/i.test(s.subjectMeta[n].color)));
  assert.equal((await b('/api/exams', 'POST', { name: 'LSAT', date: '2027-01-10', grade: 500 })).status, 400);
  assert.equal((await b('/api/exams', 'POST', { name: 'LSAT', date: '2027-01-10', grade: 170 })).status, 200);
  const c = app.client(); assert.equal((await c('/api/register', 'POST', { ...L, username: 'cus', email: 'c@example.com', template: 'custom' })).status, 400);
  assert.equal((await c('/api/register', 'POST', { ...L, username: 'cus', email: 'c@example.com', template: 'bogus', subjects: ['X'] })).status, 400);
  assert.equal((await c('/api/register', 'POST', { ...L, username: 'cus', email: 'c@example.com', template: 'custom', subjects: ['Organ', 'Theory'], activities: ['Scales'] })).status, 200);
  s = (await c('/api/state')).body; assert.equal(s.template, 'custom'); assert.deepEqual(s.subjects, ['Organ', 'Theory']); assert.deepEqual(s.activities, ['Scales']);
});

test('Step 2 and Bar signup, and switching exams, keep MCAT sessions and practice scores', async t => {
  const app = await start(tmp()); t.after(app.close);
  const a = app.client();
  assert.equal((await a('/api/register', 'POST', { ...L, username: 'boss', email: 'b@example.com', template: 'usmle2' })).status, 200);
  let s = (await a('/api/state')).body;
  assert.equal(s.template, 'usmle2'); assert.deepEqual(s.subjects, T.get('usmle2').subjects);
  assert.ok(s.subjects.every(n => /^#[0-9a-f]{6}$/i.test(s.subjectMeta[n].color)));
  assert.equal((await a('/api/exams', 'POST', { name: 'USMLE Step 2 CK', date: '2027-06-15', grade: 245 })).status, 200);
  assert.equal((await a('/api/exams', 'POST', { name: 'USMLE Step 2 CK', date: '2027-06-16', grade: 301 })).status, 400);
  const b = app.client();
  assert.equal((await b('/api/register', 'POST', { ...L, username: 'mcat', email: 'm@example.com' })).status, 200);
  const sess = await b('/api/sessions', 'POST', { subject: 'CARS', activity: 'Flashcards', start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T16:00:00.000Z' });
  assert.equal(sess.status, 200);
  const px = await b('/api/practice', 'POST', { date: '2026-10-01', cp: 127, cars: 126, bb: 128, ps: 129 });
  assert.equal(px.status, 200); assert.equal(px.body.total, 510);
  const before = (await b('/api/state')).body;
  const sw = await b('/api/template', 'POST', { template: 'bar' });
  assert.equal(sw.status, 200);
  assert.ok(sw.body.subjects.includes('CARS')); assert.ok(sw.body.subjects.includes('MPT')); assert.ok(sw.body.subjects.includes('Contracts'));
  const after = (await b('/api/state')).body;
  assert.equal(after.template, 'bar'); assert.deepEqual(after.sessions, before.sessions); assert.equal(after.practice[0].total, 510); assert.equal(after.practice[0].exam, undefined);
  const ck = await b('/api/practice', 'POST', { date: '2026-10-02', total: 280, mbe: 145 });
  assert.equal(ck.status, 200); assert.equal(ck.body.exam, 'bar'); assert.equal(ck.body.total, 280);
  assert.equal((await b('/api/practice/' + px.body.id, 'PUT', { cars: 127 })).status, 400);
  const back = await b('/api/template', 'POST', { template: 'mcat' });
  assert.equal(back.body.template, 'mcat');
  assert.ok(T.get('mcat').subjects.every(n => back.body.subjects.includes(n)));
  assert.equal((await b('/api/state')).body.practice.find(x => x.id === px.body.id).total, 510);
});

test('switching template keeps subjects/activities with logged time; sessions untouched; activity rename', async t => {
  const app = await start(tmp()); t.after(app.close);
  const a = app.client(); await a('/api/register', 'POST', { ...L, username: 'boss', email: 'b@example.com' });
  const r = await a('/api/sessions', 'POST', { subject: 'CARS', activity: 'Flashcards', start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T16:00:00.000Z' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const before = (await a('/api/state')).body.sessions;
  const sw = await a('/api/template', 'POST', { template: 'gre' }); assert.equal(sw.status, 200);
  assert.deepEqual(sw.body.subjects, [...T.get('gre').subjects, 'CARS']); assert.ok(sw.body.activities.includes('Flashcards')); assert.ok(!sw.body.activities.includes('Content review') || T.get('gre').activities.includes('Content review'));
  const s = (await a('/api/state')).body; assert.deepEqual(s.sessions, before); assert.equal(s.template, 'gre');
  assert.equal((await a('/api/activities', 'PUT', { name: 'Flashcards', rename: 'Anki' })).status, 200);
  assert.equal((await a('/api/state')).body.sessions[0].activity, 'Anki');
  assert.equal((await a('/api/template', 'POST', { template: 'nope' })).status, 400);
});

test('migration: pre-template users become MCAT after a DB backup; data identical; idempotent', () => {
  const file = tmp(), dir = path.dirname(file);
  let st = new Store(file); const u = st.addUser({ username: 'old', salt: 's', hash: 'h' }); const ud = st.data(u.id);
  ud.subjects.push('Extra'); ud.sessions.push({ id: 1, subject: 'CARS', activity: 'Flashcards', start: '2026-01-01T10:00:00.000Z', end: '2026-01-01T11:00:00.000Z' });
  delete ud.template; st.save(); st.close();
  const snap = JSON.parse(JSON.stringify(require('../lib/store').readSnapshot(file).userData[u.id]));
  assert.equal(snap.template, undefined);
  st = new Store(file); const backups = () => fs.readdirSync(dir).filter(f => f.includes('pre-templates-backup'));
  assert.equal(backups().length, 1); assert.equal(st.db.userData[u.id].template, 'mcat');
  const after = st.db.userData[u.id]; assert.deepEqual(after.sessions, snap.sessions); assert.deepEqual(after.subjects, snap.subjects); assert.deepEqual(after.activities, snap.activities);
  st.close();
  const bk = require('../lib/store').readSnapshot(path.join(dir, backups()[0]).replace(/\.db$/, '.json')); assert.equal(bk.userData[u.id].template, undefined); assert.deepEqual(bk.userData[u.id].sessions, snap.sessions);
  st = new Store(file); assert.equal(backups().length, 1); assert.equal(st.migrateTemplates(), null); st.close();
});

test('templates.js is served and precached by the service worker', async t => {
  const app = await start(tmp()); t.after(app.close);
  assert.equal((await app.client()('/templates.js')).status, 200);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /'\/templates\.js'/);
});
