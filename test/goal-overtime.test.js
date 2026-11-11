'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unclosed ' + name);
}

const goalOvertime = new Function(`${sliceFn(js, 'goalOvertime')}\nreturn goalOvertime;`)();
const ringLine = js.split('\n').find(l => l.startsWith('const ring = '));
const ring = new Function(`${ringLine}\nreturn ring;`)();
const H = 3600;

test('exactly on the daily goal is not overtime and the accent ring stays full', () => {
  const g = goalOvertime(2 * H, 2 * H);
  assert.equal(g.over, false);
  assert.equal(g.extra, 0);
  assert.deepEqual(g.arcs, []);
  const html = ring(88, 1);
  assert.match(html, /class="ring-fg /);
  assert.match(html, /stroke-dashoffset:0/);
  assert.doesNotMatch(html, /ring-gold/);
});

test('2h30 of a 2h goal is one gold lap at 25%', () => {
  const g = goalOvertime(2.5 * H, 2 * H);
  assert.equal(g.over, true);
  assert.ok(Math.abs(g.extra - 0.25) < 1e-12);
  assert.equal(g.arcs.length, 1);
  assert.equal(g.arcs[0].tier, 0);
  assert.ok(Math.abs(g.arcs[0].pct - 0.25) < 1e-12);
  // accent helper still clamps, so the green ring does not draw past a full turn
  assert.match(ring(88, 1.25), /stroke-dashoffset:0/);
});

test('a minute past the goal starts a short first lap from 12 o\'clock', () => {
  const g = goalOvertime(2 * H + 60, 2 * H);
  assert.equal(g.arcs.length, 1);
  assert.equal(g.arcs[0].tier, 0);
  assert.ok(Math.abs(g.arcs[0].pct - 60 / (2 * H)) < 1e-12);
});

test('200% completes the first gold lap and 225% starts a brighter second lap', () => {
  const full = goalOvertime(4 * H, 2 * H);
  assert.deepEqual(full.arcs.map(a => a.tier), [0]);
  assert.equal(full.arcs[0].pct, 1);
  const next = goalOvertime(4.5 * H, 2 * H);
  assert.deepEqual(next.arcs.map(a => [a.tier, a.pct]), [[0, 1], [1, 0.25]]);
});

test('past 300% the brighter lap stays full and a hot edge shows the fraction', () => {
  const exact = goalOvertime(6 * H, 2 * H);
  assert.deepEqual(exact.arcs.map(a => [a.tier, a.pct]), [[0, 1], [1, 1]]);
  const more = goalOvertime(6.5 * H, 2 * H);
  assert.equal(more.arcs.length, 3);
  assert.deepEqual(more.arcs.slice(0, 2).map(a => [a.tier, a.pct]), [[0, 1], [1, 1]]);
  assert.equal(more.arcs[2].tier, 2);
  assert.ok(Math.abs(more.arcs[2].pct - 0.25) < 1e-12);
  const far = goalOvertime(10.2 * H, 2 * H); // 510% of the goal, fifth overtime lap
  assert.equal(far.arcs[2].tier, 2);
  assert.ok(far.arcs[2].pct > 0 && far.arcs[2].pct < 1);
  assert.ok(far.arcs.filter(a => a.tier === 2).length === 1);
});

test('under the goal, a missing goal, and bad numbers draw no gold', () => {
  assert.equal(goalOvertime(H, 2 * H).over, false);
  assert.equal(goalOvertime(5 * H, 0).over, false);
  assert.equal(goalOvertime(0, 0).over, false);
  assert.equal(goalOvertime(NaN, 2 * H).over, false);
  assert.equal(goalOvertime(-10, 2 * H).over, false);
});

test('the timer tints the today line and paints gold only on the daily-goal ring', () => {
  const tick = js.slice(js.indexOf('function tick()'), js.indexOf('// Now-studying card'));
  assert.match(tick, /let shown = l, pct = ST\.goalSec \? today \/ ST\.goalSec : 0, phase = '', goalRing = true/);
  assert.match(tick, /a\?\.targetSec\) \{[\s\S]*?goalRing = false/);
  assert.match(tick, /phase === 'break'\) \{[\s\S]*?goalRing = false/);
  assert.match(tick, /const ot = goalRing \? goalOvertime\(today, ST\.goalSec\)/);
  assert.match(tick, /paintGoalGold\(ot, grow\)/);
  assert.match(tick, /goalEl\.textContent = ST\.goalSec \? `\$\{fmtH\(today\)\} of \$\{fmtH\(ST\.goalSec\)\} today` : `\$\{fmtH\(today\)\} today`/);
  assert.match(tick, /goalEl\.classList\.toggle\('goal-over', over\)/);
  assert.match(tick, /over goal/);
  assert.match(tick, /animLevel\(\) >= 2/);
  assert.match(tick, /goal-shimmer/);
  assert.match(tick, /animLevel\(\) >= 1/);
  assert.match(tick, /\$\('tRingSvg'\)\.innerHTML = ring\(88, pct\)/);
  assert.ok(tick.indexOf('fitRingText()') > tick.indexOf('tSubLbl'));
  const title = js.slice(js.indexOf('function tabTitleFor'), js.indexOf('function syncTabTitle'));
  assert.doesNotMatch(title, /gold|overtime|goal-over|goalOvertime/);
  assert.match(js, /id="tGoldSvg"/);
  assert.match(js, /class="ring t-comet-svg"/); // hairline svg stays beside the gold
});

test('gold is inset and thinner than the accent, uses trophy gold, and follows motion settings', () => {
  assert.match(css, /--gold:#e6b422;--gold-2:#f5c518/); // medal and star gold
  assert.match(css, /\[data-theme=light\]\{[^}]*--gold:#b8860b;--gold-2:#c49212;--gold-3:#e6b422;--gold-ink:#8a6208/);
  assert.match(css, /\[data-theme=dark\]\{[^}]*--gold-ink:#f6d56a/);
  assert.match(css, /\.tring \.ring-gold\.g1\{[^}]*stroke-width:6\.5/);
  assert.match(css, /\.tring \.ring-gold\.g2\{[^}]*stroke-width:4\.25/);
  assert.match(js, /const GOLD_R = 77/);
  assert.match(js, /r="\$\{GOLD_R\}"/);
  assert.match(css, /\.tring #tGoalLbl\.goal-over\{color:var\(--gold-ink\)/);
  assert.match(css, /@keyframes goal-shimmer/);
  assert.match(css, /\[data-anim="0"\] \.tring \.t-gold-svg circle\{transition:none\}/);
  assert.match(css, /\[data-anim="0"\] \.tring\.goal-shimmer::after,\[data-anim="1"\] \.tring\.goal-shimmer::after\{animation:none;display:none\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.tring \.t-gold-svg circle\{transition:none\}\.tring\.goal-shimmer::after\{animation:none;display:none\}/);
  assert.match(css, /\.tring \.t-comet-svg circle\{r:88px/); // comet hairline unchanged
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /studyhertz-shell-v174/);
});
