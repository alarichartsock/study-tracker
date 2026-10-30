'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('landing page has hero, auth buttons, features and footer', () => {
  const h = pub('index.html');
  assert.match(h, /id="landing"/);
  assert.match(h, /data-auth="login"/);
  assert.match(h, /data-auth="register"/);
  assert.ok((h.match(/class="feat card"/g) || []).length >= 7);
  assert.match(h, /<p class="lf-copy">&copy; 2026 Alaric Hartsock<\/p>/); assert.match(h, /Open source under <a [^>]*rel="license">GPL-3\.0<\/a>/); for (const l of ['href="/terms"', 'href="/privacy"', 'data-cookie-settings', 'github.com/alarichartsock/study-tracker', 'mailto:support@studyhertz.com']) assert.ok(h.includes(l), l); assert.ok(!/All rights reserved/.test(h));
});
test('glass styles include accessibility fallbacks', () => {
  const c = pub('style.css');
  assert.match(c, /prefers-reduced-transparency/);
  assert.match(c, /prefers-reduced-motion/);
  assert.match(c, /backdrop-filter/);
});
test('served files have no mojibake', () => {
  for (const f of ['index.html', 'app.js', 'style.css', 'sw.js']) assert.doesNotMatch(pub(f), /\u00c2|\u00e2\u20ac/, f);
});
test('service worker cache bumped', () => assert.match(pub('sw.js'), /studyhertz-shell-v\d+/));
test('add-session shortcut is in the toolbar with a timer fallback', () => {
  assert.match(pub('index.html'), /id="addBtn"[^>]*aria-label="Add session"/);
  const js = pub('app.js');
  assert.match(js, /Start timer instead/);
  assert.match(js, /function openAdd\(/);
  assert.match(js, /name="durm"/);
});
test('goal rings use HTML labels instead of scaled SVG text', () => {
  const js = pub('app.js');
  assert.match(js, /class="goal-ring"/);
  assert.match(js, /class="g-pct"/);
  assert.match(pub('style.css'), /\.goal-ring\{[^}]*width:160px/);
});

test('charts carry data-tip tooltips and a shared accessible tooltip component', () => {
  const js = pub('app.js'), css = pub('style.css');
  assert.ok((js.match(/\$\{tip\(/g) || []).length >= 10, 'chart markup uses tip()');
  assert.match(js, /data-tip="/); assert.match(js, /aria-describedby/); assert.match(js, /role', 'tooltip'/);
  for (const re of [/class="hcol"\$\{tip\(/, /class="sbar"\$\{tip\(/, /rx="2"\$\{tip\(/, /class="goal-ring"\$\{tip\(/, /fill="\$\{color\(k\)\}"\$\{tip\(/, /cumHits\(cum[,)]/, /class="w7-row[^\n]*\$\{tip\(/]) assert.match(js, re);
  assert.ok(!/<title>/.test(js), 'native SVG titles replaced'); assert.ok(!/class="hcol" title=/.test(js));
  assert.match(css, /\.chart-tip\{/); assert.match(css, /\.tip-hot/);
});

test('data room table: header cell count matches data row cell count', () => {
  const vm = require('vm'), js = pub('app.js'), start = js.indexOf('function dataRoom('), end = js.indexOf('\nfunction donut(');
  const ctx = { esc: s => String(s), fmtH: v => v + 's' }; vm.createContext(ctx); vm.runInContext(js.slice(start, end) + '\nthis.dataRoom = dataRoom;', ctx);
  const html = ctx.dataRoom(['Lecture', 'Anki'], ['CARS', 'Bio'], { Lecture: { CARS: 60 }, Anki: { Bio: 30 } }, v => '<td class="num">' + (v || '-') + '</td>');
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g), cells = r => (r.match(/<t[hd][ >]/g) || []).length;
  assert.equal(rows.length, 4); const head = cells(rows[0]); assert.equal(head, 4); for (const r of rows) assert.equal(cells(r), head, r);
  assert.match(rows[0], /<th scope="col" class="dr-h">Activity<\/th>/); assert.equal((html.match(/<col[ >]/g) || []).length, head);
});

test('Google consent mode (advanced): tag on every page, denied by default before config', () => {
  const c = pub('consent.js'), h = pub('index.html'), p = pub('privacy.html'), js = pub('app.js');
  assert.match(c, /AW-18541546430/);
  const def = c.indexOf("gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500 })"), conf = c.indexOf("gtag('config', ADS_ID)"), ga = c.indexOf("gtag('config', c.gaId, { send_page_view: false })");
  assert.match(c, /indexOf\('@'\) < 0/, 'PII guard drops values containing @'); assert.match(js, /window\.SH_LANDING = /, 'landing URL captured before replaceState');
  assert.ok(js.indexOf('window.SH_LANDING') < js.indexOf('history.replaceState'), 'landing captured first');
  assert.ok(def > 0 && conf > def && ga > def, 'default consent is set before any config');
  assert.equal((c.match(/googletagmanager\.com\/gtag\/js/g) || []).length, 1, 'single shared loader');
  assert.match(c, /if \(get\(\) === 'granted'\) gtag\('consent', 'update', granted\(\)\)/, 'stored choice re-applied');
  assert.match(c, /gtag\('consent', 'update', v === 'granted' \? granted\(\) : DENIED\)/);
  assert.match(c, /navigator\.globalPrivacyControl === true/);
  assert.match(c, /if \(c && c.signupLabel\)/, 'conversion skipped when label is empty');
  for (const f of ['index.html', 'privacy.html', 'terms.html', 'terms-v1.0.html']) assert.match(pub(f), /<script src="\/consent.js"><\/script>/, f);
  assert.match(h, /data-cookie-settings/); assert.match(p, /data-cookie-settings/); assert.match(p, /cookieless measurement pings/);
  assert.match(js, /SHConsent\?\.signup\(\)/);
});

test('landing v2: tour tabs, how it works, MCAT sections, FAQ, repeated tracked CTAs, all server-rendered', () => {
  const h = pub('index.html');
  for (const id of ['tour', 'how', 'mcat', 'pricing', 'faq']) assert.match(h, new RegExp('<section[^>]* id="' + id + '"'), id);
  assert.equal((h.match(/role="tab"/g) || []).length, 6); assert.equal((h.match(/role="tabpanel"/g) || []).length, 6);
  assert.ok((h.match(/data-auth="register" data-cta=/g) || []).length >= 7, 'CTAs repeated');
  assert.ok((h.match(/Start free 30-day trial/g) || []).length >= 7);
  assert.equal((h.match(/<details class="card"><summary>/g) || []).length, 7); assert.match(h, /"@type": "FAQPage"/);
  for (const s of ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc']) assert.match(h, new RegExp(s));
  assert.doesNotMatch(h, /testimonial|\d[\d,]*\+ (students|users)/i, 'no invented social proof');
  assert.match(pub('app.js'), /track\('cta_click', \{ cta_id: b\.dataset\.ctaId \|\| b\.dataset\.cta, location: b\.dataset\.cta \}\)/);
});

test('MCAT landing hero: trial CTA above the fold and inert HTML previews with sample data', () => {
  const h = pub('index.html'), srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(h, /<h1>Track every MCAT study hour<\/h1>/); assert.match(h, /id="heroCta" data-cta="hero" data-cta-id="hero_trial">Start free 30-day trial</);
  assert.equal((h.match(/class="pv" role="img" aria-label="Preview/g) || []).length, 6); assert.match(h, /not real user data/);
  assert.ok(!/shot-[a-z]+\.webp/.test(h + srv), 'no webp screenshots left'); assert.match(h, /id="aAgree"/); assert.ok(!/free to use/.test(h));
});
