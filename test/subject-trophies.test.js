'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const a = require('../lib/analytics');
const { blankUserData, readSnapshot, dbPath } = require('../lib/store');
const { SqlBackend } = require('../lib/sqlstore');

const sess = (start, hours, subject, activity) => ({ subject, activity, start, end: new Date(Date.parse(start) + hours * 3600e3).toISOString(), breakSec: 0 });
const earnedMap = list => Object.fromEntries(list.map(x => [x.id, x.earned]));
const keys = (list, kind) => [...new Set(list.filter(x => x.kind === kind).map(x => x.key))].sort();

test('subject ladders are omitted once that subject is off the list; other subjects, activities and general trophies stay', () => {
  const ud = blankUserData();
  ud.sessions = [sess('2026-10-01T16:00:00Z', 2, 'CARS', 'Passages'), sess('2026-10-02T16:00:00Z', 2, 'Bio/Biochem', 'Anki')];
  const before = a.achievements(ud);
  assert.ok(before.personal.some(x => x.id === 'subject:cars:h1' && x.earned));
  assert.ok(before.personal.some(x => x.id === 'subject:bio-biochem:h1' && x.earned));
  assert.equal(before.personal.filter(x => x.key === 'CARS').length, 8, 'hour milestones plus session milestones');
  const globalBefore = earnedMap(before.global);
  ud.subjects = ud.subjects.filter(s => s !== 'CARS');
  const after = a.achievements(ud);
  assert.deepEqual(earnedMap(after.global), globalBefore, 'general trophies keep the same earned state');
  assert.ok(after.global.find(x => x.id === 'first').earned);
  assert.ok(after.global.find(x => x.id === 'h1').earned);
  assert.deepEqual(keys(after.personal, 'subject'), ['Bio/Biochem']);
  assert.ok(!after.personal.some(x => x.key === 'CARS' || String(x.id).startsWith('subject:cars:')));
  assert.ok(after.personal.some(x => x.id === 'subject:bio-biochem:h1' && x.earned && x.value === before.personal.find(p => p.id === 'subject:bio-biochem:h1').value));
  assert.deepEqual(keys(after.personal, 'activity'), ['Anki', 'Passages']);
});

test('dropSubjectTrophies removes that subject\'s earned ids and leaves general, activity and other-subject ids', () => {
  const ud = blankUserData();
  ud.subjects = ud.subjects.filter(s => s !== 'CARS');
  ud.achNotified = ['first', 'h1', 'subj5', 'activity:passages:h1', 'subject:cars:h1', 'subject:cars:n10', 'subject:bio-biochem:h1'];
  assert.equal(a.dropSubjectTrophies(ud, 'CARS'), true);
  assert.deepEqual(ud.achNotified, ['first', 'h1', 'subj5', 'activity:passages:h1', 'subject:bio-biochem:h1']);
  assert.equal(a.dropSubjectTrophies(ud, 'CARS'), false);
});

test('dropSubjectTrophies keeps ids when a different subject still uses that slug', () => {
  const ud = blankUserData();
  ud.subjects = ['cars'];
  ud.achNotified = ['subject:cars:h1', 'first'];
  assert.equal(a.dropSubjectTrophies(ud, 'CARS'), false);
  assert.deepEqual(ud.achNotified, ['subject:cars:h1', 'first']);
});

test('pruneOrphanTrophies drops earned ids whose subject is gone and leaves everything else', () => {
  const ud = blankUserData();
  ud.subjects = ud.subjects.filter(s => s !== 'CARS');
  ud.sessions = [sess('2026-10-01T16:00:00Z', 2, 'CARS', 'Passages'), sess('2026-10-02T16:00:00Z', 2, 'Bio/Biochem', 'Anki')];
  ud.achNotified = ['first', 'h1', 'subj5', 'activity:passages:h1', 'subject:cars:h1', 'subject:cars:h10', 'subject:bio-biochem:h1'];
  assert.equal(a.pruneOrphanTrophies(ud), true);
  assert.deepEqual(ud.achNotified, ['first', 'h1', 'subj5', 'activity:passages:h1', 'subject:bio-biochem:h1']);
  assert.equal(a.pruneOrphanTrophies(ud), false);
  assert.ok(!a.achievements(ud).personal.some(x => x.key === 'CARS'));
  assert.ok(a.achievements(ud).personal.some(x => x.key === 'Bio/Biochem' && x.earned));
});

async function start(dataFile) {
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const client = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  };
  return { server, client, dataFile, close: () => new Promise(r => server.close(r)) };
}

