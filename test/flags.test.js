'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server'), analytics = require('../lib/analytics');
test('client only sends view flags the server accepts (no view:users / admin / mcat)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), m = /const FLAG_VIEWS = (\[[^\]]+\]);/.exec(src);
  assert.ok(m); assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), analytics.VIEW_KEYS);
  assert.match(src, /if \(FLAG_VIEWS\.includes\(view\)\) markFlag\('view:' \+ view\)/);
  for (const v of ['users', 'admin', 'mcat']) assert.ok(!analytics.VIEW_KEYS.includes(v));
});
test('/api/flags stays strict and logs the rejected key', async () => {
  const lines = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-fl-')), server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, requestLog: true, logOut: l => lines.push(l), logDir: null, minSessionSec: 0, gaApiSecret: '' });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`; let ck = '';
  const c = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; await r.text(); return r.status; };
  try {
    await c('/api/register', { username: 'flagger', password: 'pass-12345', agree: true, birthYear: 1990 });
    for (const v of analytics.VIEW_KEYS) assert.equal(await c('/api/flags', { key: 'view:' + v }), 200);
    assert.equal(await c('/api/flags', { key: 'onboarded' }), 200);
    assert.equal(await c('/api/flags', { key: 'view:users' }), 400); assert.equal(await c('/api/flags', { key: 'anything' }), 400);
    await new Promise(r => setTimeout(r, 20));
    assert.ok(lines.some(l => l.includes('"err":"unknown flag: view:users"')));
  } finally { await new Promise(r => server.close(r)); }
});
