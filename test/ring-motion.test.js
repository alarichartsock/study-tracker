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

const libSrc = js.slice(js.indexOf('const RING_EASE_MS'), js.indexOf('function ringSample('));
const { RING_EASE_MS, RING_SNAP_SEC, RING_STALE_MS, RING_EASE_MIN, ringEase, ringTrack, ringStale, ringEasePlan, ringDash } = new Function(`${libSrc}\nreturn { RING_EASE_MS, RING_SNAP_SEC, RING_STALE_MS, RING_EASE_MIN, ringEase, ringTrack, ringStale, ringEasePlan, ringDash };`)();
const goalOvertime = new Function(`${sliceFn(js, 'goalOvertime')}\nreturn goalOvertime;`)();

const KEY = 'goal|2026-11-15|2026-11-15T18:00:00.000Z|CARS|120';

test('ease curve is smooth at both ends and the correction window is about half a second', () => {
  assert.equal(ringEase(0), 0);
  assert.equal(ringEase(1), 1);
  assert.equal(ringEase(0.5), 0.5);
  assert.ok(ringEase(0.25) < 0.25); // ease-in-out starts slow, so the first frames are not a snap
  assert.equal(ringEase(-1), 0);
  assert.equal(ringEase(2), 1);
  assert.ok(RING_EASE_MS >= 400 && RING_EASE_MS <= 600);
  assert.equal(RING_SNAP_SEC, 120);
  assert.equal(RING_EASE_MIN, 1.5);
  assert.equal(RING_STALE_MS, 2500);
});

test('dash offset tracks the clamped fraction and hides the round cap at zero', () => {
  const C = 2 * Math.PI * 88;
  assert.ok(Math.abs(ringDash(88, 0).offset - C) < 1e-9);
  assert.equal(ringDash(88, 0).show, false);
  assert.ok(Math.abs(ringDash(88, 1).offset) < 1e-9);
  assert.equal(ringDash(88, 1).show, true);
  assert.ok(Math.abs(ringDash(88, 1.5).offset) < 1e-9);
  assert.ok(Math.abs(ringDash(88, 0.25).offset - C * 0.75) < 1e-9);
  assert.equal(ringDash(88, -0.2).show, false);
  assert.ok(Math.abs(ringDash(88, -0.2).offset - C) < 1e-9);
});

test('a fresh paint, a stale paint, reduced motion, and a ring-identity change all snap', () => {
  const next = { key: KEY, total: 60 };
  assert.equal(ringEasePlan(null, next, 2, false).snap, true);
  assert.equal(ringEasePlan({ key: KEY, total: null }, next, 2, false).snap, true);
  assert.equal(ringEasePlan({ key: KEY, total: 40 }, next, 0, false).snap, true); // prefers-reduced-motion / anim level 0
  assert.equal(ringEasePlan({ key: KEY, total: 40 }, next, 0, false).ease, false);
  assert.equal(ringEasePlan({ key: KEY, total: 40 }, next, 2, true).snap, true); // tab was hidden or the view was away
  assert.equal(ringStale(null, 5000), true);
  assert.equal(ringStale(1000, 1000 + RING_STALE_MS), false);
  assert.equal(ringStale(1000, 1000 + RING_STALE_MS + 1), true);
  const base = { key: KEY, total: 100 };
  assert.equal(ringEasePlan(base, { key: 'target|2026-11-15|2026-11-15T18:00:00.000Z|CARS|1500', total: 100 }, 2, false).snap, true);
  assert.equal(ringEasePlan(base, { key: 'break|2026-11-15||CARS|300', total: 100 }, 2, false).snap, true);
  assert.equal(ringEasePlan(base, { key: KEY.replace('2026-11-15|', '2026-11-16|'), total: 0 }, 2, false).snap, true);
  assert.equal(ringEasePlan(base, { key: 'goal|2026-11-15||CARS|120', total: 100 }, 2, false).snap, true); // session stop
  assert.equal(ringEasePlan(base, { key: KEY.replace('CARS', 'Bio'), total: 100 }, 2, false).snap, true);
  assert.equal(ringEasePlan(base, { key: KEY.replace('|120', '|3600'), total: 100 }, 2, false).snap, true);
  assert.equal(ringEasePlan(base, { key: KEY, total: 100 + RING_SNAP_SEC + 1 }, 2, false).snap, true);
});

test('level 1 and up eases a modest correction and ignores sub-second noise', () => {
  const prev = { key: KEY, total: 40 };
  const up = ringEasePlan(prev, { key: KEY, total: 60 }, 1, false);
  assert.equal(up.ease, true);
  assert.equal(up.snap, false);
  assert.ok(Math.abs(up.error - 20) < 1e-9);
  const down = ringEasePlan({ key: KEY, total: 100 }, { key: KEY, total: 80 }, 3, false);
  assert.equal(down.ease, true);
  assert.ok(Math.abs(down.error + 20) < 1e-9);
  const noise = ringEasePlan(prev, { key: KEY, total: 41 }, 2, false);
  assert.equal(noise.ease, false);
  assert.equal(noise.snap, false);
});

