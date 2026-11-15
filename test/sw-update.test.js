'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('node:vm'), crypto = require('crypto');
const { createApp } = require('../server');

function expectedBuild() {
  const h = crypto.createHash('sha1');
  for (const rel of ['public/sw.js', 'public/index.html', 'public/app.js', 'public/style.css']) h.update(fs.readFileSync(path.join(__dirname, '..', rel)));
  return h.digest('base64url').slice(0, 16);
}
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcat-sw-'));
  const server = createApp({ dataFile: path.join(dir, 'data.json'), minSessionSec: 0, quiet: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const client = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers, text };
  };
  return { base, client, close: () => new Promise(r => server.close(r)) };
}

function loadSW() {
  const stores = new Map(), deleted = [], fetched = [], order = [];
  const listeners = {};
  const keyOf = req => typeof req === 'string' ? new URL(req, 'https://studyhertz.com').pathname : new URL(req.url).pathname;
  let skipped = false, claimed = false;
  const sandbox = { location: { origin: 'https://studyhertz.com' }, console, Request: global.Request, Response: global.Response, URL: global.URL, failPath: '', offline: false };
  sandbox.caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new Map()); const box = stores.get(name);
      return { async put(req, res) { box.set(keyOf(req), res); }, async match(req) { return box.get(keyOf(req)); } }; },
    async keys() { return [...stores.keys()]; },
    async delete(k) { deleted.push(k); order.push('delete:' + k); return stores.delete(k); },
    async match(req) { const key = keyOf(req); for (const box of stores.values()) if (box.has(key)) return box.get(key); },
  };
  sandbox.fetch = async req => {
    fetched.push(req);
    if (sandbox.offline) throw new TypeError('Failed to fetch');
    const p = new URL(req.url).pathname;
    if (p === sandbox.failPath) return new Response('no', { status: 404 });
    return new Response('ok:' + p, { status: 200 });
  };
  sandbox.self = sandbox;
  sandbox.skipWaiting = async () => { skipped = true; order.push('skipWaiting'); };
  sandbox.clients = { claim: async () => { claimed = true; order.push('claim'); }, matchAll: async () => [], openWindow() {}, };
  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), sandbox, { filename: 'sw.js' });
  async function fire(type, event) { let p; for (const fn of listeners[type] || []) fn(Object.assign({ waitUntil(x) { p = x; }, respondWith(x) { p = x; } }, event)); if (p) await p; return p; }
  return { sandbox, stores, deleted, fetched, order, fire, skipped: () => skipped, claimed: () => claimed };
}

test('shell cache is v176 and only old studyhertz-shell caches are dropped', () => {
  const sw = loadSW();
  assert.equal(sw.sandbox.SHSW.CACHE, 'studyhertz-shell-v176');
  assert.deepEqual(sw.sandbox.SHSW.staleShellCaches(['studyhertz-shell-v174', 'studyhertz-shell-v175', 'studyhertz-shell-v176', 'other-cache'], 'studyhertz-shell-v176'), ['studyhertz-shell-v174', 'studyhertz-shell-v175']);
  const o = 'https://studyhertz.com';
  const H = sw.sandbox.SHSW.shouldHandleFetch, F = sw.sandbox.SHSW.wantsFresh;
  assert.equal(H({ method: 'GET' }, new URL(o + '/app.js')), true);
  assert.equal(H({ method: 'POST' }, new URL(o + '/app.js')), false);
  assert.equal(H({ method: 'GET' }, new URL(o + '/api/version')), false);
  assert.equal(H({ method: 'GET' }, new URL(o + '/accent-icon/4c6ef5.svg')), false);
  assert.equal(H({ method: 'GET' }, new URL('https://example.com/app.js')), false);
  assert.equal(F(new URL(o + '/app.js'), { mode: 'same-origin' }), true);
  assert.equal(F(new URL(o + '/style.css'), { mode: 'no-cors' }), true);
  assert.equal(F(new URL(o + '/'), { mode: 'navigate' }), true);
  assert.equal(F(new URL(o + '/pricing'), { mode: 'navigate' }), true);
  assert.equal(F(new URL(o + '/mix.js'), { mode: 'same-origin' }), true);
  assert.equal(F(new URL(o + '/favicon.svg'), { mode: 'same-origin' }), false);
});

