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
