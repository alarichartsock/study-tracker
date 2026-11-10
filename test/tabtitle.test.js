'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

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

const padLine = js.match(/const pad = n => String\(n\)\.padStart\(2, '0'\);/)[0];
const fmtLine = js.match(/const fmtClock = s => \{ s = Math\.max\(0, Math\.floor\(s\)\); return `\$\{Math\.floor\(s \/ 3600\)\}:\$\{pad\(Math\.floor\(s \/ 60\) % 60\)\}:\$\{pad\(s % 60\)\}`; \};/)[0];

function loadTitle() {
  return new Function(`${padLine}\n${fmtLine}\n${sliceFn(js, 'tabTitleFor')}\nreturn tabTitleFor;`)();
}
const tabTitleFor = loadTitle();

const start = Date.parse('2026-11-10T15:00:00.000Z');
const running = (over = {}) => ({ accum: 0, paused: false, start: new Date(start).toISOString(), subject: 'CARS', ...over });

test('tab title is the timestamp elapsed time, not a tick count', () => {
  const a = running();
  assert.equal(tabTitleFor(a, start, true, 'StudyHertz', 'Land'), '0:00:00 · CARS');
  assert.equal(tabTitleFor(a, start + 1900, true, 'StudyHertz', 'Land'), '0:00:01 · CARS');
  assert.equal(tabTitleFor(a, start + 59000, true, 'StudyHertz', 'Land'), '0:00:59 · CARS');
  assert.equal(tabTitleFor(a, start + 60000, true, 'StudyHertz', 'Land'), '0:01:00 · CARS');
  // a long gap (throttled, slept, or background-frozen) still lands on the real elapsed second
  assert.equal(tabTitleFor(a, start + 3600 * 1000 + 500, true, 'StudyHertz', 'Land'), '1:00:00 · CARS');
  assert.equal(tabTitleFor(a, start + 10 * 3600 * 1000, true, 'StudyHertz', 'Land'), '10:00:00 · CARS');
});

test('paused time is accumulated and does not grow while paused; resume continues from it', () => {
  const paused = running({ accum: 125, paused: true });
  assert.equal(tabTitleFor(paused, start + 999999, true, 'StudyHertz', 'Land'), 'StudyHertz');
  const resumed = running({ accum: 125, start: new Date(start + 500000).toISOString(), subject: 'Bio/Biochem' });
  assert.equal(tabTitleFor(resumed, start + 500000 + 4000, true, 'StudyHertz', 'Land'), '0:02:09 · Bio/Biochem');
  assert.equal(tabTitleFor(resumed, start + 500000 + 4000, true, 'StudyHertz', 'Land'), tabTitleFor(resumed, start + 500000 + 4900, true, 'StudyHertz', 'Land'));
});

test('countdown and pomodoro titles show time remaining and clamp at zero', () => {
  const cd = running({ subject: 'Chem/Phys', targetSec: 25 * 60 });
  assert.equal(tabTitleFor(cd, start + 1000, true, 'StudyHertz', 'L'), '0:24:59 · Chem/Phys');
  assert.equal(tabTitleFor(cd, start + 25 * 60 * 1000 + 5000, true, 'StudyHertz', 'L'), '0:00:00 · Chem/Phys');
  const switched = running({ subject: 'Psych/Soc', targetSec: 25 * 60, accum: 30 });
  assert.equal(tabTitleFor(switched, start + 1000, true, 'StudyHertz', 'L'), '0:24:29 · Psych/Soc');
});

test('stopped and signed-out titles reset; a running subject rename is the title subject', () => {
  assert.equal(tabTitleFor(null, start + 5000, true, 'StudyHertz', 'Land'), 'StudyHertz');
  assert.equal(tabTitleFor(undefined, start, false, 'StudyHertz', 'Land'), 'Land');
  assert.equal(tabTitleFor(running({ subject: 'Renamed' }), start + 2000, true, 'StudyHertz', 'Land'), '0:00:02 · Renamed');
});

test('title write is skipped when the second has not changed, and forced after a clobber', () => {
  const document = { title: 'old' };
  let S = { active: running() };
  let ME = { id: 1 };
  const BRAND = 'StudyHertz', LANDING_TITLE = 'Land';
  const syncTabTitle = new Function('document', 'S', 'ME', 'BRAND', 'LANDING_TITLE', `${padLine}\n${fmtLine}\n${sliceFn(js, 'tabTitleFor')}\n${sliceFn(js, 'syncTabTitle')}\nreturn syncTabTitle;`)(document, S, ME, BRAND, LANDING_TITLE);
  syncTabTitle(start + 1500);
  assert.equal(document.title, '0:00:01 · CARS');
  document.title = 'Translated 0:00:01'; // i18n, or a re-render, wrote over the title
  syncTabTitle(start + 1800); // same displayed second: leave the translation alone
  assert.equal(document.title, 'Translated 0:00:01');
  syncTabTitle(start + 1800, true); // visibility / focus / pageshow / render repairs a clobber
  assert.equal(document.title, '0:00:01 · CARS');
  S.active.paused = true;
  syncTabTitle(start + 99999);
  assert.equal(document.title, 'StudyHertz');
  S.active = null;
  ME = null;
  // ME is a closed-over binding, not a live reassignment of the outer let — pass a fresh call
  const sync2 = new Function('document', 'S', 'ME', 'BRAND', 'LANDING_TITLE', `${padLine}\n${fmtLine}\n${sliceFn(js, 'tabTitleFor')}\n${sliceFn(js, 'syncTabTitle')}\nreturn syncTabTitle;`)(document, S, null, BRAND, LANDING_TITLE);
  sync2(start, true);
  assert.equal(document.title, 'Land');
});

