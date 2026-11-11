'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { createApp } = require('../server');
const { Store } = require('../lib/store');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcat-')), dataFile = path.join(dir, 'data.json');
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = '';
    return async (p, method = 'GET', body) => {
      const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
      const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
      return { status: r.status, body: json };
    }; };
  const admin = client();
  await admin('/api/register', 'POST', { email: 'sched@example.com', agree: true, birthYear: 1990, username: 'alaric', password: 'secret-pass-1' });
  await admin('/api/admin/config', 'POST', { openRegistration: true });
  return { admin, client, close: () => new Promise(r => server.close(r)) };
}
const reg = (c, username, template) => c('/api/register', 'POST', { email: username + '@example.com', agree: true, birthYear: 1990, username, password: 'pass-12345', ...(template ? { template } : {}) });

test('scheduled exam drops its score, stays out of the way, and can be scored later', async t => {
  const app = await start(); t.after(app.close); const c = app.admin;
  const plain = (await c('/api/exams', 'POST', { name: 'AAMC FL1', date: '2026-08-01', grade: 512 })).body;
  assert.equal(plain.scheduled, false); assert.equal(plain.grade, 512);
  const fut = (await c('/api/exams', 'POST', { name: 'MCAT', date: '2027-05-01', grade: 500, scheduled: true })).body;
  assert.equal(fut.scheduled, true); assert.equal(fut.grade, null);
  const kept = (await c('/api/exams/' + fut.id, 'PUT', { notes: 'sitting' })).body;
  assert.equal(kept.scheduled, true); assert.equal(kept.grade, null); assert.equal(kept.notes, 'sitting');
  const scored = (await c('/api/exams/' + fut.id, 'PUT', { scheduled: false, grade: 518 })).body;
  assert.equal(scored.scheduled, false); assert.equal(scored.grade, 518); assert.equal(scored.notes, 'sitting');
  const again = (await c('/api/exams/' + scored.id, 'PUT', { scheduled: true, grade: 520 })).body;
  assert.equal(again.scheduled, true); assert.equal(again.grade, null);
  const on = (await c('/api/exams', 'POST', { name: 'FL2', date: '2027-02-02', scheduled: 'true', grade: 510 })).body;
  assert.equal(on.scheduled, true); assert.equal(on.grade, null);
  const off = (await c('/api/exams', 'POST', { name: 'FL3', date: '2026-06-01', scheduled: 'false', grade: 505 })).body;
  assert.equal(off.scheduled, false); assert.equal(off.grade, 505);
  const listed = (await c('/api/state')).body.exams;
  assert.equal(listed.find(e => e.id === again.id).scheduled, true);
  assert.equal(listed.find(e => e.id === again.id).grade, null);
  const exp = await c('/api/export.json');
  assert.equal(exp.body.data.exams.find(e => e.id === again.id).scheduled, true);
  const bob = app.client(); assert.equal((await reg(bob, 'bob')).status, 200);
  assert.equal((await bob('/api/import.json', 'POST', { data: { exams: [{ name: 'FL old', date: '2026-01-15', grade: 505 }, { name: 'MCAT later', date: '2027-04-01', grade: 500, scheduled: true }] } })).status, 200);
  const imported = (await bob('/api/state')).body.exams;
  const old = imported.find(e => e.name === 'FL old'), later = imported.find(e => e.name === 'MCAT later');
  assert.equal(old.scheduled, false); assert.equal(old.grade, 505);
  assert.equal(later.scheduled, true); assert.equal(later.grade, null);
});

