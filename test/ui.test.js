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
  assert.match(h, /&copy; 2026 Alaric Hartsock\. All rights reserved\./);
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
test('service worker cache bumped', () => assert.match(pub('sw.js'), /mcat-shell-v\d+/));
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