test('install skipWaiting()s after a reload fetch; a failed shell does not activate', async () => {
  const sw = loadSW();
  await sw.fire('install');
  assert.equal(sw.skipped(), true);
  assert.ok(sw.fetched.length >= 5);
  assert.ok(sw.fetched.every(r => r.cache === 'reload'), 'shell install bypasses the HTTP cache');
  assert.ok(sw.stores.get('studyhertz-shell-v176').has('/app.js'));
  assert.ok(sw.stores.get('studyhertz-shell-v176').has('/'));
  const bad = loadSW();
  bad.sandbox.failPath = '/style.css';
  await assert.rejects(() => bad.fire('install'));
  assert.equal(bad.skipped(), false);
});

test('activate deletes old shell caches then claims clients', async () => {
  const sw = loadSW();
  sw.stores.set('studyhertz-shell-v174', new Map([['/', new Response('old')]]));
  sw.stores.set('studyhertz-shell-v175', new Map([['/', new Response('prev')]]));
  sw.stores.set('studyhertz-shell-v176', new Map());
  sw.stores.set('other-cache', new Map([['/x', new Response('keep')]]));
  await sw.fire('activate');
  assert.deepEqual(sw.deleted, ['studyhertz-shell-v174', 'studyhertz-shell-v175']);
  assert.equal(sw.claimed(), true);
  assert.ok(sw.order.indexOf('delete:studyhertz-shell-v175') < sw.order.indexOf('claim'));
  assert.equal(sw.stores.has('studyhertz-shell-v174'), false);
  assert.equal(sw.stores.has('studyhertz-shell-v175'), false);
  assert.equal(sw.stores.has('studyhertz-shell-v176'), true);
  assert.equal(sw.stores.has('other-cache'), true);
});

test('app.js and the HTML shell are network-first with cache reload, and fall back offline', async () => {
  const sw = loadSW();
  const respond = async req => { let body; await sw.fire('fetch', { request: req, respondWith(p) { body = p; } }); return body; };
  const online = await respond(new Request('https://studyhertz.com/app.js'));
  assert.equal(online.status, 200);
  assert.equal(await online.text(), 'ok:/app.js');
  assert.equal(sw.fetched.at(-1).cache, 'reload');
  assert.ok(sw.stores.get('studyhertz-shell-v176').has('/app.js'));
  const nav = await respond({ method: 'GET', url: 'https://studyhertz.com/pricing', mode: 'navigate', credentials: 'same-origin' });
  assert.equal(await nav.text(), 'ok:/pricing');
  assert.equal(sw.fetched.at(-1).cache, 'reload');
  let handled = false;
  await sw.fire('fetch', { request: new Request('https://studyhertz.com/api/state'), respondWith() { handled = true; } });
  await sw.fire('fetch', { request: new Request('https://studyhertz.com/accent-icon/4c6ef5.svg'), respondWith() { handled = true; } });
  assert.equal(handled, false);
  sw.sandbox.offline = true;
  const cached = await respond(new Request('https://studyhertz.com/app.js'));
  assert.equal(await cached.text(), 'ok:/app.js');
  const miss = await respond(new Request('https://studyhertz.com/nope'));
  assert.equal(miss, undefined); // nothing cached, including the shell document
});

