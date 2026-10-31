'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createDeploys } = require('../lib/deploys'); const { createApp } = require('../server');

test('deploy history: seed backfill, durable boot records matched to deploys, unknown boots kept, optional Render API refresh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-dep-')), seed = require('../lib/deploys-seed.json');
  assert.ok(seed.length > 10 && seed.every(d => d.id && d.start));
  const last = seed[seed.length - 1]; let T = Date.parse(last.finish) - 5000;
  const D = createDeploys({ dir, env: { RENDER_GIT_COMMIT: last.commit + 'deadbeef', RENDER_GIT_BRANCH: 'main' }, now: () => T });
  D.recordBoot(); const m = D.list().find(d => d.id === last.id); assert.equal(m.boot, new Date(T).toISOString()); assert.equal(m.t, last.finish);
  T = Date.parse('2030-01-01T00:00:00Z'); createDeploys({ dir, env: { RENDER_GIT_COMMIT: 'abcdef1234' }, now: () => T }).recordBoot();
  const l = D.list(), u = l[l.length - 1]; assert.equal(u.status, 'boot'); assert.equal(u.commit, 'abcdef1'); assert.equal(u.t, '2030-01-01T00:00:00.000Z');
  assert.equal(fs.readFileSync(path.join(dir, 'boots.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(await D.refreshFromApi(), 'skip');
  let auth; const A = createDeploys({ dir, env: { RENDER_API_KEY: 'k', RENDER_SERVICE_ID: 'srv-x' }, fetchFn: async (u, o) => { auth = o.headers.Authorization; return { ok: true, json: async () => [{ deploy: { id: 'dep-new', commit: { id: '1234567890', message: 'x\ny' }, startedAt: '2030-02-01T00:00:00Z', finishedAt: '2030-02-01T00:01:00Z', status: 'live' } }] }; } });
  assert.equal(await A.refreshFromApi(), 1); assert.equal(auth, 'Bearer k'); const n = A.list().find(d => d.id === 'dep-new'); assert.equal(n.msg, 'x'); assert.equal(n.commit, '1234567');
});

test('admin long-term stats include hourly Pacific buckets and deploys; UI draws markers on all three charts', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-dep2-'));
  const s = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, logDir: path.join(dir, 'logs'), gaApiSecret: '' });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => s.close(r))); const base = `http://127.0.0.1:${s.address().port}`;
  const ck = (await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'boss', password: 'pass-12345', agree: true, birthYear: 1990 }) })).headers.get('set-cookie').split(';')[0];
  await new Promise(r => setTimeout(r, 50));
  const j = await (await fetch(base + '/api/admin/logs/stats', { headers: { Cookie: ck } })).json();
  assert.equal(j.tz, 'America/Los_Angeles'); assert.ok(Array.isArray(j.hours) && j.hours.length); assert.match(j.hours[0][0], /^\d{4}-\d{2}-\d{2}T\d{2}$/); assert.ok(j.deploys.length > 10);
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.equal((js.match(/depMarks\(/g) || []).length, 3, '3 charts'); assert.ok(js.includes('const depMarks = ')); for (const x of ['ACT.ltRange', 'lt-err-dep', 'nearDep', "timeZone: 'America/Los_Angeles'", 'Per day (Pacific)']) assert.ok(js.includes(x), x);
});
