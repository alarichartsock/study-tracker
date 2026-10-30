'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server'); const IN = require('../lib/indexnow');
async function start() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-in-')); const s = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise(r => s.close(r)) }; }

test('IndexNow key file is served (GET and HEAD) with just the key', async t => {
  assert.match(IN.KEY, /^[0-9a-f]{32}$/);
  const app = await start(); t.after(app.close);
  const r = await fetch(app.base + IN.KEY_PATH); assert.equal(r.status, 200); assert.equal(await r.text(), IN.KEY); assert.match(r.headers.get('content-type'), /text\/plain/);
  const h = await fetch(app.base + IN.KEY_PATH, { method: 'HEAD' }); assert.equal(h.status, 200); assert.equal(await h.text(), '');
});

test('submit posts host, key, keyLocation and the sitemap URLs', async () => {
  let call; const s = await IN.submit(undefined, async (u, o) => { call = { u, o }; return { status: 202 }; });
  assert.equal(s, 202); assert.equal(call.u, 'https://api.indexnow.org/indexnow'); assert.equal(call.o.method, 'POST');
  const b = JSON.parse(call.o.body); assert.equal(b.host, 'studyhertz.com'); assert.equal(b.key, IN.KEY);
  assert.equal(b.keyLocation, 'https://studyhertz.com/' + IN.KEY + '.txt'); assert.deepEqual(b.urlList, ['https://studyhertz.com/', ...['es', 'zh-cn', 'ko', 'hi', 'vi', 'fr'].map(p => 'https://studyhertz.com/' + p + '/'), 'https://studyhertz.com/pricing', 'https://studyhertz.com/terms', 'https://studyhertz.com/privacy']);
});

test('onDeploy submits once per commit in production, skips elsewhere, logs only the status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-in-m-')); let n = 0; const logs = [];
  const fetchFn = async () => (n++, { status: 200 }), log = m => logs.push(m);
  assert.equal(await IN.onDeploy({ env: { RENDER_GIT_COMMIT: 'a' }, dir, fetchFn, log }), 'skip');
  const env = { RENDER: 'true', RENDER_GIT_COMMIT: 'a' };
  assert.equal(await IN.onDeploy({ env, dir, fetchFn, log }), 200);
  assert.equal(await IN.onDeploy({ env, dir, fetchFn, log }), 'dup');
  assert.equal(await IN.onDeploy({ env: { ...env, RENDER_GIT_COMMIT: 'b' }, dir, fetchFn, log }), 200);
  assert.equal(n, 2); assert.deepEqual(logs, ['IndexNow submit: 200', 'IndexNow submit: 200']);
  assert.equal(await IN.onDeploy({ env: { ...env, RENDER_GIT_COMMIT: 'c' }, dir, fetchFn: async () => { throw new Error('x'); }, log }), 'error');
  assert.equal(fs.readFileSync(path.join(dir, '.indexnow-commit'), 'utf8'), 'b');
});

test('every <img> in the served HTML has an alt attribute', async t => {
  const app = await start(); t.after(app.close);
  for (const p of ['/', '/pricing', '/terms', '/privacy']) {
    const imgs = (await (await fetch(app.base + p)).text()).match(/<img\b[^>]*>/g) || [];
    for (const i of imgs) { assert.match(i, /\balt="/, p + ': ' + i); if (/\balt=""/.test(i)) assert.match(i, /aria-hidden="true"/, p + ' decorative img must be aria-hidden: ' + i); }
  }
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const i of js.match(/<img\b[^>]*>/g) || []) assert.match(i, /\balt=/, 'app.js: ' + i);
});