test('clock delay tracks the session second, and the hidden-tab worker only runs while a clock is live', () => {
  const S = { active: running() };
  const UI = { pomo: null };
  const document = { hidden: false };
  const api = new Function('S', 'UI', 'document', `${sliceFn(js, 'tabClockLive')}\n${sliceFn(js, 'tabClockDelay')}\n${sliceFn(js, 'tabWorkerWanted')}\nreturn { tabClockLive, tabClockDelay, tabWorkerWanted };`)(S, UI, document);
  assert.equal(api.tabClockLive(), true);
  assert.equal(api.tabWorkerWanted(), false); // visible: the main thread is enough
  assert.equal(api.tabClockDelay(start + 1500), 500); // next elapsed second is 500ms away
  assert.equal(api.tabClockDelay(start + 2000), 1000); // exactly on a boundary -> the following one
  S.active.paused = true;
  assert.equal(api.tabClockLive(), false);
  document.hidden = true;
  assert.equal(api.tabWorkerWanted(), false); // paused, even if hidden
  S.active = null;
  UI.pomo = { phase: 'break', until: start + 2500 };
  assert.equal(api.tabClockLive(), true);
  assert.equal(api.tabWorkerWanted(), true);
  assert.equal(api.tabClockDelay(start + 2000), 500); // break flips on its own remaining-second boundary
  UI.pomo = null;
  document.hidden = true;
  assert.equal(api.tabClockLive(), false);
  assert.equal(api.tabClockDelay(start + 200), 800); // idle: wall-clock alignment, still one wakeup a second
});

test('hidden-tab worker script posts immediately and reschedules on the next wall-clock second', () => {
  const src = /const src = `([^`]+)`/.exec(js)[1];
  const posts = [], scheduled = [];
  const ctx = { postMessage(v) { posts.push(v); }, setTimeout(fn, ms) { scheduled.push(ms); return scheduled.length; }, clearTimeout() {}, Date };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.onmessage({ data: 'nope' });
  assert.equal(posts.length, 0);
  ctx.onmessage({ data: 'run' });
  assert.equal(posts.length, 1);
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0] >= 1 && scheduled[0] <= 1000);
});

test('title sync is not tied to the timer view and wakes on visibility, focus, pageshow, resume, and freeze', () => {
  const tickSrc = js.slice(js.indexOf('function tick()'), js.indexOf('// Now-studying card'));
  const syncAt = tickSrc.indexOf('syncTabTitle(now)');
  const gateAt = tickSrc.indexOf("if (view !== 'timer' || !$('clock')) return;");
  assert.ok(syncAt >= 0 && gateAt > syncAt, 'title is written before the timer-view return');
  assert.doesNotMatch(tickSrc, /document\.title = a && !a\.paused/);
  assert.match(js, /async function load\(\) \{(?:(?!\n\}\n)[\s\S])*syncTabTitle\(Date\.now\(\), true\); syncTabWorker\(\);/);
  assert.match(js, /cometSync\(\); syncTabTitle\(Date\.now\(\), true\); syncTabWorker\(\); \}/);
  assert.match(js, /document\.addEventListener\('visibilitychange', \(\) => \{ wakeTabClock\(\); \}\)/);
  assert.match(js, /window\.addEventListener\('focus', wakeTabClock\)/);
  assert.match(js, /window\.addEventListener\('blur', \(\) => \{ syncTabTitle\(Date\.now\(\), true\); syncTabWorker\(\); \}\)/);
  assert.match(js, /window\.addEventListener\('pageshow', wakeTabClock\)/);
  assert.match(js, /document\.addEventListener\('resume', wakeTabClock\)/);
  assert.match(js, /document\.addEventListener\('freeze', \(\) => syncTabTitle\(Date\.now\(\), true\)\)/);
  assert.match(js, /function wakeTabClock\(\) \{ syncTabTitle\(Date\.now\(\), true\); tick\(\); NOW\.draw\(\); armTabClock\(\); syncTabWorker\(\); \}/);
  assert.doesNotMatch(js, /setInterval\(\(\) => \{ tick\(\); checkReminder\(\); NOW\.draw\(\); \}, 1000\)/);
  assert.match(js, /if \(tabBus && !document\.hidden && tabClockLive\(\)\)/); // only a visible tab broadcasts
  assert.match(js, /if \(!document\.hidden\) return/); // hidden tabs are the ones that follow the broadcast
  assert.match(js, /function tabWorkerWanted\(\) \{ return !!document\.hidden && tabClockLive\(\); \}/);
  const clock = js.slice(js.indexOf('function tabTitleFor'), js.indexOf('ACT.mode'));
  assert.doesNotMatch(clock, /location\.reload|shTabReload/);
  assert.doesNotMatch(clock, /accentFavicon|favSvg/); // favicon stays on the accent path
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /studyhertz-shell-v172/);
  assert.match(js, /addEventListener\('pageshow', pinIosWash\)/); // mobile Safari wash fix stays
});
