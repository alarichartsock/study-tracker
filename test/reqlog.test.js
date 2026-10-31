'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLogger, redactQuery } = require('../lib/reqlog');
const { createApp } = require('../server');

test('redactQuery hides secrets, tokens, codes and emails', () => {
  const q = redactQuery('?code=abc&state=x&token=t&page=2&e=a%40b.com&k=sk_live_123&ref=FRIEND');
  assert.match(q, /code=\[redacted\]/); assert.match(q, /state=\[redacted\]/); assert.match(q, /token=\[redacted\]/); assert.match(q, /e=\[redacted\]/); assert.match(q, /k=\[redacted\]/);
  assert.match(q, /page=2/); assert.match(q, /ref=FRIEND/); assert.equal(redactQuery(''), '');
});
test('file persistence survives restart; past days are gzipped and never deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  fs.writeFileSync(path.join(dir, 'requests-2020-01-01.jsonl'), '{"t":"2020-01-01T00:00:00Z"}\n');
  const a = createLogger({ dir, stdout: false }); a.record({ t: new Date().toISOString(), id: 'x', status: 200 }); a.close();
  assert.ok(!fs.existsSync(path.join(dir, 'requests-2020-01-01.jsonl'))); assert.ok(fs.existsSync(path.join(dir, 'requests-2020-01-01.jsonl.gz')), 'gzipped, not deleted');
  return new Promise(r => setTimeout(r, 50)).then(() => { const b = createLogger({ dir, stdout: false }); assert.equal(b.buffer.length, 2); assert.equal(b.buffer[1].id, 'x'); assert.equal(b.query({ from: '2019-12-31T00:00:00Z' }).total, 2, 'old gz day still searchable'); b.close(); });
});
test('ring buffer is capped', () => { const l = createLogger({ ring: 3, stdout: false }); for (let i = 0; i < 10; i++) l.record({ t: new Date().toISOString(), i }); assert.equal(l.buffer.length, 3); assert.equal(l.buffer[2].i, 9); });