test('reload guard: one update reload, no loop, defer while a form is dirty', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const decide = new Function('s', js.slice(js.indexOf('function swReloadDecision('), js.indexOf('function fieldDirty(')) + '\nreturn swReloadDecision(s);');
  const base = { now: 1_000_000, lastReloadAt: 0, reloadCount: 0, reloadedFor: '', remote: 'bbb', local: 'aaa', dirty: false, hadController: true };
  assert.equal(decide({ ...base, reason: 'controller' }), 'reload');
  assert.equal(decide({ ...base, reason: 'controller', hadController: false }), 'skip'); // first claim
  assert.equal(decide({ ...base, reason: 'controller', lastReloadAt: base.now - 5000 }), 'skip'); // WebKit echo / favicon chain
  assert.equal(decide({ ...base, reason: 'controller', lastReloadAt: base.now - 20000 }), 'reload');
  assert.equal(decide({ ...base, reason: 'controller', dirty: true }), 'defer');
  assert.equal(decide({ ...base, reason: 'version' }), 'reload');
  assert.equal(decide({ ...base, reason: 'version', remote: 'aaa' }), 'skip');
  assert.equal(decide({ ...base, reason: 'version', remote: '', local: '' }), 'skip');
  assert.equal(decide({ ...base, reason: 'version', reloadedFor: 'bbb', reloadCount: 2 }), 'skip');
  assert.equal(decide({ ...base, reason: 'version', reloadedFor: 'bbb', reloadCount: 1 }), 'reload'); // one retry if the shell was still stale
  assert.equal(decide({ ...base, reason: 'version', dirty: true }), 'defer');
  assert.equal(decide({ ...base, reason: 'nope' }), 'skip');
  const mod = new Function(js.slice(js.indexOf('function fieldDirty('), js.indexOf('function unsavedModalOpen(')) + '\nreturn { fieldDirty, formDirty };')();
  assert.equal(mod.fieldDirty({ tagName: 'INPUT', type: 'text', value: 'note', defaultValue: '' }), true);
  assert.equal(mod.fieldDirty({ tagName: 'INPUT', type: 'text', value: 'a', defaultValue: 'a' }), false);
  assert.equal(mod.fieldDirty({ tagName: 'INPUT', type: 'hidden', value: '3', defaultValue: '' }), true);
  assert.equal(mod.fieldDirty({ tagName: 'INPUT', type: 'checkbox', checked: true, defaultChecked: false }), true);
  assert.equal(mod.fieldDirty({ tagName: 'INPUT', type: 'button', value: 'Save', defaultValue: '' }), false);
  assert.equal(mod.fieldDirty({ tagName: 'SELECT', options: [{ selected: true, defaultSelected: true }] }), false);
  assert.equal(mod.fieldDirty({ tagName: 'SELECT', options: [{ selected: true, defaultSelected: false }] }), true);
  const dirty = mod.formDirty({ querySelectorAll: () => [{ tagName: 'INPUT', type: 'text', value: 'x', defaultValue: '' }] });
  const clean = mod.formDirty({ querySelectorAll: () => [{ tagName: 'INPUT', type: 'text', value: '', defaultValue: '' }] });
  assert.equal(dirty, true); assert.equal(clean, false);
  assert.match(js, /controllerchange/);
  assert.match(js, /updateViaCache: 'none'/);
  assert.match(js, /visibilitychange', \(\) => \{ if \(!document\.hidden\) swPing\(true\)/);
  assert.match(js, /addEventListener\('focus', \(\) => swPing\(true\)\)/);
  assert.match(js, /if \(!document\.hidden\) swPing\(true\)/); // the 60s data refresh also checks
  assert.match(js, /shUpdateBoot = '1'/);
  assert.match(js, /render\.suppressEnter = !!shUpdateBoot/);
  assert.match(js, /swFlush\(\)/);
});

test('version endpoint matches the shell hash and shell responses revalidate', async t => {
  const app = await start(); t.after(app.close);
  const v = await app.client('/api/version');
  assert.equal(v.status, 200);
  assert.equal(v.body.version, expectedBuild());
  assert.match(v.headers.get('cache-control'), /no-store/);
  const html = await app.client('/');
  assert.match(html.headers.get('cache-control'), /^no-cache, must-revalidate$/);
  assert.match(html.text, new RegExp('<meta name="studyhertz-build" content="' + v.body.version + '">'));
  const price = await app.client('/pricing');
  assert.match(price.text, new RegExp('content="' + v.body.version + '"'));
  assert.match(price.headers.get('cache-control'), /no-cache, must-revalidate/);
  for (const p of ['/sw.js', '/app.js', '/style.css']) {
    const r = await app.client(p);
    assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate', p);
  }
  assert.equal((await app.client('/api/version')).body.version, v.body.version);
});

test('a running or paused timer survives a client reload because it lives on the server', async t => {
  const app = await start(); t.after(app.close);
  const c = app.client;
  assert.equal((await c('/api/register', 'POST', { email: 'sw' + Date.now() + '@example.com', agree: true, birthYear: 1990, username: 'swu', password: 'secret-pass-1' })).status, 200);
  const started = await c('/api/timer/start', 'POST', { subject: 'CARS', mode: 'stopwatch' });
  assert.equal(started.status, 200);
  const again = await c('/api/state');
  assert.equal(again.body.active.start, started.body.start);
  assert.equal(again.body.active.subject, 'CARS');
  assert.equal(again.body.active.paused, false);
  const paused = await c('/api/timer/pause', 'POST', {});
  assert.equal(paused.body.paused, true);
  const after = await c('/api/state');
  assert.equal(after.body.active.paused, true);
  assert.equal(after.body.active.start, started.body.start);
  assert.equal(after.body.active.accum, paused.body.accum);
  assert.ok(after.body.active.accum >= 0);
});
