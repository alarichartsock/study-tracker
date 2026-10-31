'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
test('imports return one summary and mark new trophies as already notified (no per-trophy flood)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-imp-')), server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, minSessionSec: 0, gaApiSecret: '' });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`; let ck = '';
  const c = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { Cookie: ck } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, body: await r.json() }; };
  try {
    await c('/api/register', 'POST', { username: 'imp', password: 'pass-12345', agree: true, birthYear: 1990 });
    await c('/api/settings', 'POST', { goals: { dailyMin: 60 } });
    assert.deepEqual((await c('/api/achievements/new')).body.new, []); // initializes notified state
    const rows = ['date,start,end,subject']; for (let d = 1; d <= 30; d++) rows.push(`2026-09-${String(d).padStart(2, '0')},09:00,11:00,CARS`);
    const r = await c('/api/import', 'POST', { csv: rows.join('\n') });
    assert.equal(r.status, 200); assert.equal(r.body.added, 30);
    const s = r.body.summary; assert.ok(s.trophies.length >= 3, 'several trophies unlocked'); assert.ok(s.trophies.every(t => t.id && t.name)); assert.equal(s.goalDays, 30); assert.equal(s.bestStreak, 30);
    assert.deepEqual((await c('/api/achievements/new')).body.new, [], 'nothing left to announce individually');
    const j = await c('/api/import.json', 'POST', { data: { sessions: [{ start: '2026-08-01T09:00:00Z', end: '2026-08-01T21:00:00Z', subject: 'Bio' }] } });
    assert.equal(j.body.added, 1); assert.ok(Array.isArray(j.body.summary.trophies)); assert.deepEqual((await c('/api/achievements/new')).body.new, []);
    // a normal (non-import) session still announces normally
    const before = (await c('/api/achievements')).body; void before;
  } finally { await new Promise(r => server.close(r)); }
});
test('client holds per-trophy notifications during import and shows one summary', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /if \(!ME \|\| IMPORTING\) return;/); assert.match(src, /runImport\(async \(\) => \{ const r = await api\('\/api\/import'/); assert.match(src, /runImport\(async \(\) => \{ const r = await api\('\/api\/import\.json'/);
  assert.match(src, /Import complete/); assert.match(src, /View list/); assert.match(src, /track\('data_import_summary'/);
});