async function signIn(app, username) {
  const email = username + '-' + Math.random().toString(36).slice(2) + '@example.com';
  const r = await app.client('/api/register', 'POST', { email, agree: true, birthYear: 1990, username, password: 'secret-pass-1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.user.id;
}

function editDb(file, fn) {
  const b = new SqlBackend(dbPath(file));
  const db = b.load(); b.prime(db); fn(db); b.save(db); b.close();
}

test('DELETE /api/subjects removes that subject\'s trophies and earned records in one save', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-subj-tro-'));
  const app = await start(path.join(dir, 'data.json')); t.after(app.close);
  const uid = await signIn(app, 'alaric');
  const c = app.client;
  assert.equal((await c('/api/sessions', 'POST', sess('2026-10-01T16:00:00Z', 2, 'CARS', 'Passages'))).status, 200);
  assert.equal((await c('/api/sessions', 'POST', sess('2026-10-02T16:00:00Z', 2, 'Bio/Biochem', 'Anki'))).status, 200);
  const init = await c('/api/achievements/new');
  assert.equal(init.status, 200);
  const before = (await c('/api/achievements')).body;
  assert.ok(before.personal.some(x => x.id === 'subject:cars:h1' && x.earned));
  assert.ok(before.personal.some(x => x.key === 'CARS' && !x.earned), 'locked milestones for the subject are present before delete');
  const globalBefore = earnedMap(before.global);
  const bioBefore = before.personal.filter(x => x.key === 'Bio/Biochem').map(x => [x.id, x.earned, x.value]);
  const del = await c('/api/subjects', 'DELETE', { name: 'CARS' });
  assert.equal(del.status, 200); assert.ok(!del.body.includes('CARS'));
  const after = (await c('/api/achievements')).body;
  assert.deepEqual(earnedMap(after.global), globalBefore);
  assert.ok(!after.personal.some(x => x.kind === 'subject' && (x.key === 'CARS' || String(x.id).startsWith('subject:cars:'))));
  assert.deepEqual(after.personal.filter(x => x.key === 'Bio/Biochem').map(x => [x.id, x.earned, x.value]), bioBefore);
  assert.ok(after.personal.some(x => x.id === 'activity:passages:h1' && x.earned));
  assert.ok(after.personal.some(x => x.id === 'activity:anki:h1' && x.earned));
  const fresh = (await c('/api/achievements/new')).body;
  assert.ok(!fresh.new.some(x => x.kind === 'subject' && x.key === 'CARS'));
  const sessions = (await c('/api/sessions')).body;
  assert.ok(sessions.some(s => s.subject === 'CARS'), 'past sessions are kept');
  const ud = readSnapshot(path.join(dir, 'data.json')).userData[String(uid)];
  assert.ok(!ud.subjects.includes('CARS'));
  assert.ok(ud.achNotified.includes('first') && ud.achNotified.includes('subject:bio-biochem:h1') && ud.achNotified.includes('activity:passages:h1'));
  assert.ok(!ud.achNotified.some(id => String(id).startsWith('subject:cars:')), 'earned records for the deleted subject are gone');
});

test('reading achievements cleans trophies already orphaned by an older subject delete', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-subj-orphan-'));
  const file = path.join(dir, 'data.json');
  const app = await start(file);
  const uid = await signIn(app, 'alaric');
  const c = app.client;
  await c('/api/sessions', 'POST', sess('2026-10-01T16:00:00Z', 2, 'CARS', 'Passages'));
  await c('/api/sessions', 'POST', sess('2026-10-02T16:00:00Z', 2, 'Bio/Biochem', 'Anki'));
  assert.equal((await c('/api/achievements/new')).status, 200);
  await app.close();
  editDb(file, db => {
    const ud = db.userData[String(uid)];
    ud.subjects = ud.subjects.filter(s => s !== 'CARS'); // old delete: list only, trophies and notified ids left behind
    assert.ok(ud.achNotified.some(id => String(id).startsWith('subject:cars:')));
  });
  const again = await start(file); t.after(again.close);
  const login = await again.client('/api/login', 'POST', { username: 'alaric', password: 'secret-pass-1' });
  assert.equal(login.status, 200);
  const A = (await again.client('/api/achievements')).body;
  assert.ok(!A.personal.some(x => x.key === 'CARS' || String(x.id).startsWith('subject:cars:')));
  assert.ok(A.personal.some(x => x.id === 'subject:bio-biochem:h1' && x.earned));
  assert.ok(A.personal.some(x => x.id === 'activity:passages:h1' && x.earned));
  assert.equal(A.global.find(x => x.id === 'first').earned, true);
  assert.equal(A.global.find(x => x.id === 'h1').earned, true);
  const neu = (await again.client('/api/achievements/new')).body;
  assert.ok(!neu.new.some(x => x.key === 'CARS'));
  const ud = readSnapshot(file).userData[String(uid)];
  assert.ok(ud.sessions.some(s => s.subject === 'CARS'));
  assert.ok(!ud.subjects.includes('CARS'));
  assert.ok(!ud.achNotified.some(id => String(id).startsWith('subject:cars:')));
  assert.ok(ud.achNotified.includes('subject:bio-biochem:h1'));
  assert.ok(ud.achNotified.includes('first'));
  assert.ok(ud.achNotified.includes('activity:passages:h1'));
  assert.ok(!ud.achNotified.includes('subj5') || A.global.find(x => x.id === 'subj5').earned, 'a general id is removed only when it was never earned');
});

test('client drops the removed subject\'s trophies on delete and the shell cache is v175', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const del = app.slice(app.indexOf('ACT.subjDel'), app.indexOf('ACT.addSubj'));
  assert.match(del, /dropSubjectTrophyClient\(n\)/);
  assert.match(del, /await refresh\(\)/);
  assert.match(app, /function dropSubjectTrophyClient/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /studyhertz-shell-v175/);
});
