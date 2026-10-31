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
test('file persistence survives restart, and old files are pruned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  fs.writeFileSync(path.join(dir, 'requests-2020-01-01.jsonl'), '{"t":"2020-01-01T00:00:00Z"}\n');
  const a = createLogger({ dir, stdout: false }); a.record({ t: new Date().toISOString(), id: 'x', status: 200 }); a.close();
  assert.ok(!fs.existsSync(path.join(dir, 'requests-2020-01-01.jsonl')));
  return new Promise(r => setTimeout(r, 50)).then(() => { const b = createLogger({ dir, stdout: false }); assert.equal(b.buffer.length, 1); assert.equal(b.buffer[0].id, 'x'); b.close(); });
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
    const ev = lines.map(l => JSON.parse(l)), all = lines.join('\n');
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
