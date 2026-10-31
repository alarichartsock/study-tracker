'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server'); const SEO = require('../lib/seo'); const core = require('../public/i18n.js');
async function start(o = {}) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-sm-')); const s = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, ...o });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise(r => s.close(r)) }; }

test('registry covers every language homepage and the public pages; robots and IndexNow derive from it', () => {
  const paths = SEO.ROUTES.map(r => r.path);
  for (const l of core.LANGS) assert.ok(paths.includes(l === 'en' ? '/' : '/' + core.PATHS[l] + '/'), l);
  for (const p of ['/pricing', '/terms', '/privacy', '/affiliates']) assert.ok(paths.includes(p));
  assert.deepEqual(require('../lib/indexnow').URLS, paths.map(p => 'https://studyhertz.com' + p));
  const rb = SEO.robots(); for (const p of paths.filter(p => !/^\/[a-z-]+\/$/.test(p))) assert.match(rb, new RegExp('^Allow: ' + p + '$', 'm'));
  assert.match(rb, /Sitemap: https:\/\/studyhertz\.com\/sitemap\.xml/);
});

test('served sitemap: every registry URL once, valid dates, hreflang alternates on language pages, all URLs 200', async t => {
  const app = await start(); t.after(app.close);
  const r = await fetch(app.base + '/sitemap.xml'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /xml/);
  const x = await r.text(); assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset [^>]*xmlns:xhtml=/);
  const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]); assert.deepEqual(locs, SEO.urls());
  const mods = [...x.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1]); assert.equal(mods.length, locs.length);
  for (const d of mods) { assert.match(d, /^\d{4}-\d{2}-\d{2}$/); assert.ok(d <= new Date().toISOString().slice(0, 10) && d >= '2026-01-01', d); }
  const es = x.split('<url>').find(b => b.includes('<loc>https://studyhertz.com/es/</loc>'));
  for (const l of core.LANGS) assert.match(es, new RegExp(`hreflang="${l}"`)); assert.match(es, /hreflang="x-default" href="https:\/\/studyhertz.com\/"/);
  assert.doesNotMatch(x.split('<url>').find(b => b.includes('/terms</loc>')), /hreflang/);
  for (const u of locs) assert.equal((await fetch(app.base + u.replace('https://studyhertz.com', ''))).status, 200, u);
});

test('lastmod: seed date when hash matches, today on change, stable once persisted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-sm-st-')), pub = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-sm-pub-'));
  fs.cpSync(path.join(__dirname, '..', 'public'), pub, { recursive: true });
  const seed = Object.fromEntries(SEO.ROUTES.map(r => [r.path, { hash: SEO.hashRoute(r, pub), lastmod: '2026-10-01' }]));
  let day = '2026-11-05'; const now = () => day;
  const a = SEO.computeState({ dir, seed, pub, now }); assert.equal(a.lastmod['/privacy'], '2026-10-01'); assert.equal(a.changed.length, SEO.ROUTES.length);
  fs.appendFileSync(path.join(pub, 'privacy.html'), '\n<!-- edit -->');
  const b = SEO.computeState({ dir, seed, pub, now }); assert.equal(b.lastmod['/privacy'], '2026-11-05'); assert.equal(b.lastmod['/terms'], '2026-10-01'); assert.deepEqual(b.changed, ['/privacy']);
  day = '2026-11-09'; const c = SEO.computeState({ dir, seed, pub, now }); assert.equal(c.lastmod['/privacy'], '2026-11-05'); assert.deepEqual(c.changed, []);
  fs.appendFileSync(path.join(pub, 'i18n', 'fr.json'), ' '); const d = SEO.computeState({ dir, seed, pub, now });
  assert.deepEqual(d.changed, ['/fr/']); assert.equal(d.lastmod['/fr/'], '2026-11-09');
  assert.ok(fs.existsSync(path.join(dir, 'sitemap-state.json')));
});
