'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { createApp } = require('../server');

test('admin SSE live log stream: admin only, init snapshot, pushes new events, country, own connection not logged', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-live-'));
  const server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, logDir: path.join(dir, 'logs'), gaApiSecret: '', trustProxy: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port, base = `http://127.0.0.1:${port}`;
  const reg = async u => (await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'pass-12345', agree: true, birthYear: 1990 }) })).headers.get('set-cookie').split(';')[0];
  const ck = await reg('boss'), ck2 = await reg('user2');
  assert.equal((await fetch(base + '/api/admin/logs/stream', { headers: { Cookie: ck2 } })).status, 403);
  let buf = ''; const req = http.get({ port, host: '127.0.0.1', path: '/api/admin/logs/stream', headers: { Cookie: ck } });
  const res = await new Promise(r => req.on('response', r)); t.after(() => { req.destroy(); return new Promise(r => server.close(r)); });
  assert.equal(res.statusCode, 200); assert.match(res.headers['content-type'], /text\/event-stream/); assert.match(res.headers['cache-control'], /no-cache/); assert.equal(res.headers['x-accel-buffering'], 'no');
  res.setEncoding('utf8'); res.on('data', c => { buf += c; });
  const until = async re => { for (let i = 0; i < 100 && !re.test(buf); i++) await new Promise(r => setTimeout(r, 20)); assert.match(buf, re); };
  await until(/event: init\ndata: \[/);
  await fetch(base + '/pricing', { headers: { 'CF-IPCountry': 'DE' } }).then(r => r.text());
  await until(/"path":"\/pricing"/);
  const ev = buf.split('\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6))).find(e => e.path === '/pricing');
  assert.equal(ev.status, 200); assert.equal(ev.cc, 'DE'); assert.ok(ev.id && ev.ms != null && ev.ip);
  req.destroy(); await new Promise(r => setTimeout(r, 50));
  assert.ok(!server.rlog.buffer.some(e => e.path === '/api/admin/logs/stream' && e.status === 200), 'own stream not logged');
  assert.ok(server.rlog.buffer.some(e => e.path === '/api/admin/logs/stream' && e.status === 403), 'denied attempts still logged');
});

test('live view UI: route, pause/resume, visits-only toggle, Pacific time, 500 cap', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const s of ["new EventSource('/api/admin/logs/stream')", "'#/admin/live'", 'ACT.livePause', 'ACT.liveMode', "timeZone: 'America/Los_Angeles'", 'L.events.length > 500', "UI.logFrom === 'live'"]) assert.ok(js.includes(s), s);
});

test('admin CSV export: admin only, all matching rows, escaping, formula guard, attachment name', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-csv-'));
  const server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, logDir: path.join(dir, 'logs'), gaApiSecret: '', trustProxy: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r))); const base = `http://127.0.0.1:${server.address().port}`;
  const reg = async u => (await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'pass-12345', agree: true, birthYear: 1990 }) })).headers.get('set-cookie').split(';')[0];
  const ck = await reg('boss'), ck2 = await reg('user2');
  assert.equal((await fetch(base + '/api/admin/logs/export.csv')).status, 401); assert.equal((await fetch(base + '/api/admin/logs/export.csv', { headers: { Cookie: ck2 } })).status, 403);
  for (let i = 0; i < 350; i++) await fetch(base + '/pricing', { headers: { 'User-Agent': '=HYPERLINK("x"),a', 'CF-IPCountry': 'FR' } }).then(r => r.arrayBuffer());
  await fetch(base + '/api/me', { headers: { Cookie: ck2 } });
  const r = await fetch(base + '/api/admin/logs/export.csv?path=/pricing&range=48h', { headers: { Cookie: ck } }), txt = await r.text();
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /attachment; filename="studyhertz-logs-48h-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = txt.replace(/^\ufeff/, '').trim().split('\n'); assert.equal(lines[0], 'id,time_utc,time_pacific,status,method,path,ms,user_id,username,ip,country,user_agent,referrer,flags,reason');
  assert.equal(lines.length - 1, 350); assert.ok(lines[1].includes(',FR,"\'=HYPERLINK(""x""),a",'), lines[1]); assert.match(lines[1], /P[DS]T/);
  const u = await (await fetch(base + '/api/admin/logs/export.csv?uid=' + server.store.db.users.find(x => x.username === 'user2').id, { headers: { Cookie: ck } })).text(); assert.match(u, /,user2,/);
  assert.doesNotMatch(txt + u, /pass-12345|sid=/);
});
