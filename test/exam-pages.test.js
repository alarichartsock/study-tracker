'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server.js'); const EX = require('../lib/exams'); const SEO = require('../lib/seo');
const start = async () => { const app = createApp({ dataFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), 'data.json'), quiet: true, minSessionSec: 0 });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); return { app, base: 'http://127.0.0.1:' + app.address().port, close: () => app.close() }; };

test('per-test landing pages: own title, meta, canonical, h1 word, data-exam; English only (no hreflang)', async t => {
  const s = await start(); t.after(s.close);
  for (const slug of EX.ORDER) { const e = EX.EXAMS[slug], r = await fetch(s.base + '/' + slug), h = await r.text();
    assert.equal(r.status, 200, slug);
    assert.match(h, new RegExp(`<html lang="en" data-exam="${e.id}"`));
    assert.match(h, new RegExp(`<title>StudyHertz: ${e.full} Study Tracker`));
    assert.match(h, new RegExp(`<link rel="canonical" href="https://studyhertz.com/${slug}">`));
    assert.match(h, new RegExp(`<meta name="description" content="StudyHertz is an open-source ${e.full} study tracker`));
    assert.match(h, new RegExp(`<span class="rot-w on">${e.word}</span></span><span class="vh"> \\(or `));
    assert.ok(!new RegExp(`\\(or [^)]*\\b${e.word}\\b`).test(h.match(/<span class="vh"> \(or [^)]*\)/)[0]), slug + ': own word not repeated in the list');
    assert.ok(!/hreflang=/.test(h), slug + ': no hreflang on English-only page'); }
  const home = await (await fetch(s.base + '/')).text(); assert.ok(!/data-exam=/.test(home)); assert.match(home, /<span class="rot-w on">MCAT<\/span>/);
});

test('sitemap, robots and IndexNow list every test page', () => {
  const urls = SEO.urls(); for (const s of EX.ORDER) assert.ok(urls.includes('https://studyhertz.com/' + s), s);
  const sm = SEO.sitemap({}); for (const s of EX.ORDER) assert.ok(sm.includes('<loc>https://studyhertz.com/' + s + '</loc>'), s);
  const rb = SEO.robots(); for (const s of EX.ORDER) assert.match(rb, new RegExp('^Allow: /' + s + '$', 'm'));
});

test('landing_exam: saved from first touch at signup (validated / derived from landing), in admin usage with a by-exam count', async t => {
  const s = await start(); t.after(s.close);
  const client = () => { let ck = ''; return async (p, m = 'GET', b) => { const r = await fetch(s.base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, body: await r.json() }; }; };
  const reg = (c, u, ft) => c('/api/register', 'POST', { agree: true, birthYear: 1990, username: u, password: 'pass-12345', email: u + '@example.com', ft });
  const adm = client(); await reg(adm, 'admin0', {}); await adm('/api/admin/config', 'POST', { openRegistration: true });
  await reg(client(), 'lsatuser', { landing: '/lsat', landing_exam: 'lsat' });
  await reg(client(), 'derived', { landing: '/usmle?utm_source=x' });
  await reg(client(), 'query', { landing: '/?exam=gre&utm_source=y' });
  await reg(client(), 'bogus', { landing: '/pricing', landing_exam: '<script>' });
  const U = n => s.app.store.db.users.find(u => u.username === n).attribution || {};
  assert.equal(U('lsatuser').landing_exam, 'lsat'); assert.equal(U('derived').landing_exam, 'usmle1'); assert.equal(U('query').landing_exam, 'gre'); assert.equal(U('bogus').landing_exam, undefined);
  const r = await adm('/api/admin/usage'); assert.equal(r.status, 200);
  assert.equal(r.body.users.find(x => x.username === 'lsatuser').landingExam, 'lsat');
  assert.deepEqual(r.body.summary.byExam, { lsat: 1, usmle1: 1, gre: 1, none: 1 });
});

test('step2 and bar landings use their template ids and do not repeat Step 1 copy', async t => {
  const s = await start(); t.after(s.close);
  const step = await (await fetch(s.base + '/step2')).text(), bar = await (await fetch(s.base + '/bar')).text();
  assert.match(step, /data-exam="usmle2"/); assert.match(step, /USMLE Step 2 CK Study Tracker/); assert.match(step, /Medicine/); assert.match(step, /Surgery/);
  assert.match(bar, /data-exam="bar"/); assert.match(bar, /Bar Exam Study Tracker/); assert.match(bar, /Civil Procedure/); assert.match(bar, />MPT</);
  const colors = [...bar.matchAll(/sec-card" style="--c:(#[0-9a-f]{6})/g)].map(m => m[1]);
  assert.equal(colors.length, 9); assert.equal(new Set(colors).size, 9);
  const usmle = await (await fetch(s.base + '/usmle')).text();
  assert.match(usmle, /data-exam="usmle1"/); assert.match(usmle, /Anatomy|Pathology/); assert.doesNotMatch(usmle.slice(0, usmle.indexOf('<div id="app"')), /USMLE Step 2 CK Study Tracker/);
});

test('step2 landing path attributes the signup to the Step 2 template', async t => {
  const s = await start(); t.after(s.close);
  const client = () => { let ck = ''; return async (p, m = 'GET', b) => { const r = await fetch(s.base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, body: await r.json() }; }; };
  const reg = (c, u, ft) => c('/api/register', 'POST', { agree: true, birthYear: 1990, username: u, password: 'pass-12345', email: u + '@example.com', ft });
  const adm = client(); await reg(adm, 'admin2', {}); await adm('/api/admin/config', 'POST', { openRegistration: true });
  await reg(client(), 'ckuser', { landing: '/step2?utm_source=x' });
  await reg(client(), 'baruser', { landing: '/bar' });
  const U = n => s.app.store.db.users.find(u => u.username === n).attribution || {};
  assert.equal(U('ckuser').landing_exam, 'usmle2'); assert.equal(U('baruser').landing_exam, 'bar');
});

test('per-test landing body copy is test-specific with its own FAQ JSON-LD', () => {
  const fs = require('fs'); const X = require('../lib/exams'); const src = fs.readFileSync(require('path').join(__dirname, '../public/index.html'), 'utf8');
  assert.equal(X.examHead(src, 'mcat', 'https://x').includes('Built around the MCAT'), true);
  for (const s of X.ORDER.filter(s => s !== 'mcat')) {
    const h = X.examHead(src, s, 'https://x'); const land = h.slice(0, h.indexOf('<div id="app"') > 0 ? h.indexOf('<div id="app"') : h.indexOf('</footer>') + 9).replace(/<span class="vh">[^<]*<\/span>/g, '');
    assert.doesNotMatch(land, /MCAT/, s);
    const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).find(o => o['@type'] === 'FAQPage');
    assert.ok(ld.mainEntity.some(q => q.name.includes(X.EXAMS[s].word === 'USMLE' ? 'Step 1' : X.EXAMS[s].word)), s);
  }
});
