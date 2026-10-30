'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server'); const I = require('../lib/i18n');
const KEYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', 'keys.json'), 'utf8'));
async function start() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-i18n-')); const s = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise(r => s.close(r)) }; }
const LOC = { es: '/es/', 'zh-CN': '/zh-cn/', ko: '/ko/', hi: '/hi/', vi: '/vi/', fr: '/fr/' };
const ph = s => (s.match(/\{\d\}/g) || []).sort();

test('every locale catalog has exactly every key, non-empty, with no stray placeholders and no mojibake', () => {
  assert.equal(new Set(KEYS).size, KEYS.length);
  for (const l of Object.keys(LOC)) { const d = I.DICTS[l];
    assert.deepEqual(Object.keys(d).sort(), [...KEYS].sort(), l + ' key set');
    for (const [k, v] of Object.entries(d)) { assert.ok(v.trim(), `${l} empty: ${k}`);
      for (const p of ph(v)) assert.ok(ph(k).includes(p), `${l} unknown placeholder in ${k}`);
      assert.ok(!/\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2\u20ac|\uFFFD/.test(v), `${l} mojibake: ${v}`); } }
});

test('pattern matching translates dynamic strings and picks locales from Accept-Language', () => {
  assert.equal(I.T.es('Timer'), 'Temporizador');
  assert.match(I.T.fr('12 sessions · 4h 05m') || '', /12 .*4h 05m/);
  assert.equal(I.pick(I.parseAL('zh-CN,zh;q=0.9,en;q=0.8')), 'zh-CN');
  assert.equal(I.pick(I.parseAL('fr-CA;q=0.9,de')), 'fr'); assert.equal(I.pick(['de-DE']), null); assert.equal(I.pick(['ko-KR']), 'ko');
});

test('localized landing routes: lang, translated h1/title/meta, self canonical, hreflang + x-default, no-JS content', async t => {
  const app = await start(); t.after(app.close);
  const home = await (await fetch(app.base + '/')).text();
  for (const [l, p] of Object.entries(LOC)) assert.ok(home.includes(`<link rel="alternate" hreflang="${l}" href="https://studyhertz.com${p}">`), 'home hreflang ' + l);
  assert.ok(home.includes('hreflang="x-default" href="https://studyhertz.com/"')); assert.ok(home.includes('hreflang="en" href="https://studyhertz.com/"'));
  const enH1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(home)[1];
  for (const [l, p] of Object.entries(LOC)) {
    const r = await fetch(app.base + p); assert.equal(r.status, 200, p); const h = await r.text();
    assert.match(h, new RegExp(`<html lang="${l}"`)); assert.ok(h.includes(`<link rel="canonical" href="https://studyhertz.com${p}">`), p + ' canonical');
    assert.ok(h.includes(`<meta property="og:url" content="https://studyhertz.com${p}">`));
    assert.ok(h.includes('hreflang="x-default" href="https://studyhertz.com/"')); assert.equal((h.match(/rel="alternate" hreflang=/g) || []).length, 8);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(h)[1]; assert.notEqual(h1, enH1, p + ' h1 translated'); assert.ok(h1.replace(/<[^>]+>/g, '').trim().length > 5);
    const title = /<title>([^<]*)<\/title>/.exec(h)[1], desc = /<meta name="description" content="([^"]*)"/.exec(h)[1];
    assert.notEqual(title, /<title>([^<]*)<\/title>/.exec(home)[1], p + ' title'); assert.ok(title.length > 10 && desc.length > 50);
    assert.notEqual(desc, /<meta name="description" content="([^"]*)"/.exec(home)[1], p + ' desc');
    assert.notEqual(/<meta property="og:title" content="([^"]*)"/.exec(h)[1], /<meta property="og:title" content="([^"]*)"/.exec(home)[1]);
    const faq = JSON.parse(/<script type="application\/ld\+json">(\{[^<]*FAQPage[^<]*)<\/script>/.exec(h)[1]); assert.equal(faq.inLanguage, l);
    assert.ok(faq.mainEntity.every(q => q.name && q.acceptedAnswer.text)); assert.notEqual(faq.mainEntity[0].name, 'What is StudyHertz?');
    assert.doesNotMatch(h, /name="robots" content="noindex/); assert.ok(h.includes('<script src="/i18n.js"></script>'));
    assert.ok(h.includes('$4.99') || h.includes('4,99') || h.includes('4.99'), p + ' USD price');
    const j = await fetch(app.base + '/i18n/' + l.toLowerCase() + '.json'); assert.equal(j.status, 200); assert.match(j.headers.get('content-type'), /json/);
  }
  const red = await fetch(app.base + '/fr', { redirect: 'manual' }); assert.equal(red.status, 301); assert.equal(red.headers.get('location'), '/fr/');
  const zh = await fetch(app.base + '/zh', { redirect: 'manual' }); assert.equal(zh.headers.get('location'), '/zh-cn/');
  const sm = await (await fetch(app.base + '/sitemap.xml')).text(); for (const p of Object.values(LOC)) assert.ok(sm.includes(`<loc>https://studyhertz.com${p}</loc>`), 'sitemap ' + p);
  for (const f of ['/terms', '/privacy']) { const h = await (await fetch(app.base + f)).text(); assert.match(h, /English version of this document governs/); assert.match(h, /<html lang="en"/); }
});

test('settings accepts a supported language only', async t => {
  const app = await start(); t.after(app.close);
  const r = await fetch(app.base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'pass-12345', agree: true, birthYear: 1990 }) });
  const ck = (r.headers.get('set-cookie') || '').split(';')[0]; const H = { 'Content-Type': 'application/json', Cookie: ck };
  assert.equal((await fetch(app.base + '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ lang: 'ko' }) })).status, 200);
  assert.equal((await (await fetch(app.base + '/api/state', { headers: H })).json()).settings.lang, 'ko');
  assert.equal((await fetch(app.base + '/api/settings', { method: 'POST', headers: H, body: JSON.stringify({ lang: 'xx' }) })).status, 400);
});