test('server logs one structured line per request with flags; never logs bodies, cookies or passwords', async () => {
  const lines = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-app-'));
  const server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, requestLog: true, logOut: l => lines.push(l), logDir: path.join(dir, 'logs'), minSessionSec: 0, gaApiSecret: '' });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, method = 'GET', body, headers = {}) => { const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }); await r.text(); return r; };
  try {
    const reg = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: 'super-secret-pw', agree: true, birthYear: 1990 }) });
    const ck = reg.headers.get('set-cookie').split(';')[0]; assert.ok(reg.headers.get('x-request-id'));
    const usr = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'user2', password: 'pass-12345', agree: true, birthYear: 1990 }) });
    const ck2 = usr.headers.get('set-cookie').split(';')[0];
    await call('/api/login', 'POST', { username: 'boss', password: 'wrong-password-zz' });
    await call('/.env'); await call('/wp-admin/x.php');
    await call('/api/settings', 'POST', undefined, { 'Content-Type': 'text/plain' });
    await fetch(base + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }).then(r => r.text());
    await call('/api/oauth/google/callback?code=SECRETCODE&state=abc');
    for (let i = 0; i < 11; i++) await call('/api/me/x');
    await call('/api/admin/logs', 'GET', undefined, { Cookie: ck2 });
    await new Promise(r => setTimeout(r, 30));
    await call('/api/health', 'GET', undefined, { 'User-Agent': 'Render/1.0' });
    await new Promise(r => setTimeout(r, 20));
    assert.ok(!lines.some(l => l.includes('Render/1.0')), 'Render health checks not logged');
    const ev = lines.map(l => JSON.parse(l)).filter(e => !e.kind), all = lines.join('\n');
    for (const e of ev) for (const k of ['t', 'id', 'method', 'path', 'status', 'ms', 'bytes', 'ip']) assert.ok(k in e, k);
    assert.ok(!/super-secret-pw|wrong-password-zz|SECRETCODE|sid=/.test(all), 'no secrets in logs');
    const fl = f => ev.filter(e => (e.flags || []).includes(f));
    assert.ok(fl('failed_login').length === 1 && fl('failed_login')[0].status === 401 && fl('failed_login')[0].err);
    assert.equal(fl('probe').length, 2); assert.ok(fl('bad_content_type').some(e => e.status === 415 && e.err === 'JSON required'));
    assert.ok(fl('burst').length >= 1); assert.equal(fl('admin_denied').length, 1); assert.equal(fl('admin_denied')[0].uid, 2);
    assert.ok(ev.find(e => e.path.startsWith('/api/oauth/google/callback')).path.includes('code=[redacted]'));
    const r = await fetch(base + '/api/admin/logs?suspicious=1', { headers: { Cookie: ck } }), d = await r.json();
    assert.equal(r.status, 200); assert.ok(d.events.length >= 5 && d.events.every(e => e.flags)); assert.ok(d.summary.flagged.probe === 2); assert.ok(d.summary.top4xx.length);
    const r2 = await (await fetch(base + '/api/admin/logs?status=4xx&path=wp-admin', { headers: { Cookie: ck } })).json(); assert.equal(r2.total, 1);
    assert.ok(fs.readdirSync(path.join(dir, 'logs')).some(f => f.endsWith('.jsonl')));
  } finally { await new Promise(r => server.close(r)); }
});
test('unexpected exceptions are logged with a stack trace', () => { const lines = [], l = createLogger({ out: x => lines.push(x) }); l.error(new TypeError('boom')); const e = JSON.parse(lines[0]); assert.equal(e.kind, 'exception'); assert.match(e.stack, /TypeError: boom/); });
test('search: free text across fields, field:value tokens, and on-disk history beyond the ring', () => {
  const { parseQuery, matchTerm } = require('../lib/reqlog');
  assert.deepEqual(parseQuery('status:415 ip:1.2.3.4 "bad thing" wp'), [{ field: 'status', v: '415' }, { field: 'ip', v: '1.2.3.4' }, { v: 'bad thing' }, { v: 'wp' }]);
  const e = { id: 'abc123', t: '2026-10-30T00:00:00Z', method: 'POST', path: '/api/admin/logs', status: 415, ip: '1.2.3.4', uid: 7, ua: 'python-requests/2.32', err: 'JSON required', flags: ['bad_content_type'] };
  for (const q of ['python', 'abc123', 'json req', 'bad_content', '415', 'status:4xx', 'user:7', 'path:/api/admin', 'flag:bad_content_type', 'method:post']) assert.ok(parseQuery(q).every(t => matchTerm(e, t)), q);
  for (const q of ['status:200', 'ip:1.2.3.40', 'user:70', 'nomatch']) assert.ok(!parseQuery(q).every(t => matchTerm(e, t)), q);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-q-')), day = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dir, 'requests-' + day + '.jsonl'), [{ t: new Date(Date.now() - 6e4).toISOString(), id: 'old1', path: '/.env', status: 404, ip: '9.9.9.9' }, { t: new Date(Date.now() - 5e4).toISOString(), id: 'old2', path: '/', status: 200, ip: '8.8.8.8' }].map(x => JSON.stringify(x)).join('\n') + '\n');
  const l = createLogger({ dir, ring: 1, stdout: false }); assert.equal(l.buffer.length, 1); // only old2 fits in the ring
  const r = l.query({ q: 'ip:9.9.9.9' }); assert.equal(r.total, 1); assert.equal(r.events[0].id, 'old1');
  assert.equal(l.query({ q: '.env', status: '4xx' }).total, 1); assert.equal(l.query({ q: '.env', status: '2xx' }).total, 0); l.close();
});
test('lifetime retention: rollover gzips, long-term daily stats are cached, disk warning at 60%, find by id with context', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-life-')); let T = Date.parse('2026-10-29T12:00:00Z');
  const l = createLogger({ dir, stdout: false, now: () => T, diskBytes: 1 }); // tiny "disk" => warning fires
  l.record({ t: new Date(T).toISOString(), id: 'a1', method: 'GET', path: '/', status: 200, ms: 10, ip: '1.1.1.1' });
  l.record({ t: new Date(T + 60e3).toISOString(), id: 'a2', method: 'GET', path: '/x', status: 404, ms: 30, ip: '1.1.1.1' });
  T = Date.parse('2026-10-30T12:00:00Z');
  l.record({ t: new Date(T).toISOString(), id: 'b1', method: 'POST', path: '/api/login', status: 401, ms: 5, ip: '2.2.2.2', flags: ['failed_login'] });
  await new Promise(r => setTimeout(r, 80));
  const f = fs.readdirSync(dir); assert.ok(f.includes('requests-2026-10-29.jsonl.gz')); assert.ok(f.includes('requests-2026-10-30.jsonl'));
  const s = l.longStats(), d29 = s.days.find(x => x[0] === '2026-10-29')[1];
  assert.equal(d29.requests, 2); assert.equal(d29.errorRate, 50); assert.equal(d29.visitors, 1); assert.equal(d29.p95, 30);
  assert.ok(fs.existsSync(path.join(dir, 'daily-stats.json'))); assert.ok(s.disk.warn);
  assert.ok(l.buffer.some(e => (e.flags || []).includes('disk_warning')));
  const r = l.find('a1'); assert.equal(r.event.path, '/'); assert.deepEqual(r.related.map(x => x.id), ['a2']); assert.equal(l.find('nope'), null); assert.equal(l.find('../etc'), null);
  l.close();
  const l2 = createLogger({ dir, ring: 1, stdout: false, now: () => T }); assert.equal(l2.find('a2').event.status, 404, 'found in gz history beyond the ring'); l2.close();
});
test('admin log detail route and paused live updates are wired in the client', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /'#\/admin\/logs\/' \+ id/); assert.match(src, /VIEWS\.logev = async/); assert.match(src, /api\('\/api\/admin\/logs\/' \+ encodeURIComponent\(id\)\)/);
  assert.match(src, /data-act="logBack"/); assert.match(src, /data-act="logCopy"/); assert.match(src, /new event/); assert.match(src, /UI\.usersBack && UI\.usersHTML/);
  assert.ok(!/setInterval\([^)]*render\(\)/.test(src), 'no timer re-renders the list');
});

// Response-time points for the admin chart
{
  const assert = require('assert'); const { createLogger } = require('../lib/reqlog');
  const L = createLogger({});
  for (let i = 0; i < 300; i++) L.record({ t: new Date(Date.UTC(2026, 9, 30, 0, 0, i)).toISOString(), id: 'p' + i, kind: 'request', method: 'GET', path: '/x' + i, status: i % 50 ? 200 : 404, ms: i === 137 ? 9999 : i % 7 });
  const a = L.query({ pts: '5000' }, 10); assert.strictEqual(a.points.length, 300); assert.strictEqual(a.sampled, false); assert.deepStrictEqual(Object.keys(a.points[0]).sort(), ['id', 'ms', 'path', 'status', 't']);
  const b = L.query({ pts: '100', status: '2xx' }, 10); assert.strictEqual(b.points.length, 100); assert.ok(b.sampled); assert.ok(b.points.some(p => p.ms === 9999), 'slowest kept'); assert.ok(b.points.every(p => p.status === 200));
  assert.strictEqual(L.query({}, 10).points, undefined);
  console.log('reqlog points ok');
}
