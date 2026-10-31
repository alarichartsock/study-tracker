'use strict';
// Structured request logging: one JSON line per request to stdout (Render app logs), an in-memory ring buffer for the
// admin Logs view, and a rotating JSONL file (logs/requests-YYYY-MM-DD.jsonl) capped by size and age.
// Never logged: request bodies, passwords, cookies, Authorization headers, Stripe payloads, tokens, emails.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const SECRET_KEY = /(token|code|key|secret|pass|pwd|session|sid|sig|state|email|auth|otp|nonce|ticket|credential|cs_|client_secret)/i;
const redactQuery = search => { if (!search || search === '?') return ''; const q = new URLSearchParams(search), out = [];
  for (const [k, v] of q) out.push(encodeURIComponent(k) + '=' + (SECRET_KEY.test(k) || /@|%40/.test(v) || /^(sk|rk|pk|whsec|cs|pi|cus|sub|tok)_/.test(v) || v.length > 64 ? '[redacted]' : encodeURIComponent(v)));
  return out.length ? '?' + out.join('&') : ''; };
const PROBE = /(^|\/)(\.env|\.git|\.svn|\.hg|\.ds_store|\.aws|\.ssh|wp-admin|wp-login|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|myadmin|adminer|cgi-bin|vendor\/phpunit|actuator|server-status|config\.(php|json|yml|yaml)|\.php$|\.asp|\.jsp|etc\/passwd|boaform|HNAP1|owa\/|autodiscover)/i;
const BURST_CODES = new Set([401, 403, 404, 415]), BURST_WIN = 60e3, BURST_N = 10;
const origin = r => { try { return r ? new URL(r).origin : null; } catch { return null; } };
const clip = (v, n) => v == null ? null : String(v).slice(0, n);

function createLogger({ dir = null, ring = 5000, maxBytes = 20 * 1024 * 1024, maxDays = 14, stdout = true, out = s => process.stdout.write(s + '\n'), now = () => Date.now() } = {}) {
  const buf = [], bursts = new Map(); let stream = null, streamDay = '', writes = 0;
  if (dir) { try { fs.mkdirSync(dir, { recursive: true }); prune(); load(); } catch (e) { dir = null; } }
  function files() { return fs.readdirSync(dir).filter(f => /^requests-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); }
  function prune() { if (!dir) return; const fl = files(), cutoff = new Date(now() - maxDays * 864e5).toISOString().slice(0, 10);
    let sizes = fl.map(f => [f, fs.statSync(path.join(dir, f)).size]), total = sizes.reduce((a, x) => a + x[1], 0);
    for (const [f, s] of sizes) { const day = f.slice(9, 19), cur = f === 'requests-' + streamDay + '.jsonl';
      if (!cur && (day < cutoff || total > maxBytes)) { try { fs.unlinkSync(path.join(dir, f)); total -= s; } catch { /* ignore */ } } }
    if (total > maxBytes && stream) { try { stream.end(); } catch {} stream = null; try { fs.truncateSync(path.join(dir, 'requests-' + streamDay + '.jsonl'), 0); } catch {} } }
  function readFiles() { const evs = []; for (const f of files()) { let t = ''; try { t = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; } for (const l of t.split('\n')) if (l) { try { evs.push(JSON.parse(l)); } catch { /* partial line */ } } } return evs; }
  function load() { const evs = readFiles(); buf.push(...evs.slice(-ring)); }
  function persist(line, t) { if (!dir) return; const day = new Date(t).toISOString().slice(0, 10);
    if (day !== streamDay || !stream) { if (stream) stream.end(); streamDay = day; stream = fs.createWriteStream(path.join(dir, 'requests-' + day + '.jsonl'), { flags: 'a' }); stream.on('error', () => { stream = null; }); prune(); }
    stream && stream.write(line + '\n'); if (++writes % 500 === 0) prune(); }
  function record(ev) { buf.push(ev); if (buf.length > ring) buf.splice(0, buf.length - ring); const line = JSON.stringify(ev); if (stdout) out(line); persist(line, Date.parse(ev.t) || now()); return ev; }
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
  function error(err, extra = {}) { return record({ t: new Date(now()).toISOString(), kind: 'exception', ...extra, err: clip(err && err.message || err, 300), stack: clip(err && err.stack, 4000), flags: ['exception'] }); }

  // Admin query: newest first. Reads the files when the range starts before the ring buffer.
  function query(f = {}, limit = 500) {
    const from = f.from ? Date.parse(f.from) : null, to = f.to ? Date.parse(f.to) : null;
    let src = buf; if (dir && from && buf.length && from < Date.parse(buf[0].t)) src = readFiles();
    const sc = f.status ? String(f.status) : '', pth = (f.path || '').toLowerCase(), ip = f.ip || '', uid = f.uid ? +f.uid : null, m = (f.method || '').toUpperCase();
    const ok = e => { const t = Date.parse(e.t); if (from && t < from) return false; if (to && t > to) return false;
      if (sc) { if (/^[1-5]xx$/.test(sc)) { if (String(e.status || 0)[0] !== sc[0]) return false; } else if (String(e.status) !== sc) return false; }
      if (pth && !String(e.path || '').toLowerCase().includes(pth)) return false; if (ip && e.ip !== ip) return false; if (uid != null && e.uid !== uid) return false;
      if (m && e.method !== m) return false; if (f.suspicious && !(e.flags && e.flags.length)) return false; return true; };
    const all = src.filter(ok), hours = {}, status = {}, ips = {}, p4 = {}, flagged = {};
    for (const e of all) { const h = String(e.t).slice(0, 13); hours[h] = (hours[h] || 0) + 1; const c = e.status ? String(e.status)[0] + 'xx' : 'exception'; status[c] = (status[c] || 0) + 1;
      if (e.ip) ips[e.ip] = (ips[e.ip] || 0) + 1; if (e.status >= 400 && e.status < 500) { const k = String(e.path).split('?')[0]; p4[k] = (p4[k] || 0) + 1; }
      for (const fl of e.flags || []) flagged[fl] = (flagged[fl] || 0) + 1; }
    const top = (o, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    return { total: all.length, buffered: buf.length, oldest: src.length ? src[0].t : null, events: all.slice(-limit).reverse(), summary: { hours, status, topIps: top(ips), top4xx: top(p4), flagged } };
  }
  return { begin, error, record, query, redactQuery, buffer: buf, close: () => { if (stream) stream.end(); } };
}
module.exports = { createLogger, redactQuery, PROBE };