test('a 20s server correction eases while the clock keeps running, with no snap in the stroke or the gold arc', () => {
  const goal = 120;
  let vis = 40;
  for (let ms = 0; ms <= 1000; ms += 16) vis = ringTrack(40 + ms / 1000, 0, ms, RING_EASE_MS);
  assert.ok(Math.abs(vis - 41) < 0.02, 'a running ring stays on the real elapsed time');
  const truth = vis + 20;
  const plan = ringEasePlan({ key: KEY, total: vis }, { key: KEY, total: truth }, 2, false);
  assert.equal(plan.ease, true);
  assert.ok(Math.abs(plan.error - 20) < 0.05);
  const jump = Math.abs(ringDash(88, vis / goal).offset - ringDash(88, (vis + 20) / goal).offset);
  let prev = vis, maxStep = 0, maxOff = 0, prevOff = ringDash(88, vis / goal).offset;
  const frames = [];
  for (let ms = 0; ms <= RING_EASE_MS; ms += 16) {
    const truthNow = truth + ms / 1000;
    const shown = ringTrack(truthNow, plan.error, ms, RING_EASE_MS);
    maxStep = Math.max(maxStep, Math.abs(shown - prev));
    const off = ringDash(88, Math.min(1, shown / goal)).offset;
    maxOff = Math.max(maxOff, Math.abs(off - prevOff));
    prev = shown; prevOff = off; frames.push(shown);
  }
  assert.ok(Math.abs(frames[0] - vis) < 0.05, 'first frame stays on the displayed value');
  // Ease-in-out peaks near 2s of study time per 16ms frame. That is a fast sweep, not a 20s snap.
  assert.ok(maxStep < 2.5, 'largest frame step is ' + maxStep + 's, not the 20s correction');
  assert.ok(maxOff * 4 < jump, 'stroke step ' + maxOff + ' vs a snap of ' + jump);
  const endTruth = truth + RING_EASE_MS / 1000;
  assert.ok(Math.abs(ringTrack(endTruth, plan.error, RING_EASE_MS, RING_EASE_MS) - endTruth) < 1e-6);
  assert.ok(endTruth - frames[0] > 19); // the displayed value does travel the correction, plus the live second
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i] + 1e-9 >= frames[i - 1]);

  // Already in overtime: the gold lap eases the same way (paused correction, truth holds still).
  const goldKey = 'goal|2026-11-15|sess|CARS|100';
  const gPlan = ringEasePlan({ key: goldKey, total: 130 }, { key: goldKey, total: 150 }, 2, false);
  assert.equal(gPlan.ease, true);
  let prevPct = goalOvertime(130, 100).arcs[0].pct, maxDp = 0;
  for (let ms = 0; ms <= RING_EASE_MS; ms += 16) {
    const shown = ringTrack(150, gPlan.error, ms, RING_EASE_MS);
    const pct = goalOvertime(shown, 100).arcs[0].pct;
    maxDp = Math.max(maxDp, Math.abs(pct - prevPct));
    prevPct = pct;
  }
  assert.ok(Math.abs(goalOvertime(130, 100).arcs[0].pct - 0.3) < 1e-12);
  assert.ok(maxDp < 0.05, 'gold arc step ' + maxDp + ' (a snap would be 0.2)');
  const goldEnd = goalOvertime(ringTrack(150, gPlan.error, RING_EASE_MS, RING_EASE_MS), 100).arcs[0].pct;
  assert.ok(Math.abs(goldEnd - 0.5) < 1e-9);
});

test('the ring is a persistent stroke driven by one paused frame loop; the clock text stays on tick', () => {
  assert.match(js, /id="tRingSvg">\$\{ring\(88, 0\)\}/);
  assert.equal((js.match(/requestAnimationFrame\(ringFrame\)/g) || []).length, 2);
  const frame = js.slice(js.indexOf('function ringFrame()'), js.indexOf('function tick()'));
  const kick = js.slice(js.indexOf('function ringKick()'), js.indexOf('function ringFrame()'));
  assert.match(frame, /document\.hidden/);
  assert.match(frame, /animLevel\(\) < 1/);
  assert.match(frame, /ringApply\(/);
  assert.match(frame, /ringGold\(goalOvertime\(tracked/);
  assert.doesNotMatch(frame, /fmtClock|\$\('clock'\)|textContent/);
  assert.match(kick, /document\.hidden/);
  assert.match(kick, /animLevel\(\) < 1/);
  const tick = js.slice(js.indexOf('function tick()'), js.indexOf('// Now-studying card'));
  assert.match(tick, /ringPlan\(m, animLevel\(\)\)/);
  assert.match(tick, /document\.hidden\) \{ ringHalt\(\)/);
  assert.match(tick, /\$\('clock'\)\.textContent = fmtClock\(shown\)/);
  assert.match(tick, /const shown = m\.shown/);
  assert.doesNotMatch(tick, /tRingSvg'\)\.innerHTML/);
  const title = js.slice(js.indexOf('function tabTitleFor'), js.indexOf('function syncTabTitle'));
  assert.doesNotMatch(title, /ringFrame|ringTrack|ringEase/);
  assert.match(css, /\.tring \.ring-fg,\.running \.tring \.ring-fg\{[\s\S]*?transition:none\}/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /studyhertz-shell-v178/);
});
