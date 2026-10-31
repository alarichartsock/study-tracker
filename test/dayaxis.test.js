'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../public/app.js', 'utf8');
const grab = re => { const m = re.exec(src); assert.ok(m, 'source found: ' + re); return m[0]; };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(grab(/const MON = \[[^\]]+\];/) + '\n' + grab(/const dayAxis = keys => \{[\s\S]*?return h \+ '<\/div>'; \};/) + '\nthis.dayAxis = dayAxis;', ctx);
test('dayAxis: one tick per day, first/last and month changes marked as priority labels', () => {
  const keys = []; for (let d = 15; d <= 31; d++) keys.push('2026-10-' + d); for (let d = 1; d <= 13; d++) keys.push('2026-11-' + String(d).padStart(2, '0'));
  const h = ctx.dayAxis(keys);
  assert.equal((h.match(/<i /g) || []).length, 30); assert.equal((h.match(/<span /g) || []).length, 30);
  assert.match(h, /data-p="3" class="f"[^>]*>Oct 15</); assert.match(h, /data-p="3" class="l"[^>]*>Nov 13</);
  assert.match(h, /class="mj"/); assert.match(h, /data-p="2"[^>]*>Nov 1</); assert.match(h, />10\/20</);
  assert.equal(ctx.dayAxis([]), '');
});
test('every admin chart uses the day axis and fitAxes runs after the Users view renders', () => {
  assert.equal((src.match(/\+ dayAxis\(/g) || []).length, 3);
  assert.match(src, /AFTER\.users = \(\) => fitAxes\(\)/);
  assert.match(fs.readFileSync(__dirname + '/../public/sw.js', 'utf8'), /shell-v93/);
});
