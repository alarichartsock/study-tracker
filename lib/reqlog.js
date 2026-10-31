'use strict';
// Structured request logging: one JSON line per request to stdout (Render app logs), an in-memory ring buffer for the
// admin Logs view, and a rotating JSONL file (logs/requests-YYYY-MM-DD.jsonl) capped by size and age.
// Never logged: request bodies, passwords, cookies, Authorization headers, Stripe payloads, tokens, emails.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');

const SECRET_KEY = /(token|code|key|secret|pass|pwd|session|sid|sig|state|email|auth|otp|nonce|ticket|credential|cs_|client_secret)/i;
const redactQuery = search => { if (!search || search === '?') return ''; const q = new URLSearchParams(search), out = [];
  for (const [k, v] of q) out.push(encodeURIComponent(k) + '=' + (SECRET_KEY.test(k) || /@|%40/.test(v) || /^(sk|rk|pk|whsec|cs|pi|cus|sub|tok)_/.test(v) || v.length > 64 ? '[redacted]' : encodeURIComponent(v)));
  return out.length ? '?' + out.join('&') : ''; };
const PROBE = /(^|\/)(\.env|\.git|\.svn|\.hg|\.ds_store|\.aws|\.ssh|wp-admin|wp-login|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|myadmin|adminer|cgi-bin|vendor\/phpunit|actuator|server-status|config\.(php|json|yml|yaml)|\.php$|\.asp|\.jsp|etc\/passwd|boaform|HNAP1|owa\/|autodiscover)/i;
const BURST_CODES = new Set([401, 403, 404, 415]), BURST_WIN = 60e3, BURST_N = 10;
const origin = r => { try { return r ? new URL(r).origin : null; } catch { return null; } };
const clip = (v, n) => v == null ? null : String(v).slice(0, n);

