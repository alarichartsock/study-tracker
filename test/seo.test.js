'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');
async function start() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-seo-')); const s = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise(r => s.close(r)) }; }
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };

test('"/" serves the full landing page in the initial HTML, visible without JS or the API', async t => {
  const app = await start(); t.after(app.close);
  const r = await fetch(app.base + '/', { headers: UA }), h = await r.text();
  assert.equal(r.status, 200);
  assert.match(h, /<h1>Track every MCAT study hour<\/h1>/);
  assert.match(h, /<div id="landing" class="landing">/, 'landing not hidden');
  assert.match(h, /<section class="pricing" id="pricing"/, 'pricing not hidden'); assert.match(h, /\$4\.99/); assert.match(h, /\$39/);
  assert.match(h, /Start free 30-day trial/); assert.match(h, /Everything you need to study with focus/); assert.match(h, /pv-stats/);
  for (const p of ['/', '/pricing', '/terms', '/privacy']) { const x = await (await fetch(app.base + p)).text(); assert.doesNotMatch(x, /not found|failed to load/i, p); }
  assert.match(await (await fetch(app.base + '/terms')).text(), /<h1/); assert.match(await (await fetch(app.base + '/privacy')).text(), /<h1/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(js, /document\.body\.innerHTML\s*=/, 'boot errors never replace the page');
  assert.match(js, /api\('\/api\/me'\)\.catch\(\(\) => ME_FALLBACK\)/);
});

test('HEAD works on every GET static route; robots allows the boot APIs; unknown paths are real 404s', async t => {
  const app = await start(); t.after(app.close);
  for (const p of ['/', '/pricing', '/terms', '/privacy', '/robots.txt', '/sitemap.xml', '/style.css', '/app.js']) {
    const r = await fetch(app.base + p, { method: 'HEAD' }); assert.equal(r.status, 200, p); assert.equal(await r.text(), '', p + ' has no body'); }
  const h = await fetch(app.base + '/robots.txt', { method: 'HEAD' }); assert.match(h.headers.get('content-type'), /text\/plain/); assert.ok(+h.headers.get('content-length') > 0);
  const robots = await (await fetch(app.base + '/robots.txt')).text();
  assert.ok(robots.indexOf('Allow: /api/public-config') >= 0 && robots.indexOf('Allow: /api/me') >= 0 && robots.indexOf('Allow: /api/me') < robots.indexOf('Disallow: /api/'));
  const nf = await fetch(app.base + '/no-such-page', { headers: UA }); assert.equal(nf.status, 404); assert.match(nf.headers.get('content-type'), /text\/html/); assert.match(await nf.text(), /noindex/);
  assert.equal((await fetch(app.base + '/no-such-page', { method: 'HEAD' })).status, 404);
});
