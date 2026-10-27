'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Store, readSnapshot, dbPath } = require('../lib/store');
const { SqlBackend, jsonCounts } = require('../lib/sqlstore');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sql-')), 'data.json');
const seed = () => ({ version: 3, users: [{ id: 1, username: 'Alaric', salt: 's', hash: 'h', admin: true, created: '2026-01-01T00:00:00.000Z' }, { id: 2, username: 'bo', salt: 's2', hash: 'h2', admin: false }],
  tokens: { tok1: { uid: 1, exp: 9e12 } }, config: { openRegistration: false, custom: { x: [1, 2] } }, nextUserId: 3, reports: [{ id: 1, text: 'bug' }], nextReportId: 2,
  userData: { 1: { sessions: [{ id: 1, subject: 'Bio', activity: 'Reading', note: 'n "q"', start: '2026-10-01T16:00:00.000Z', end: '2026-10-01T17:00:00.000Z', breakSec: 30, mode: 'timer', source: null, focus: 4, progress: { pages: 3 } }, { id: 2, subject: 'CARS', start: '2026-10-02T16:00:00.000Z', end: null }],
    subjects: ['Bio', 'CARS'], subjectMeta: { Bio: { color: '#f00', weeklyGoalMin: 300, credits: null }, Gone: { color: '#0f0' } }, activities: ['Reading', 'Qbank'], settings: { goals: { dailyMin: 240 } }, active: { subject: 'Bio', start: 'x' }, nextId: 3,
    exams: [{ id: 1, grade: 510, date: '2026-09-01' }], tasks: [{ id: 1, text: 'todo', done: false }], plan: { a: 1 }, flags: { onboarded: 1 }, achNotified: ['first', 'onboard'], practice: [{ id: 1, n: 5 }] },
    2: { sessions: [], subjects: [], subjectMeta: {}, activities: [], settings: {}, active: null, nextId: 1, exams: [], tasks: [], plan: {}, flags: {}, achNotified: [], practice: [] } } });

test('imports data.json once into SQLite, losslessly, with matching row counts', () => {
  const f = tmp(), json = JSON.stringify(seed()); fs.writeFileSync(f, json);
  const s = new Store(f); const want = JSON.parse(json);
  assert.deepEqual(s.db, want); assert.deepEqual(readSnapshot(f), want);
  const b = new SqlBackend(dbPath(f)); assert.deepEqual(b.counts(), jsonCounts(want)); assert.equal(b.counts().sessions, 2); assert.ok(b.imported); b.close();
  s.close(); assert.equal(fs.readFileSync(f, 'utf8'), json, 'data.json untouched');
});

test('import is idempotent and later writes never touch data.json', () => {
  const f = tmp(), json = JSON.stringify(seed()); fs.writeFileSync(f, json);
  const s1 = new Store(f); const at = s1.sql.imported; s1.close();
  const s2 = new Store(f); assert.deepEqual(s2.sql.imported, at, 'not re-imported');
  s2.data(1).sessions.push({ id: 3, subject: 'Bio', start: '2026-10-03T16:00:00.000Z', end: '2026-10-03T16:30:00.000Z' }); s2.data(1).nextId = 4;
  s2.addUser({ username: 'cy', salt: 'a', hash: 'b' }); delete s2.db.tokens.tok1; s2.save(); s2.close();
  const s3 = new Store(f); assert.equal(s3.data(1).sessions.length, 3); assert.equal(s3.db.users.length, 3); assert.deepEqual(s3.db.tokens, {}); assert.equal(s3.findUser('ALARIC').id, 1);
  assert.equal(s3.sql.counts().sessions, 3); s3.close();
  assert.equal(fs.readFileSync(f, 'utf8'), json);
});

test('fresh install with no data.json starts empty in SQLite; WAL mode on', () => {
  const f = tmp(); const s = new Store(f); assert.equal(s.db.users.length, 0); s.addUser({ username: 'first', salt: 'a', hash: 'b' }); s.close();
  assert.ok(!fs.existsSync(f), 'no JSON written'); assert.equal(readSnapshot(f).users[0].admin, true);
  const d = new DatabaseSync(dbPath(f)); assert.equal(d.prepare('PRAGMA journal_mode').get().journal_mode, 'wal'); d.close();
});

test('a failed write rolls back the whole transaction', () => {
  const f = tmp(); fs.writeFileSync(f, JSON.stringify(seed())); const s = new Store(f);
  s.db.users.push({ id: 9, username: 'alaric', salt: 'x', hash: 'y' }); s.data(1).sessions.length = 0;
  assert.throws(() => s.save()); s.close();
  const snap = readSnapshot(f); assert.equal(snap.users.length, 2); assert.equal(snap.userData[1].sessions.length, 2);
});