// Free-text search: whitespace-separated terms (quotes keep phrases), all must match. field:value narrows to one field.
const FIELDS = { status: 'status', ip: 'ip', path: 'path', uid: 'uid', user: 'uid', method: 'method', ua: 'ua', id: 'id', flag: 'flags', flags: 'flags', err: 'err', error: 'err', ref: 'ref', ct: 'ct' };
function parseQuery(q) { const out = []; for (const m of String(q || '').slice(0, 300).matchAll(/(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g)) {
    const [, f1, v1, f2, v2, ph, w] = m, f = (f1 || f2 || '').toLowerCase(), v = v1 ?? v2;
    if (f && FIELDS[f] && v) out.push({ field: FIELDS[f], v: v.toLowerCase() }); else { const t = (ph ?? w ?? (f + ':' + v)).toLowerCase(); if (t) out.push({ v: t }); } }
  return out.slice(0, 12); }
const fieldStr = (e, k) => k === 'flags' ? (e.flags || []).join(' ') : String(e[k] ?? '');
function matchTerm(e, q) { if (q.field) { const s = fieldStr(e, q.field).toLowerCase(); return ['status', 'uid', 'ip', 'method', 'id'].includes(q.field) ? s === q.v || (q.field === 'status' && /^[1-5]xx$/.test(q.v) && s[0] === q.v[0]) : s.includes(q.v); }
  return ['path', 'ip', 'uid', 'ua', 'id', 'status', 'method', 'err', 'flags', 'where', 'kind'].some(k => fieldStr(e, k).toLowerCase().includes(q.v)); }
const DAY_RE = /^requests-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;
const pctl = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
// Per-day aggregate for the long-term stats view.
function dayStats(evs) { let n = 0, e4 = 0, e5 = 0, fl = 0; const ms = [], ips = new Set();
  for (const e of evs) { if (e.kind === 'exception') { fl++; continue; } n++; if (e.status >= 500) e5++; else if (e.status >= 400) e4++; if (typeof e.ms === 'number') ms.push(e.ms); if (e.ip) ips.add(e.ip); if (e.flags && e.flags.length) fl++; }
  return { requests: n, e4xx: e4, e5xx: e5, errorRate: n ? Math.round((e4 + e5) / n * 1000) / 10 : 0, p50: pctl(ms, .5), p95: pctl(ms, .95), visitors: ips.size, flagged: fl }; }

// Lifetime retention: nothing is ever deleted automatically. Today's file is plain JSONL; past days are gzipped.
function createLogger({ dir = null, ring = 5000, diskBytes = 1024 ** 3, warnPct = 60, stdout = true, out = s => process.stdout.write(s + '\n'), now = () => Date.now() } = {}) {
  const buf = [], bursts = new Map(); let stream = null, streamDay = '', writes = 0, warnedDay = '', statsCache = null;
  const dayOf = t => new Date(t).toISOString().slice(0, 10);
  function files() { return fs.readdirSync(dir).filter(f => DAY_RE.test(f)).sort(); }
  function compressPast() { if (!dir) return; const today = dayOf(now());
    for (const f of files()) { const m = DAY_RE.exec(f); if (m[2] || m[1] >= today || (stream && m[1] === streamDay)) continue;
      const src = path.join(dir, f), dst = src + '.gz';
      try { const raw = fs.readFileSync(src); if (fs.existsSync(dst)) fs.appendFileSync(dst, zlib.gzipSync(raw)); else fs.writeFileSync(dst, zlib.gzipSync(raw)); fs.unlinkSync(src); } catch { /* retry next rollover */ } } }
  const parse = (t, evs) => { for (const l of t.split('\n')) if (l) { try { evs.push(JSON.parse(l)); } catch { /* partial line */ } } };
  function readDay(f) { const evs = []; try { const b = fs.readFileSync(path.join(dir, f)); parse(f.endsWith('.gz') ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8'), evs); } catch { /* unreadable file */ } return evs; }
  // read every day file overlapping [fromDay, toDay]; one day at a time, so memory stays bounded by the range
  function readFiles(fromDay = '', toDay = '9999') { const evs = []; for (const f of files()) { const d = DAY_RE.exec(f)[1]; if (d < fromDay || d > toDay) continue; for (const e of readDay(f)) evs.push(e); } return evs; }
  function load() { const fl = files(), evs = []; for (let i = fl.length - 1; i >= 0 && evs.length < ring; i--) evs.unshift(...readDay(fl[i])); buf.push(...evs.slice(-ring)); }
  function disk() { if (!dir) return null; let logs = 0, n = 0; for (const f of files()) { try { logs += fs.statSync(path.join(dir, f)).size; n++; } catch {} }
    let used = null, total = diskBytes; try { const s = fs.statfsSync(dir); total = Math.min(diskBytes, s.blocks * s.bsize) || diskBytes; used = (s.blocks - s.bfree) * s.bsize; } catch { /* statfs unsupported */ }
    const u = used ?? logs, pct = Math.round(u / total * 1000) / 10; return { logsBytes: logs, files: n, usedBytes: u, totalBytes: total, pct, warnPct, warn: pct >= warnPct }; }
  function checkDisk() { const d = disk(), day = dayOf(now()); if (d && d.warn && warnedDay !== day) { warnedDay = day; record({ t: new Date(now()).toISOString(), id: crypto.randomBytes(8).toString('hex'), kind: 'disk', err: 'Disk ' + d.pct + '% full (logs ' + Math.round(d.logsBytes / 1048576) + ' MB); logs are never deleted automatically', flags: ['disk_warning'] }); } return d; }
  function persist(line) { if (!dir) return; const day = dayOf(now());
    if (day !== streamDay || !stream) { const old = stream; streamDay = day; stream = fs.createWriteStream(path.join(dir, 'requests-' + day + '.jsonl'), { flags: 'a' }); stream.on('error', () => { stream = null; });
      if (old) old.end(() => { try { compressPast(); } catch {} }); else compressPast(); setImmediate(checkDisk); }
    stream && stream.write(line + '\n'); if (++writes % 1000 === 0) setImmediate(checkDisk); }
  if (dir) { try { fs.mkdirSync(dir, { recursive: true }); compressPast(); load(); } catch (e) { dir = null; } }
  // Long-term stats: one aggregate per day; past days are immutable so they're cached in daily-stats.json.
  function longStats() { if (!dir) return { days: [[dayOf(now()), dayStats(buf)]], disk: null };
    const cf = path.join(dir, 'daily-stats.json'); if (!statsCache) { try { statsCache = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch { statsCache = {}; } }
    const today = dayOf(now()); let dirty = false; const out = [];
    for (const f of files()) { const d = DAY_RE.exec(f)[1]; if (d === today) continue; if (!statsCache[d] || statsCache[d]._src !== f) { statsCache[d] = { ...dayStats(readDay(f)), _src: f }; dirty = true; } }
    if (dirty) { try { fs.writeFileSync(cf, JSON.stringify(statsCache)); } catch {} }
    for (const d of Object.keys(statsCache).sort()) if (d !== today) { const { _src, ...v } = statsCache[d]; out.push([d, v]); }
    out.push([today, dayStats(buf.filter(e => String(e.t).startsWith(today)))]);
    return { days: out, disk: disk() }; }
  function record(ev) { buf.push(ev); if (buf.length > ring) buf.splice(0, buf.length - ring); const line = JSON.stringify(ev); if (stdout) out(line); persist(line); return ev; }
  function burst(ip, status) { if (!BURST_CODES.has(status) || !ip) return false; const t = now(), a = (bursts.get(ip) || []).filter(x => t - x < BURST_WIN); a.push(t); bursts.set(ip, a);
    if (bursts.size > 5000) for (const [k, v] of bursts) if (!v.length || t - v[v.length - 1] > BURST_WIN) bursts.delete(k); return a.length >= BURST_N; }

  // Attach to one request: sets X-Request-Id, counts bytes, logs on finish. Handlers annotate via res.log = { uid, err, flags: [] }.
  function begin(req, res, ip) {
    const t0 = process.hrtime.bigint(), start = now(), id = crypto.randomBytes(8).toString('hex'), u = new URL(req.url, 'http://x');
    res.log = { uid: null, err: null, flags: [] }; res.setHeader('X-Request-Id', id); let bytes = 0;
    const w = res.write, e = res.end;
    res.write = function (c, ...a) { if (c) bytes += typeof c === 'string' ? Buffer.byteLength(c) : c.length; return w.call(this, c, ...a); };
    res.end = function (c, ...a) { if (c && typeof c !== 'function') bytes += typeof c === 'string' ? Buffer.byteLength(c) : c.length; return e.call(this, c, ...a); };
    let done = false;
    const fin = () => { if (done) return; done = true; const st = res.statusCode, L = res.log, flags = [...new Set(L.flags)];
      if (st < 400 && u.pathname === '/api/health' && /^Render\//.test(req.headers['user-agent'] || '')) return; // platform health checks every few seconds: noise
      if (PROBE.test(u.pathname)) flags.push('probe'); if (burst(ip, st)) flags.push('burst');
      if (!res.writableFinished && !flags.includes('aborted') && res.destroyed) flags.push('aborted');
      const ev = { t: new Date(start).toISOString(), id, method: req.method, path: clip(u.pathname, 300) + redactQuery(u.search), status: st,
        ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10, bytes, uid: L.uid, ip: clip(ip, 64), ua: clip(req.headers['user-agent'], 300),
        ref: origin(req.headers.referer), ct: clip(req.headers['content-type'], 100) };
      if (st >= 400 && L.err) ev.err = clip(L.err, 300); if (L.stack) ev.stack = clip(L.stack, 4000); if (flags.length) ev.flags = flags;
      record(ev); };
    res.on('finish', fin); res.on('close', fin);
    return id;
  }
  function error(err, extra = {}) { return record({ t: new Date(now()).toISOString(), id: crypto.randomBytes(8).toString('hex'), kind: 'exception', ...extra, err: clip(err && err.message || err, 300), stack: clip(err && err.stack, 4000), flags: ['exception'] }); }

  // Admin query: newest first. Reads the files when the range starts before the ring buffer.
  function query(f = {}, limit = 500) {
    const from = f.from ? Date.parse(f.from) : null, to = f.to ? Date.parse(f.to) : null;
    const Q = parseQuery(f.q);
    let src = buf; if (dir && ((from && (!buf.length || from < Date.parse(buf[0].t))) || Q.length)) { const seen = new Set(), m = []; for (const e of [...readFiles(from ? dayOf(from) : '', to ? dayOf(to) : '9999'), ...buf]) { const k = e.id || e.t + (e.kind || ''); if (!seen.has(k)) { seen.add(k); m.push(e); } } src = m.sort((a, b) => String(a.t).localeCompare(String(b.t))); }
    const sc = f.status ? String(f.status) : '', pth = (f.path || '').toLowerCase(), ip = f.ip || '', uid = f.uid ? +f.uid : null, m = (f.method || '').toUpperCase();
    const ok = e => { const t = Date.parse(e.t); if (from && t < from) return false; if (to && t > to) return false;
      if (sc) { if (/^[1-5]xx$/.test(sc)) { if (String(e.status || 0)[0] !== sc[0]) return false; } else if (String(e.status) !== sc) return false; }
      if (pth && !String(e.path || '').toLowerCase().includes(pth)) return false; if (ip && e.ip !== ip) return false; if (uid != null && e.uid !== uid) return false;
      if (m && e.method !== m) return false; if (f.suspicious && !(e.flags && e.flags.length)) return false; return Q.every(q => matchTerm(e, q)); };
    const all = src.filter(ok), days = {}, hours = {}, status = {}, ips = {}, p4 = {}, flagged = {};
    for (const e of all) { const h = String(e.t).slice(0, 13); hours[h] = (hours[h] || 0) + 1; const dd = String(e.t).slice(0, 10); days[dd] = (days[dd] || 0) + 1; const c = e.status ? String(e.status)[0] + 'xx' : 'exception'; status[c] = (status[c] || 0) + 1;
      if (e.ip) ips[e.ip] = (ips[e.ip] || 0) + 1; if (e.status >= 400 && e.status < 500) { const k = String(e.path).split('?')[0]; p4[k] = (p4[k] || 0) + 1; }
      for (const fl of e.flags || []) flagged[fl] = (flagged[fl] || 0) + 1; }
    const top = (o, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    // Compact response-time points for the admin chart: one per request, capped; above the cap keep the slowest request of each equal slice.
    let points; if (f.pts) { const cap = Math.max(100, Math.min(5000, +f.pts || 5000)), pt = e => ({ t: e.t, ms: e.ms ?? null, status: e.status || 0, path: String(e.path || e.where || '').slice(0, 120), id: e.id || e.t });
      if (all.length <= cap) points = all.map(pt); else { points = []; const k = all.length / cap; for (let i = 0; i < cap; i++) { let b = null; for (let j = Math.floor(i * k), J = Math.floor((i + 1) * k); j < J; j++) if (!b || (all[j].ms || 0) > (b.ms || 0)) b = all[j]; if (b) points.push(pt(b)); } } }
    return { total: all.length, buffered: buf.length, ...(points ? { points, sampled: points.length < all.length } : {}), oldest: src.length ? src[0].t : null, disk: disk(), events: all.slice(-limit).reverse(), summary: { hours, days, status, topIps: top(ips), top4xx: top(p4), flagged } };
  }
  // One event by request id (ring first, then the on-disk history, newest day first) plus context: same IP or user within ±5 min.
  function find(id) { id = String(id || ''); if (!/^[\w-]{1,40}$/.test(id)) return null; let ev = null;
    for (let i = buf.length - 1; i >= 0; i--) if (buf[i].id === id) { ev = buf[i]; break; }
    if (!ev && dir) { const fl = files(); for (let i = fl.length - 1; i >= 0 && !ev; i--) ev = readDay(fl[i]).find(e => e.id === id) || null; }
    if (!ev) return null; const t = Date.parse(ev.t), lo = t - 5 * 60e3, hi = t + 5 * 60e3;
    let pool = buf.filter(e => { const x = Date.parse(e.t); return x >= lo && x <= hi; });
    if (dir && (!buf.length || lo < Date.parse(buf[0].t))) { const seen = new Set(); pool = [...readFiles(dayOf(lo), dayOf(hi)), ...buf].filter(e => { const x = Date.parse(e.t), k = e.id || e.t; if (x < lo || x > hi || seen.has(k)) return false; seen.add(k); return true; }); }
    const rel = pool.filter(e => e.id !== id && ((ev.ip && e.ip === ev.ip) || (ev.uid != null && e.uid === ev.uid))).sort((a, b) => String(a.t).localeCompare(String(b.t))).slice(-200);
    return { event: ev, related: rel }; }
  return { begin, error, record, query, find, longStats, disk, checkDisk, compressPast, redactQuery, buffer: buf, close: () => { if (stream) stream.end(); } };
}
module.exports = { dayStats, createLogger, redactQuery, PROBE, parseQuery, matchTerm };