test('scheduled flag clears the score on Step 2 CK, Step 1, and the Bar', async t => {
  const app = await start(); t.after(app.close);
  const step2 = app.client(); assert.equal((await reg(step2, 'step2', 'usmle2')).status, 200);
  const ck = (await step2('/api/exams', 'POST', { name: 'USMLE Step 2 CK', date: '2027-06-15', grade: 245, scheduled: true })).body;
  assert.equal(ck.scheduled, true); assert.equal(ck.grade, null);
  assert.equal((await step2('/api/exams/' + ck.id, 'PUT', { scheduled: false, grade: 251 })).body.grade, 251);
  const step1 = app.client(); assert.equal((await reg(step1, 'step1', 'usmle1')).status, 200);
  const s1 = (await step1('/api/exams', 'POST', { name: 'USMLE Step 1', date: '2027-03-01', grade: 70, scheduled: true })).body;
  assert.equal(s1.scheduled, true); assert.equal(s1.grade, null);
  const bar = app.client(); assert.equal((await reg(bar, 'bar', 'bar')).status, 200);
  const bx = (await bar('/api/exams', 'POST', { name: 'Bar Exam', date: '2027-07-28', grade: 280, scheduled: true })).body;
  assert.equal(bx.scheduled, true); assert.equal(bx.grade, null);
  assert.equal((await bar('/api/exams/' + bx.id, 'PUT', { scheduled: false, grade: 266 })).body.grade, 266);
});

test('existing exams default scheduled to false and the flag round-trips', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sched-')), 'data.json');
  const s = new Store(f); s.addUser({ username: 'a', salt: 's', hash: 'h' });
  s.data(1).exams.push({ id: 1, name: 'MCAT', date: '2026-09-01', grade: 510 }); s.save(); s.close();
  const s2 = new Store(f), raw = s2.db.userData[1].exams[0];
  assert.equal(raw.grade, 510); assert.equal(raw.scheduled, undefined);
  const seen = s2.data(1).exams[0];
  assert.equal(seen.scheduled, false); assert.equal(seen.grade, 510);
  seen.scheduled = true; seen.grade = null; s2.save(); s2.close();
  const s3 = new Store(f), back = s3.db.userData[1].exams[0];
  assert.equal(back.scheduled, true); assert.equal(back.grade, null); s3.close();
});

test('exam list ignores a scheduled score and the dialog can grey the score box', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const start = js.indexOf('const examCountsScore'), end = js.indexOf('VIEWS.plan');
  const ctx = { daysUntil: () => 0, esc: s => String(s) }; vm.createContext(ctx);
  vm.runInContext(js.slice(start, end) + '\nthis.examCountsScore = examCountsScore; this.examMark = examMark;', ctx);
  ctx.daysUntil = () => -1;
  assert.equal(ctx.examCountsScore({ grade: 510, scheduled: false }), true);
  assert.equal(ctx.examCountsScore({ grade: 510, scheduled: true }), false);
  assert.equal(ctx.examCountsScore({ grade: null, scheduled: false }), false);
  ctx.daysUntil = () => 4; assert.equal(ctx.examCountsScore({ grade: 510, scheduled: false }), false);
  ctx.daysUntil = () => 5; assert.equal(ctx.examMark({ scheduled: true, grade: 500 }), '5 days');
  ctx.daysUntil = () => 0; assert.equal(ctx.examMark({ scheduled: true, grade: 500 }), 'Today');
  ctx.daysUntil = () => -2; assert.equal(ctx.examMark({ scheduled: true, grade: 500 }), 'Scheduled');
  ctx.daysUntil = () => -2; assert.equal(ctx.examMark({ scheduled: false, grade: 510 }), 'Score 510');
  ctx.daysUntil = () => -2; assert.equal(ctx.examMark({ scheduled: false, grade: null }), 'Done');
  assert.match(js, /Scheduled \(upcoming\)/);
  assert.match(js, /grade: scheduled \? '' : f\.grade\.value/);
  assert.match(js, /f\.date\.value > ik\(Date\.now\(\)\)/);
  assert.match(js, /classList\.toggle\('score-off'/);
  assert.match(js, /e\.scheduled \? \(d >= 0 \? '<div class="n">Scheduled<\/div>' : ''\)/);
  assert.match(css, /\.row\.ex-when\{align-items:flex-start\}/);
  assert.match(js, /class="row ex-when"><div><label>Date<\/label><input type="date"[^]*?<\/div><\/div><label class="ex-sched">/);
  assert.match(css, /label\.ex-sched input\{[^}]*accent-color:var\(--acc\)/);
  assert.match(css, /#exScore\.score-off input:disabled\{[^}]*var\(--muted\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /studyhertz-shell-v173/);
});
