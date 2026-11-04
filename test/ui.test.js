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
  assert.match(h, /<h1 id=\"heroH1\" class=\"h1-en\"><span class=\"g\">Track every <\/span><span class=\"rot\" aria-live=\"off\"><span class=\"rot-w on\">MCAT<\/span><\/span><span class=\"vh\"> \(or LSAT, GRE, GMAT, SAT, ACT, USMLE, DAT\)<\/span><br><span class=\"g\">study hour<\/span><\/h1>/); assert.match(h, /id="heroCta" data-cta="hero" data-cta-id="hero_trial">Start free 30-day trial</);
  assert.equal((h.match(/class="pv" role="img" aria-label="Preview/g) || []).length, 6); assert.match(h, /not real user data/);
  assert.ok(!/shot-[a-z]+\.webp/.test(h + srv), 'no webp screenshots left'); assert.match(h, /id="aAgree"/); assert.ok(!/free to use/.test(h));
});

test('admin Users rows filter Logs to that user with a removable chip; Details button keeps the detail view', () => {
  const js = require('fs').readFileSync(__dirname + '/../public/app.js', 'utf8');
  assert.match(js, /data-act="usrLogs" data-id="/); assert.match(js, /data-act="usrOpen" data-id="[^>]*>Details<\/button>/);
  assert.match(js, /ACT\.usrLogs = b => \{[^]*?UI\.logF\.uid = id/); assert.match(js, /User: ' \+ esc\(/); assert.match(js, /ACT\.logUserClear = /);
  assert.match(js, /\$\('logsTop'\)\?\.scrollIntoView/);
});
test('dashboard goal rings animate quietly and respect reduced motion', () => {
  const js = pub('app.js'), css = pub('style.css');
  assert.match(js, /const GA = /); assert.match(js, /AFTER\.dash = \(\) => \{ GA\.play\(\);/); assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.goal-ring \.ring-fg\{transition:stroke-dashoffset/); assert.match(css, /html\.tab-hidden \.g-comet\{animation-play-state:paused\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^\n]*\.g-comet\{animation:none/);
});
test('Launch Pad trophy animations are one-shot, launch-only and reduced-motion safe', () => {
  const js = pub('app.js'), css = pub('style.css');
  assert.match(js, /TrophyArt\.has\(x\) \? ' t-lp'/); assert.match(js, /const TLP = /); assert.match(js, /TLP\.scan\(\$\('achGrid'\)\)/);
  assert.match(css, /@keyframes t-trace/); assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.t-line,\.t-sheen/);
  assert.ok(!/\.t-lp[^{]*\{[^}]*animation:[^}]*infinite/.test(css), 'no idle loops');
});

test('Launch Pad trophy art: one isometric hairline svg per trophy, served and cached', () => {
  const fs = require('node:fs'), path = require('node:path'), P = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  global.window = {}; require('../public/trophy-art.js'); const T = global.window.TrophyArt;
  const AN = require('../lib/analytics.js'), A = AN.achievements({ sessions: [], settings: { goals: { dailyMin: 60 } }, subjectMeta: {} }, 0), DONE = ['launch', 'time', 'streaks', 'intensity', 'focus', 'goals', 'medals', 'explore', 'personal'];
  for (const x of A.global.filter(x => DONE.includes(x.cat))) assert.ok(T.has(x), x.id + ' has line art');
  for (const k of ['h1', 'h10', 'h50', 'h100', 'h250', 'n10', 'n50', 'n100']) assert.equal(T.key('subject:bio:' + k), DONE.includes('personal') ? 'p-' + k : T.key('subject:bio:' + k));
  for (const id of T.ids) assert.match(T.svg(id), /^<svg class="ta" viewBox="6 5 52 52"/);
  assert.match(P('index.html'), /trophy-art\.js/); assert.match(P('sw.js'), /'\/trophy-art\.js'/); assert.match(P('app.js'), /TrophyArt\.has\(x\)/); assert.match(P('app.js'), /TrophyArt\.svg\(TrophyArt\.key\(x\)\)/);
});

test('circling timer lines share one clock derived from the session start (no per-ring offsets)', () => {
  const js = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /function cometSync\(force\)/); assert.match(js, /\(Date\.now\(\) - new Date\(a\.start\)\) \/ 1000\) % COMET_S/);
  assert.doesNotMatch(js, /g-comet" style="animation-delay/); assert.match(js, /if \(!document\.hidden\) cometSync\(true\)/); assert.match(js, /AFTER\.dash = \(\) => \{ GA\.play\(\); cometSync\(\);/);
});

test('trophy drawings are interactive: lean, one action per trophy, keyboard, popup turn, reduced-motion end states', () => {
  const fs = require('node:fs'), path = require('node:path'), js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  delete require.cache[require.resolve('../public/trophy-art.js')]; global.window = {}; require('../public/trophy-art.js'); const T = global.window.TrophyArt;
  for (const id of T.ids) { assert.ok(T.DUR[id] > 0); if (id !== 'tinker') assert.notEqual(T.inner(id, 0.4), T.inner(id, 1), id + ' action changes the drawing'); assert.equal(T.inner(id, 1), T.inner(id), id + ' rests at p=1'); }
  assert.notEqual(T.inner('first', 1, { yaw: 12 }), T.inner('first', 1)); assert.notEqual(T.inner('tinker', 1, { turn: 45 }), T.inner('tinker', 1));
  assert.match(js, /const TAI = /); assert.match(js, /ACT\.taPlay = b => TAI\.play\(b\)/); assert.match(js, /const dragOk = el => el\.dataset\.tid === 'tinker'/); assert.match(js, /d\.onclick = e => \{ if \(e\.target !== d\) return;/); assert.doesNotMatch(js, /data-act="taPlay"/);
  assert.match(js, /if \(still\(\)\) return draw\(el, 1\)/);
});

test('animation fidelity follows the quality setting through one helper; reduced motion forces level 0', () => {
  const fs = require('node:fs'), path = require('node:path'), js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const src = js.slice(js.indexOf('function animLevel()'), js.indexOf('function applyAnimLevel()'));
  const lvl = (rm, q, auto) => { const ls = { t3dQuality: q, t3dAuto: auto }; return new Function('matchMedia', 'localStorage', src + 'return animLevel();')(() => ({ matches: rm }), ls); };
  assert.equal(lvl(true, 'high'), 0); assert.equal(lvl(false, 'low'), 1); assert.equal(lvl(false, 'medium'), 2); assert.equal(lvl(false, 'high'), 3);
  assert.equal(lvl(false, 'auto', '{"tier":"high"}'), 3); assert.equal(lvl(false, undefined), 2);
  assert.match(js, /if \(v === 'auto'\) tierAuto\(\); applyAnimLevel\(\);/); assert.match(js, /TrophyTier\.pick\(TrophyTier\.probe\(gl\)\)/); assert.doesNotMatch(js, /trophy3d|vendor\/three/); assert.match(js, /animLevel\(\) < 2\) return; const ph/);
  assert.match(css, /\[data-anim="1"\] \.g-comet/); assert.match(css, /\[data-anim="3"\] \.g-tail/);
});

test('trophy drawings track the cursor while hovered (one part each, faint when locked) and ease back', () => {
  const js = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
  delete require.cache[require.resolve('../public/trophy-art.js')]; global.window = {}; require('../public/trophy-art.js'); const T = global.window.TrophyArt;
  for (const id of T.ids) { assert.notEqual(T.inner(id, 1, { aim: { x: 50, y: 15, s: 1 } }), T.inner(id), id); assert.equal(T.inner(id, 1, { aim: { x: 50, y: 15, s: 0 } }), T.inner(id)); }
  assert.match(js, /const hovTick = /); assert.match(js, /h\.ts = el\.closest\('\.trophy\.on, \.t-art\.on'\) \? 1 : \.35/); assert.match(js, /if \(animLevel\(\) < 2\) return; const svg/);
});

test('in-app logo mark is an accent-derived hairline wave, synced to the session clock and tied to quality', () => {
  const fs = require('node:fs'), path = require('node:path'), P = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), js = P('app.js'), html = P('index.html'), css = P('style.css');
  assert.match(html, /<header class="top">\s*<div class="brand"><svg class="sh-mark"/); assert.match(html, /stop-color:var\(--logo-a,var\(--acc\)\)/); assert.match(css, /--acc-b:color-mix\(in srgb,var\(--acc\)/); assert.match(js, /function logoInk\(\)/); assert.match(css, /\.sh-tile\{fill:url\(#shMarkG\)/); assert.match(css, /\.sh-wave\{fill:none;stroke:var\(--logo-ink\)/);
  assert.match(js, /const LOGO = /); assert.match(js, /% COMET_S\) \/ COMET_S \* 2 \* Math\.PI/); assert.match(js, /animLevel\(\) >= 2/); assert.match(css, /html:not\(\[data-anim="0"\]\) \.sh-wave/);
  assert.match(html, /class="l-top glass"><div class="brand"><svg class="sh-mark"[^>]*>.*id="shMarkL"/); assert.match(js, /mkLogo\(document\.querySelector\('#landing \.sh-mark'\)\)/); // landing: same hairline mark
  assert.match(html, /rel="icon"[^>]*favicon/); // favicon unchanged
  assert.match(html, /id="accTop"[\s\S]*id="langTop"/); assert.match(js, /const ACCENTS = /); assert.match(js, /async function carryAccent\(\) \{ const a = localAccent\(\); if \(!a \|\| !S \|\| S\.settings\.accent/);
});

test('logo ink follows the theme (white wave in light, near-black in dark); the tile shifts for contrast; trophy focus ring is keyboard-only; card hover uses transform/shadow only', () => {
  const fs = require('node:fs'), path = require('node:path'), js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const src = js.slice(js.indexOf('function logoInk()'), js.indexOf('new MutationObserver(() => logoInk())'));
  const run = (acc, theme) => { const st = {}; const r = { dataset: { theme }, style: { getPropertyValue: k => st[k] || '', setProperty: (k, v) => { st[k] = v; } } }; new Function('document', 'getComputedStyle', src + 'logoInk();')({ documentElement: r }, () => ({ getPropertyValue: () => acc })); return st; };
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }, cr = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  for (const acc of ['#4c6ef5', '#7048e8', '#ffe066', '#f8f0e3', '#1b1f3a', '#2fd3b4', '#000000', '#ffffff']) for (const th of ['light', 'dark']) { const st = run(acc, th), ink = th === 'dark' ? '#0b0d18' : '#fff';
    assert.equal(st['--logo-ink'], ink, acc + ' ' + th); const L = th === 'dark' ? lum('#0b0d18') : 1; assert.ok(Math.min(cr(L, lum(st['--logo-a'])), cr(L, lum(st['--acc-b']))) >= 3 || acc === '#ffffff' || acc === '#000000', acc + ' ' + th + ' contrast'); }
  assert.equal(run('#7048e8', 'light')['--logo-a'], '#7048e8'); // already fine: tile untouched
  assert.match(css, /\.t-art:focus:not\(:focus-visible\)/); assert.match(css, /-webkit-tap-highlight-color:transparent/); assert.match(css, /@media \(hover:hover\)\{\n  \.trophy\.t-lp:hover/);
});

test('subject colours are clamped for readability: >= 3:1 on both card themes, nearest shade, server + display', () => {
  const C = require('../public/color-clamp.js'), fs = require('node:fs'), path = require('node:path');
  for (const h of ['#ffffff', '#000000', '#ffe066', '#f8f0e3', '#1b1f3a', '#00ff00', '#0000ff', '#ffff00', '#123456']) { const r = C.clamp(h);
    assert.ok(C.contrast(r.color, '#ffffff') >= 2.99 && C.contrast(r.color, '#161920') >= 2.99, h + ' -> ' + r.color); assert.equal(r.adjusted, true, h); assert.ok(C.valid(r.color)); }
  for (const h of ['#4c6ef5', '#868e96', '#e8590c']) assert.equal(C.clamp(h).adjusted, false, h);
  const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(sv, /meta\.color = SubjectColor\.color\(j\.color\)/); assert.match(js, /SubjectColor\.color\(c\)/); assert.match(js, /Adjusted for readability/);
});

test('now-studying card: off-timer only, reuses timer actions (stop flow, shared discard confirm), cross-tab, minimizable, accessible', () => {
  const fs = require('node:fs'), path = require('node:path'), js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(js, /const NOW = /); assert.match(js, /show = !!\(ME && a && view !== 'timer'\)/); assert.match(js, /Promise\.resolve\(ACT\[k\]\(\)\)/);
  assert.match(js, /ACT\.discard = async \(\) => \{ if \(!S\.active \|\| !confirm\('Discard this session\? It will not be saved\.'\)\)/); assert.match(js, /if \(v === 'discard'\) return ACT\.discard\(\);/);
  assert.equal((js.match(/\/api\/timer\/discard/g) || []).length, 1); assert.match(js, /e\.key === 'shTimerPing'/); assert.match(js, /localStorage\.nowMin/);
  assert.match(js, /role', 'region'\); el\.setAttribute\('aria-label', 'Session in progress'\)/); assert.match(css, /@media\(max-width:699px\)\{\.now-card\{right:12px;bottom:calc\(88px/);
});
test('ui: trophy hover uses a static hit box + debounced sheen; session card size setting', () => {
  const fs = require('fs'), path = require('path'), js = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  assert.match(js, /<div class="t-face">/); assert.match(js, /now - \(el\._shT \|\| 0\) < 600/); assert.match(css, /\.trophy\.t-lp:hover>\.t-face/);
  assert.match(js, /const lean = \(\) => \{\};/); assert.doesNotMatch(js, /dataset\.yaw = Math/); assert.doesNotMatch(css, /\.trophy[^{]*\{[^}]*rotate[XY]/); assert.doesNotMatch(css, /\.t-art \.ta\{transform:perspective/);
  assert.match(js, /ACT\.nowSize = /); assert.match(css, /html\[data-now="l"\]\{--nz:1\.3\}/);
});
test('Thirty Down: hover lifts the top page within the stack (never the flipped-over page), tap turns it up and it lands flat', () => {
  const fs = require('fs'), path = require('path'), w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '../public/trophy-art.js'), 'utf8'))(w); const T = w.TrophyArt;
  const nums = s => (s.match(/-?\d+(\.\d+)?/g) || []).map(Number), inBox = s => { const d = [...s.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join(' '); const n = nums(d.replace(/[A-Za-z]/g, ' ')); return n.every(v => v > 4 && v < 60); };
  for (const y of [10, 20, 30, 45]) assert.ok(inBox(T.inner('month1', 1, { aim: { x: 32, y, s: 1 } })), 'hover y=' + y);
  for (const p of [.25, .5, .75]) assert.ok(inBox(T.inner('month1', p)), 'tap p=' + p);
  assert.equal(T.inner('month1', 1), T.inner('month1', 1, { aim: { x: 32, y: 20, s: 0 } })); assert.doesNotMatch(T.inner('month1', 1), /class="hl" d="M[^"]*"\/><path class="l w d"[^>]*\/>.*class="hl"/);
});

test('landing section links scroll in-page and deep links survive boot', () => {
  const a = pub('app.js'), c = pub('style.css');
  assert.match(a, /location\.pathname \+ \(ks \? '\?' \+ ks : ''\) \+ location\.hash/, 'query cleanup must keep the #hash');
  assert.match(a, /closest\('#landing a\[href\^="#"\]'\)/);
  assert.match(a, /prefers-reduced-motion: reduce\)'\)\.matches \? 'smooth' : 'auto'/);
  assert.match(a, /history\.pushState\(null, '', u\)/);
  assert.match(a, /showLanding && location\.hash\.length > 1\) requestAnimationFrame\(\(\) => landNav\(location\.hash, false\)\)/);
  assert.match(c, /\.landing section\[id\]\{scroll-margin-top:/);
});

test('auth/setup screens use the accent logo tile, hairline wave and accent washes', () => {
  const h = pub('index.html'), c = pub('style.css'), a = pub('app.js');
  assert.match(h, /<div class="brand big"><svg class="sh-mark"[^>]*>.*id="shMarkA"/); assert.match(c, /#auth \.sh-tile\{fill:url\(#shMarkA\)\}/);
  assert.match(a, /mkLogo\(document\.querySelector\('#auth \.sh-mark'\)\)/); assert.match(c, /body:has\(#auth:not\(\.hid\)\)::before/); assert.match(h, /rel="icon"[^>]*favicon/);
});

test('accent changes repaint the logo stops directly and drop the signed-out accent state once signed in', () => {
  const a = pub('app.js');
  assert.match(a, /document\.querySelectorAll\('\.sh-mark linearGradient'\)\.forEach\(g => \{ const st = g\.querySelectorAll\('stop'\)/);
  assert.match(a, /function applyAccent\(\) \{ queueMicrotask\(applyWallpaper\); if \(ME\) document\.documentElement\.classList\.remove\('acc-local'\);/);
});

test('trophy colours: site-wide drawings follow the selected subject (else accent), subject groups keep their own colour, fills stay faint', () => {
  const a = pub('app.js'), c = pub('style.css');
  assert.match(a, /const tc = S && sel && S\.subjectMeta\[sel\] \? color\(sel\) : ''/); assert.match(c, /\.trophy\.on \.t-art,\.t-art\.on\{color:var\(--tro,var\(--acc\)\)\}/);
  assert.match(a, /--acc:' \+ esc\(color\(x\.key\)\) \+ ';--tro:' \+ esc\(color\(x\.key\)\)/); assert.match(c, /\.pv-art\{--tro:var\(--acc\)\}/);
  const m = /\.ta \.tp\{fill:color-mix\(in srgb,currentColor (\d+)%[^}]*\}\.ta \.hl\{fill:color-mix\(in srgb,currentColor (\d+)%/.exec(c); assert.ok(m && +m[1] <= 5 && +m[2] <= 10, 'hairline look: faint tints only');
  assert.doesNotMatch(c, /\.ta[^{]*\{[^}]*fill:currentColor/);
});

test('every public script parses (guards against a stray line comment swallowing code)', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), dir = path.join(__dirname, '..', 'public');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }), f);
});

test('tab favicon follows the accent via an SVG data URI; PNG/ICO and home-screen icons stay brand', () => {
  const fs = require('fs'), path = require('path'), app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /<link rel="icon" id="favSvg" href="\/favicon\.svg\?v=3"/); assert.match(html, /favicon-32\.png/); assert.match(html, /favicon\.ico/);
  assert.match(app, /function accentFavicon\(a\)/); assert.match(app, /'data:image\/svg\+xml,'/);
  assert.match(app, /accentFavicon\(a\); }\n\n\/\/ ---------- nav & data/); assert.match(app, /accentFavicon\(a\); accPick\.sync\(\)/);
});

test('trophy cards: every line-art card gets its visible .t-face, and the sheen ends hidden', () => {
  const app = pub('app.js'), css = pub('style.css');
  assert.match(app, /const face = \(x, h\) => \{ if \(!\(window\.TrophyArt && TrophyArt\.has\(x\)\)\) return h;/);
  assert.doesNotMatch(app, /const face = \(x, h\) => \{ if \(x\.cat !== 'launch'\)/);
  assert.match(css, /\.t-lp>\.t-face\{[^}]*background:var\(--card\);border:1px solid var\(--line\)/);
  assert.match(css, /@keyframes t-sheen\{[^}]*\}[^@]*100%\{transform:translateX\(110%\);opacity:0\}/);
});
