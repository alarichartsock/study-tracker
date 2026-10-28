'use strict';
// SQLite persistence for the Store (node:sqlite, no dependencies). The app keeps working on the same in-memory
// object (store.db); save() writes only the sections that changed, in one transaction. WAL mode.
// Arrays keep their order via a pos column; fields that are not strings/numbers (or are null) and any unknown
// fields go to an `extra` JSON column, so a load -> save -> load round trip is lossless.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, pos INTEGER NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE, salt, hash, admin, created, extra TEXT);
CREATE TABLE IF NOT EXISTS tokens (key TEXT PRIMARY KEY, uid INTEGER, exp, extra TEXT);
CREATE TABLE IF NOT EXISTS reports (id INTEGER, pos INTEGER NOT NULL PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_data (user_id TEXT PRIMARY KEY, settings TEXT, plan TEXT, flags TEXT, active TEXT, next_id, extra TEXT);
CREATE TABLE IF NOT EXISTS subjects (user_id TEXT NOT NULL, name TEXT NOT NULL, pos INTEGER, color, weekly_goal_min, credits, extra TEXT, PRIMARY KEY (user_id, name));
CREATE TABLE IF NOT EXISTS activities (user_id TEXT NOT NULL, pos INTEGER NOT NULL, name, PRIMARY KEY (user_id, pos));
CREATE TABLE IF NOT EXISTS sessions (user_id TEXT NOT NULL, pos INTEGER NOT NULL, id, subject, activity, start, "end", break_sec, mode, source, note, extra TEXT, PRIMARY KEY (user_id, pos));
CREATE INDEX IF NOT EXISTS sessions_user_start ON sessions (user_id, start);
CREATE TABLE IF NOT EXISTS exams (user_id TEXT NOT NULL, pos INTEGER NOT NULL, id, name, date, grade, extra TEXT, PRIMARY KEY (user_id, pos));
CREATE TABLE IF NOT EXISTS tasks (user_id TEXT NOT NULL, pos INTEGER NOT NULL, id, title, due, subject, extra TEXT, PRIMARY KEY (user_id, pos));
CREATE TABLE IF NOT EXISTS practice (user_id TEXT NOT NULL, pos INTEGER NOT NULL, id, date, extra TEXT, PRIMARY KEY (user_id, pos));
CREATE TABLE IF NOT EXISTS consents (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, terms_version TEXT NOT NULL, privacy_version TEXT NOT NULL, ts TEXT NOT NULL, method TEXT NOT NULL, ip TEXT, ua TEXT, checkbox_text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS consents_user ON consents (user_id, id);
CREATE TRIGGER IF NOT EXISTS consents_no_update BEFORE UPDATE ON consents BEGIN SELECT RAISE(ABORT, 'consents are append-only'); END;
CREATE TRIGGER IF NOT EXISTS consents_no_delete BEFORE DELETE ON consents BEGIN SELECT RAISE(ABORT, 'consents are append-only'); END;
CREATE TABLE IF NOT EXISTS subscriptions (user_id INTEGER PRIMARY KEY, customer_id TEXT UNIQUE, subscription_id TEXT, status TEXT, plan TEXT, price_id TEXT, current_period_end TEXT, cancel_at_period_end INTEGER, payment_failed INTEGER, updated TEXT);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS achievements_notified (user_id TEXT NOT NULL, pos INTEGER NOT NULL, achievement_id TEXT NOT NULL, PRIMARY KEY (user_id, achievement_id));
`;
// array tables: [table, userData key, [[column, field], ...]]
const ARR = [
  ['sessions', 'sessions', [['id', 'id'], ['subject', 'subject'], ['activity', 'activity'], ['start', 'start'], ['"end"', 'end'], ['break_sec', 'breakSec'], ['mode', 'mode'], ['source', 'source'], ['note', 'note']]],
  ['exams', 'exams', [['id', 'id'], ['name', 'name'], ['date', 'date'], ['grade', 'grade']]],
  ['tasks', 'tasks', [['id', 'id'], ['title', 'title'], ['due', 'due'], ['subject', 'subject']]],
  ['practice', 'practice', [['id', 'id'], ['date', 'date']]]
];
const UD_COLS = { settings: 'settings', plan: 'plan', flags: 'flags', active: 'active' }; // JSON columns
const UD_TABLE_KEYS = new Set(['sessions', 'exams', 'tasks', 'practice', 'subjects', 'subjectMeta', 'activities', 'achNotified', 'nextId', ...Object.keys(UD_COLS)]);
const scalar = v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const J = v => v === undefined ? null : JSON.stringify(v);
const P = t => t == null ? undefined : JSON.parse(t);
// split an object into column values (strings/finite numbers) and a JSON blob for everything else
function split(o, cols) { const vals = [], rest = { ...o }; for (const [, f] of cols) { if (scalar(o[f])) { vals.push(o[f]); delete rest[f]; } else vals.push(null); } return [vals, Object.keys(rest).length ? JSON.stringify(rest) : null]; }
function join(row, cols) { const o = row.extra ? JSON.parse(row.extra) : {}; for (const [c, f] of cols) { const v = row[c.replace(/"/g, '')]; if (v !== null && v !== undefined) o[f] = v; } return o; }

const NOMETA = '"__nometa"'; // subjects listed without a subjectMeta entry
const HAS_KEYS = ['sessions', 'exams', 'tasks', 'practice', 'subjects', 'subjectMeta', 'activities', 'achNotified'];
const hasMap = ud => Object.fromEntries(HAS_KEYS.map(k => [k, ud[k] !== undefined]));
function udRow(ud) { const rest = {}; for (const [k, v] of Object.entries(ud)) if (!UD_TABLE_KEYS.has(k)) rest[k] = v; if (ud.nextId !== undefined && !scalar(ud.nextId)) rest.nextId = ud.nextId;
  return { s: J(ud.settings), pl: J(ud.plan), f: J(ud.flags), a: J(ud.active), n: scalar(ud.nextId) ? ud.nextId : null, x: Object.keys(rest).length ? JSON.stringify(rest) : null }; }
const S = v => JSON.stringify(v) ?? 'undefined';
// one string per independently-written section; save() rewrites a section only when its string changed
function sections(d) { const m = new Map();
  for (const [k, v] of Object.entries(d)) if (!['users', 'tokens', 'reports', 'userData'].includes(k)) m.set('m.' + k, JSON.stringify(v));
  m.set('users', S(d.users)); m.set('tokens', S(d.tokens)); m.set('reports', S(d.reports));
  for (const [uid, ud] of Object.entries(d.userData || {})) { const p = 'u.' + uid + '.'; m.set(p + 'has', S(hasMap(ud))); m.set(p + 'row', S(udRow(ud)));
    for (const [, k] of ARR) m.set(p + k, S(ud[k])); m.set(p + 'subj', S([ud.subjects, ud.subjectMeta])); m.set(p + 'act', S(ud.activities)); m.set(p + 'ach', S(ud.achNotified)); }
  return m; }

class SqlBackend {
  constructor(file) {
    this.file = file; this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA_SQL); this.snap = new Map();
  }
  meta(key) { const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? JSON.parse(r.value) : undefined; }
  get imported() { return !!this.meta('imported'); }
  // append-only legal consent log (never rewritten by save())
  addConsent(c) { this.db.prepare('INSERT INTO consents (user_id, terms_version, privacy_version, ts, method, ip, ua, checkbox_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c.user_id, c.terms_version, c.privacy_version, c.ts, c.method, c.ip ?? null, c.ua ?? null, c.checkbox_text); }
  subscription(uid) { return this.db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(uid); }
  subByCustomer(cid) { return this.db.prepare('SELECT * FROM subscriptions WHERE customer_id = ?').get(cid); }
  upsertSub(r) { const cols = ['user_id', 'customer_id', 'subscription_id', 'status', 'plan', 'price_id', 'current_period_end', 'cancel_at_period_end', 'payment_failed', 'updated'];
    const prev = this.subscription(r.user_id) || {}, row = cols.map(c => (r[c] !== undefined ? r[c] : prev[c] ?? null));
    this.db.prepare(`INSERT OR REPLACE INTO subscriptions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...row); }
  eventNew(id, type) { return this.db.prepare('INSERT OR IGNORE INTO stripe_events (id, type, ts) VALUES (?, ?, ?)').run(id, type, new Date().toISOString()).changes === 1; }
  eventForget(id) { this.db.prepare('DELETE FROM stripe_events WHERE id = ?').run(id); }
  consents(uid) { return this.db.prepare('SELECT * FROM consents WHERE user_id = ? ORDER BY id').all(uid); }
  close() { try { this.db.close(); } catch { /* ignore */ } }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; } }
  // ---- load everything into the classic in-memory shape ----
  load() {
    const q = (sql, ...a) => this.db.prepare(sql).all(...a), out = {};
    for (const r of q('SELECT key, value FROM meta')) if (r.key.startsWith('db.')) out[r.key.slice(3)] = JSON.parse(r.value);
    out.users = q('SELECT * FROM users ORDER BY pos').map(r => { const u = r.extra ? JSON.parse(r.extra) : {}; for (const k of ['id', 'username', 'salt', 'hash', 'created']) if (r[k] != null) u[k] = r[k]; if (r.admin != null) u.admin = !!r.admin; return u; });
    out.tokens = {}; for (const r of q('SELECT * FROM tokens')) { const t = r.extra ? JSON.parse(r.extra) : {}; if (r.uid != null) t.uid = r.uid; if (r.exp != null) t.exp = r.exp; out.tokens[r.key] = t; }
    if (this.meta('has.reports')) out.reports = q('SELECT data FROM reports ORDER BY pos').map(r => JSON.parse(r.data));
    out.userData = {};
    for (const r of q('SELECT * FROM user_data')) { const ud = r.extra ? JSON.parse(r.extra) : {}; for (const [k, c] of Object.entries(UD_COLS)) if (r[c] != null) ud[k] = JSON.parse(r[c]); if (r.next_id != null) ud.nextId = r.next_id; out.userData[r.user_id] = ud; }
    for (const [uid, ud] of Object.entries(out.userData)) {
      const has = this.meta('ud.' + uid) || {};
      for (const [t, k, cols] of ARR) if (has[k]) ud[k] = q(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY pos`, uid).map(r => join(r, cols));
      if (has.subjects) ud.subjects = q('SELECT name FROM subjects WHERE user_id = ? AND pos IS NOT NULL ORDER BY pos', uid).map(r => r.name);
      if (has.subjectMeta) { ud.subjectMeta = {}; for (const r of q('SELECT * FROM subjects WHERE user_id = ? AND extra IS NOT \'"__nometa"\' ORDER BY pos IS NULL, pos, name', uid)) ud.subjectMeta[r.name] = join(r, [['color', 'color'], ['weekly_goal_min', 'weeklyGoalMin'], ['credits', 'credits']]); }
      if (has.activities) ud.activities = q('SELECT name FROM activities WHERE user_id = ? ORDER BY pos', uid).map(r => r.name);
      if (has.achNotified) ud.achNotified = q('SELECT achievement_id FROM achievements_notified WHERE user_id = ? ORDER BY pos', uid).map(r => r.achievement_id);
    }
    return out;
  }
  // ---- write the sections of `d` that changed since the last load/save (all of them on first import) ----
  save(d, importInfo) {
    const run = (sql, ...a) => this.db.prepare(sql).run(...a), cur = sections(d), dirty = k => cur.get(k) !== this.snap.get(k);
    this.tx(() => {
      for (const k of new Set([...cur.keys(), ...this.snap.keys()])) if (k.startsWith('m.') && dirty(k)) { if (cur.has(k)) run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'db.' + k.slice(2), cur.get(k)); else run('DELETE FROM meta WHERE key = ?', 'db.' + k.slice(2)); }
      if (dirty('users')) { run('DELETE FROM users'); (d.users || []).forEach((u, i) => { const { id, username, salt, hash, admin, created, ...rest } = u; if (admin !== undefined && typeof admin !== 'boolean') rest.admin = admin;
        run('INSERT INTO users (id, pos, username, salt, hash, admin, created, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, i, username, salt ?? null, hash ?? null, typeof admin === 'boolean' ? (admin ? 1 : 0) : null, created ?? null, Object.keys(rest).length ? JSON.stringify(rest) : null); }); }
      if (dirty('tokens')) { run('DELETE FROM tokens'); for (const [k, t] of Object.entries(d.tokens || {})) { const [[uid, exp], extra] = split(t, [['uid', 'uid'], ['exp', 'exp']]); run('INSERT INTO tokens (key, uid, exp, extra) VALUES (?, ?, ?, ?)', k, uid, exp, extra); } }
      if (dirty('reports')) { run('DELETE FROM reports'); run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'has.reports', JSON.stringify(Array.isArray(d.reports))); (d.reports || []).forEach((r, i) => run('INSERT INTO reports (id, pos, data) VALUES (?, ?, ?)', scalar(r.id) ? r.id : null, i, JSON.stringify(r))); }
      const uids = Object.keys(d.userData || {});
      for (const k of this.snap.keys()) { const m = /^u\.([^.]+)\.has$/.exec(k); if (m && !uids.includes(m[1])) this.dropUser(m[1]); }
      for (const uid of uids) this.saveUser(uid, d.userData[uid], dirty);
      if (importInfo) run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'imported', JSON.stringify(importInfo));
    });
    this.snap = cur; // only after a successful commit
  }
  dropUser(uid) { for (const t of ['user_data', 'subjects', 'activities', 'sessions', 'exams', 'tasks', 'practice', 'achievements_notified']) this.db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid); this.db.prepare('DELETE FROM meta WHERE key = ?').run('ud.' + uid); }
  saveUser(uid, ud, dirty) {
    const run = (sql, ...a) => this.db.prepare(sql).run(...a), p = 'u.' + uid + '.';
    if (dirty(p + 'has')) run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'ud.' + uid, JSON.stringify(hasMap(ud)));
    if (dirty(p + 'row')) { const r = udRow(ud); run('INSERT OR REPLACE INTO user_data (user_id, settings, plan, flags, active, next_id, extra) VALUES (?, ?, ?, ?, ?, ?, ?)', uid, r.s, r.pl, r.f, r.a, r.n, r.x); }
    for (const [t, k, cols] of ARR) if (dirty(p + k)) { run(`DELETE FROM ${t} WHERE user_id = ?`, uid); const ins = this.db.prepare(`INSERT INTO ${t} (user_id, pos, ${cols.map(c => c[0]).join(', ')}, extra) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)`);
      (ud[k] || []).forEach((o, i) => { const [vals, extra] = split(o, cols); ins.run(uid, i, ...vals, extra); }); }
    if (dirty(p + 'subj')) { run('DELETE FROM subjects WHERE user_id = ?', uid); const ins = this.db.prepare('INSERT INTO subjects (user_id, name, pos, color, weekly_goal_min, credits, extra) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const meta = ud.subjectMeta || {}, list = ud.subjects || [], cols = [['color', 'color'], ['weekly_goal_min', 'weeklyGoalMin'], ['credits', 'credits']];
      for (const n of new Set([...list, ...Object.keys(meta)])) { const i = list.indexOf(n), m = meta[n]; if (m === undefined) { ins.run(uid, n, i, null, null, null, NOMETA); continue; } const [v, x] = split(m, cols); ins.run(uid, n, i < 0 ? null : i, ...v, x); } }
    if (dirty(p + 'act')) { run('DELETE FROM activities WHERE user_id = ?', uid); (ud.activities || []).forEach((n, i) => run('INSERT INTO activities (user_id, pos, name) VALUES (?, ?, ?)', uid, i, n)); }
    if (dirty(p + 'ach')) { run('DELETE FROM achievements_notified WHERE user_id = ?', uid); [...new Set(ud.achNotified || [])].forEach((a, i) => run('INSERT INTO achievements_notified (user_id, pos, achievement_id) VALUES (?, ?, ?)', uid, i, String(a))); }
  }
  prime(d) { this.snap = sections(d); } // the object just loaded is the saved state
  counts() { const c = {}; for (const t of ['users', 'tokens', 'reports', 'user_data', 'subjects', 'activities', 'sessions', 'exams', 'tasks', 'practice', 'achievements_notified']) c[t] = this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; return c; }
}
// counts of the same things in a classic JSON object, for verification
function jsonCounts(d) { const U = Object.values(d.userData || {}), sum = f => U.reduce((a, u) => a + f(u), 0);
  return { users: (d.users || []).length, tokens: Object.keys(d.tokens || {}).length, reports: (d.reports || []).length, user_data: U.length,
    subjects: sum(u => new Set([...(u.subjects || []), ...Object.keys(u.subjectMeta || {})]).size), activities: sum(u => (u.activities || []).length), sessions: sum(u => (u.sessions || []).length),
    exams: sum(u => (u.exams || []).length), tasks: sum(u => (u.tasks || []).length), practice: sum(u => (u.practice || []).length), achievements_notified: sum(u => new Set(u.achNotified || []).size) }; }
module.exports = { SqlBackend, jsonCounts, SCHEMA_SQL };
