'use strict';
// MCAT Study Tracker - zero-dependency Node server
const http = require('http'), fs = require('fs'), path = require('path');
const auth = require('./lib/auth'), csv = require('./lib/csv'), stats = require('./lib/stats');
const { Store } = require('./lib/store');

const SESSION_DAYS = 30, PUBLIC = path.join(__dirname, 'public');
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/favicon.svg': 'favicon.svg' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function createApp(opts = {}) {
  const store = new Store(opts.dataFile || path.join(__dirname, 'data.json'));
  const fetchImpl = opts.fetch || globalThis.fetch;
  const minSessionSec = opts.minSessionSec ?? 30;
  const ipLimiter = new auth.RateLimiter(opts.ipMaxAttempts || 20, 15 * 60e3);
  const userLimiter = new auth.RateLimiter(opts.userMaxAttempts || 5, 15 * 60e3);

  async function busy(ud, text) { // Busy Bar HTTP API; never throws
    const { busyIp, busyToken } = ud.settings; if (!busyIp || !fetchImpl) return false;
    const base = 'http://' + busyIp, headers = { 'Content-Type': 'application/json' };
    if (busyToken) headers['X-API-Token'] = busyToken;
    try {
      const signal = AbortSignal.timeout(3000);
      if (text === null) await fetchImpl(base + '/api/display/draw?app_id=mcat', { method: 'DELETE', headers, signal });
      else await fetchImpl(base + '/api/display/draw', { method: 'POST', headers, signal, body: JSON.stringify({
        app_id: 'mcat', elements: [{ id: 't', type: 'text', text, x: 0, y: 0, display: 'front' }] }) });
      return true;
    } catch { return false; }
  }

  const send = (res, code, body, type = 'application/json', extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readBody = req => new Promise((resolve, reject) => { let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) { reject(new Error('body too large')); req.destroy(); } }); req.on('end', () => resolve(b)); });
  const cookie = (token, maxAge) => `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

  function currentUser(req) {
    const t = auth.parseCookies(req.headers.cookie).sid; if (!t) return null;
    const k = auth.tokenKey(t), s = store.db.tokens[k];
    if (!s) return null;
    if (s.exp < Date.now()) { delete store.db.tokens[k]; store.save(); return null; }
    return store.userById(s.uid) || null;
  }
  function startSession(uid) {
    const t = auth.newToken(), now = Date.now();
    for (const [k, v] of Object.entries(store.db.tokens)) if (v.exp < now) delete store.db.tokens[k];
    store.db.tokens[auth.tokenKey(t)] = { uid, exp: now + SESSION_DAYS * 864e5 }; store.save();
    return cookie(t, SESSION_DAYS * 86400);
  }
  const publicUser = u => ({ id: u.id, username: u.username, admin: !!u.admin });
  const maskedState = ud => ({ ...ud, settings: { ...ud.settings, busyToken: ud.settings.busyToken ? '********' : '' } });
  const cleanSession = j => {
    const st = new Date(j.start), en = new Date(j.end);
    if (isNaN(st) || isNaN(en) || en <= st || en - st > 864e5) throw new Error('invalid start/end');
    return { subject: String(j.subject || 'Other').slice(0, 60), note: String(j.note || '').slice(0, 500), start: st.toISOString(), end: en.toISOString() };
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, M = req.method;
    try {
      if (M === 'GET' && STATIC[p]) { const f = path.join(PUBLIC, STATIC[p]); return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)]); }
      if (!p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      let j = {};
      if (M !== 'GET' && M !== 'HEAD') {
        const raw = await readBody(req);
        if (raw) { if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON required' }); j = JSON.parse(raw); if (!j || typeof j !== 'object') j = {}; }
      }
      const user = currentUser(req);

      // ---- public auth endpoints ----
      if (p === '/api/me') return send(res, 200, { user: user && publicUser(user), needsSetup: store.db.users.length === 0, registrationOpen: store.db.users.length === 0 || !!store.db.config.openRegistration });
      if (p === '/api/register' && M === 'POST') {
        if (store.db.users.length && !store.db.config.openRegistration) return send(res, 403, { error: 'Registration is disabled' });
        if (!auth.validUsername(j.username)) return send(res, 400, { error: 'Username: 3-32 chars, letters/numbers/._-' });
        if (!auth.validPassword(j.password)) return send(res, 400, { error: 'Password must be at least 8 characters' });
        if (store.findUser(j.username)) return send(res, 409, { error: 'Username taken' });
        const nu = store.addUser({ username: j.username, ...(await auth.hashPassword(j.password)) });
        return send(res, 200, { user: publicUser(nu) }, 'application/json', { 'Set-Cookie': startSession(nu.id) });
      }
      if (p === '/api/login' && M === 'POST') {
        const ip = req.socket.remoteAddress || '?', uk = 'u:' + String(j.username || '').toLowerCase();
        if (ipLimiter.blocked(ip) || userLimiter.blocked(uk)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
        const found = store.findUser(j.username || '');
        const ok = found ? await auth.verifyPassword(j.password || '', found.salt, found.hash) : (await auth.hashPassword('x'), false); // equalize timing
        if (!ok) { ipLimiter.fail(ip); userLimiter.fail(uk); return send(res, 401, { error: 'Invalid username or password' }); }
        userLimiter.reset(uk);
        return send(res, 200, { user: publicUser(found) }, 'application/json', { 'Set-Cookie': startSession(found.id) });
      }
      if (p === '/api/logout' && M === 'POST') {
        const t = auth.parseCookies(req.headers.cookie).sid; if (t) { delete store.db.tokens[auth.tokenKey(t)]; store.save(); }
        return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': cookie('', 0) });
      }
      if (!user) return send(res, 401, { error: 'Not logged in' });

      // ---- authenticated, per-user data ----
      const ud = store.data(user.id), save = () => store.save();
      if (p === '/api/password' && M === 'POST') {
        if (!(await auth.verifyPassword(j.current || '', user.salt, user.hash))) return send(res, 401, { error: 'Current password is wrong' });
        if (!auth.validPassword(j.password)) return send(res, 400, { error: 'Password must be at least 8 characters' });
        Object.assign(user, await auth.hashPassword(j.password));
        for (const [k, v] of Object.entries(store.db.tokens)) if (v.uid === user.id) delete store.db.tokens[k];
        save(); return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': startSession(user.id) });
      }
      if (p === '/api/state') return send(res, 200, maskedState(ud));
      if (p === '/api/stats') return send(res, 200, stats.computeStats(ud.sessions, { goalMin: ud.settings.dailyGoalMin }));
      if (p === '/api/export.csv') return send(res, 200, csv.sessionsToCSV(ud.sessions), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="mcat-sessions.csv"' });
      if (p === '/api/import' && M === 'POST') {
        if (typeof j.csv !== 'string') return send(res, 400, { error: 'csv (string) required' });
        const r = csv.csvToSessions(j.csv, j.map);
        for (const s of r.sessions) { if (!ud.subjects.includes(s.subject)) ud.subjects.push(s.subject); ud.sessions.push({ id: ud.nextId++, ...s, source: 'import' }); }
        save(); return send(res, 200, { added: r.sessions.length, skipped: r.skipped, columns: r.columns });
      }
      if (p === '/api/timer/start' && M === 'POST') {
        if (!ud.active) ud.active = { subject: String(j.subject || ud.subjects[0] || 'Study'), note: String(j.note || ''), start: new Date().toISOString(), accum: 0, paused: false };
        else if (ud.active.paused) { ud.active.start = new Date().toISOString(); ud.active.paused = false; }
        save(); busy(ud, 'Studying ' + ud.active.subject); return send(res, 200, ud.active);
      }
      if (p === '/api/timer/pause' && M === 'POST') {
        if (!ud.active || ud.active.paused) return send(res, 409, { error: 'Timer not running' });
        ud.active.accum += (Date.now() - new Date(ud.active.start)) / 1000; ud.active.paused = true; save(); busy(ud, 'Paused'); return send(res, 200, ud.active);
      }
      if (p === '/api/timer/stop' && M === 'POST') {
        const a = ud.active; if (!a) return send(res, 409, { error: 'Timer not running' });
        const secs = a.accum + (a.paused ? 0 : (Date.now() - new Date(a.start)) / 1000);
        if (j.note !== undefined) a.note = String(j.note); if (j.subject) a.subject = String(j.subject);
        let session = null;
        if (secs >= minSessionSec) { const end = new Date(); session = { id: ud.nextId++, subject: a.subject, note: a.note, start: new Date(+end - secs * 1000).toISOString(), end: end.toISOString() }; ud.sessions.push(session); }
        ud.active = null; save(); busy(ud, null); return send(res, 200, { ok: true, session });
      }
      if (p === '/api/sessions' && M === 'GET') return send(res, 200, ud.sessions);
      if (p === '/api/sessions' && M === 'POST') { const s = { id: ud.nextId++, ...cleanSession(j) }; ud.sessions.push(s); if (!ud.subjects.includes(s.subject)) ud.subjects.push(s.subject); save(); return send(res, 200, s); }
      const m = /^\/api\/sessions\/(\d+)$/.exec(p);
      if (m) {
        const i = ud.sessions.findIndex(s => s.id === +m[1]); if (i < 0) return send(res, 404, { error: 'not found' });
        if (M === 'DELETE') ud.sessions.splice(i, 1); else if (M === 'PUT') Object.assign(ud.sessions[i], cleanSession(j)); else return send(res, 405, { error: 'method' });
        save(); return send(res, 200, { ok: true });
      }
      if (p === '/api/subjects' && M === 'POST') { const n = String(j.name || '').trim().slice(0, 60); if (n && !ud.subjects.includes(n)) { ud.subjects.push(n); save(); } return send(res, 200, ud.subjects); }
      if (p === '/api/subjects' && M === 'DELETE') { ud.subjects = ud.subjects.filter(s => s !== j.name); save(); return send(res, 200, ud.subjects); }
      if (p === '/api/settings' && M === 'POST') {
        if (j.dailyGoalMin !== undefined) { const g = Math.round(+j.dailyGoalMin); if (!(g >= 0 && g <= 1440)) return send(res, 400, { error: 'goal 0-1440 min' }); ud.settings.dailyGoalMin = g; }
        if (j.busyIp !== undefined) ud.settings.busyIp = String(j.busyIp).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        if (j.busyToken !== undefined && j.busyToken !== '********') ud.settings.busyToken = String(j.busyToken).trim();
        save(); return send(res, 200, { ok: true });
      }
      if (p === '/api/busybar/test' && M === 'POST') return send(res, 200, { ok: await busy(ud, 'MCAT tracker test') });

      // ---- admin ----
      if (p.startsWith('/api/admin/')) {
        if (!user.admin) return send(res, 403, { error: 'Admin only' });
        if (p === '/api/admin/config' && M === 'GET') return send(res, 200, store.db.config);
        if (p === '/api/admin/config' && M === 'POST') { if (j.openRegistration !== undefined) store.db.config.openRegistration = !!j.openRegistration; save(); return send(res, 200, store.db.config); }
        if (p === '/api/admin/users' && M === 'GET') return send(res, 200, store.db.users.map(x => ({ ...publicUser(x), created: x.created })));
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 400, { error: String(e.message || e) }); }
  });
  server.store = store;
  return server;
}

module.exports = { createApp };
if (require.main === module) {
  const port = +process.env.PORT || 3000;
  createApp().listen(port, process.env.HOST || '0.0.0.0', () => console.log(new Date().toISOString(), 'MCAT tracker on :' + port));
}
