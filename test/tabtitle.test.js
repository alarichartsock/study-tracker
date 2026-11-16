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
const titleFns = ['fmtHM', 'tabTitlePrefs', 'titleDayShift', 'activeStudySec', 'savedStudySec', 'todayStudySec', 'titleExtra', 'tabTitleFor', 'syncTabTitle'].map(n => sliceFn(js, n)).join('\n');
global.TZ = require('../public/tz.js');

function loadTitle() {
  return new Function(`${padLine}\n${fmtLine}\n${titleFns}\nreturn { tabTitleFor, fmtHM, tabTitlePrefs, titleDayShift, activeStudySec, savedStudySec, todayStudySec };`)();
}
const api = loadTitle();
const tabTitleFor = api.tabTitleFor;
const loadSync = (document, S, ME, BRAND, LANDING_TITLE) => new Function('document', 'S', 'ME', 'BRAND', 'LANDING_TITLE', `${padLine}\n${fmtLine}\n${titleFns}\nreturn syncTabTitle;`)(document, S, ME, BRAND, LANDING_TITLE);
const subjOn = { timer: true, today: false, subject: true, brand: false };

const start = Date.parse('2026-11-10T15:00:00.000Z');
const running = (over = {}) => ({ accum: 0, paused: false, start: new Date(start).toISOString(), subject: 'CARS', ...over });

test('tab title is the timestamp elapsed time, not a tick count', () => {
  const a = running();
  assert.equal(tabTitleFor(a, start, true, 'StudyHertz', 'Land'), '0:00:00 · 0:00 today — StudyHertz');
  assert.equal(tabTitleFor(a, start + 1900, true, 'StudyHertz', 'Land'), '0:00:01 · 0:00 today — StudyHertz');
  assert.equal(tabTitleFor(a, start + 59000, true, 'StudyHertz', 'Land'), '0:00:59 · 0:00 today — StudyHertz');
  assert.equal(tabTitleFor(a, start + 60000, true, 'StudyHertz', 'Land'), '0:01:00 · 0:01 today — StudyHertz');
  // a long gap (throttled, slept, or background-frozen) still lands on the real elapsed second
  assert.equal(tabTitleFor(a, start + 3600 * 1000 + 500, true, 'StudyHertz', 'Land'), '1:00:00 · 1:00 today — StudyHertz');
  assert.equal(tabTitleFor(a, start + 10 * 3600 * 1000, true, 'StudyHertz', 'Land'), '10:00:00 · 10:00 today — StudyHertz');
});

test('paused time is accumulated and does not grow while paused; resume continues from it', () => {
  const paused = running({ accum: 125, paused: true });
  assert.equal(tabTitleFor(paused, start + 999999, true, 'StudyHertz', 'Land'), '0:02 today — StudyHertz');
  const resumed = running({ accum: 125, start: new Date(start + 500000).toISOString(), subject: 'Bio/Biochem' });
  assert.equal(tabTitleFor(resumed, start + 500000 + 4000, true, 'StudyHertz', 'Land'), '0:02:09 · 0:02 today — StudyHertz');
  assert.equal(tabTitleFor(resumed, start + 500000 + 4000, true, 'StudyHertz', 'Land'), tabTitleFor(resumed, start + 500000 + 4900, true, 'StudyHertz', 'Land'));
  assert.equal(tabTitleFor(resumed, start + 500000 + 4000, true, 'StudyHertz', 'Land', { prefs: subjOn }), '0:02:09 · Bio/Biochem');
});

test('countdown and pomodoro titles show time remaining and clamp at zero', () => {
  const cd = running({ subject: 'Chem/Phys', targetSec: 25 * 60 });
  assert.equal(tabTitleFor(cd, start + 1000, true, 'StudyHertz', 'L'), '0:24:59 · 0:00 today — StudyHertz');
  assert.equal(tabTitleFor(cd, start + 25 * 60 * 1000 + 5000, true, 'StudyHertz', 'L'), '0:00:00 · 0:25 today — StudyHertz');
  const switched = running({ subject: 'Psych/Soc', targetSec: 25 * 60, accum: 30 });
  assert.equal(tabTitleFor(switched, start + 1000, true, 'StudyHertz', 'L', { prefs: subjOn }), '0:24:29 · Psych/Soc');
});

test('running tab title includes the activity when the subject is shown, and changes in the same second it is switched', () => {
  const a = running({ activity: 'Passages' });
  assert.equal(tabTitleFor(a, start + 1500, true, 'StudyHertz', 'Land'), '0:00:01 · 0:00 today — StudyHertz');
  assert.equal(tabTitleFor(a, start + 1500, true, 'StudyHertz', 'Land', { prefs: subjOn }), '0:00:01 · CARS · Passages');
  assert.equal(tabTitleFor(running({ activity: '' }), start + 1500, true, 'StudyHertz', 'Land', { prefs: subjOn }), '0:00:01 · CARS');
  assert.equal(tabTitleFor(running({ activity: 'Passages', paused: true }), start + 1500, true, 'StudyHertz', 'Land'), '0:00 today — StudyHertz');
  const document = { title: '' };
  const S = { active: a, settings: { tabTitle: subjOn, timezone: 'UTC' } };
  const sync = loadSync(document, S, { id: 1 }, 'StudyHertz', 'Land');
  sync(start + 1500);
  assert.equal(document.title, '0:00:01 · CARS · Passages');
  S.active.activity = 'Review mistakes';
  sync(start + 1500); // same displayed second: the activity still has to land
  assert.equal(document.title, '0:00:01 · CARS · Review mistakes');
  S.active.activity = '';
  sync(start + 1600);
  assert.equal(document.title, '0:00:01 · CARS');
});

test('ring label follows the selected activity when idle, running, and paused', () => {
  const timerLabel = new Function(`${sliceFn(js, 'timerLabel')}\nreturn timerLabel;`)();
  assert.equal(timerLabel(null, 'Bio/Biochem', ''), 'Bio/Biochem');
  assert.equal(timerLabel(null, 'Bio/Biochem', 'Reading'), 'Bio/Biochem · Reading');
  assert.equal(timerLabel(null, 'Bio/Biochem', 'Content review'), 'Bio/Biochem · Content review');
  assert.equal(timerLabel(null, '', 'Reading'), 'Pick a subject');
  assert.equal(timerLabel(null, '', ''), 'Pick a subject');
  const run = { paused: false };
  assert.equal(timerLabel(run, 'Bio/Biochem', 'Reading'), 'Bio/Biochem · Reading');
  assert.equal(timerLabel(run, 'Bio/Biochem', 'Practice questions'), 'Bio/Biochem · Practice questions');
  assert.equal(timerLabel(run, 'Bio/Biochem', ''), 'Bio/Biochem');
  const paused = { paused: true };
  assert.equal(timerLabel(paused, 'Bio/Biochem', 'Reading'), 'Paused · Bio/Biochem · Reading');
  assert.equal(timerLabel(paused, 'Bio/Biochem', 'Flashcards'), 'Paused · Bio/Biochem · Flashcards');
  assert.equal(timerLabel(paused, 'CARS', ''), 'Paused · CARS');
});

test('stopped and signed-out titles reset; a running subject rename is the title subject', () => {
  assert.equal(tabTitleFor(null, start + 5000, true, 'StudyHertz', 'Land'), '0:00 today — StudyHertz');
  assert.equal(tabTitleFor(undefined, start, false, 'StudyHertz', 'Land'), 'Land');
  assert.equal(tabTitleFor(running({ subject: 'Renamed' }), start + 2000, true, 'StudyHertz', 'Land', { prefs: subjOn }), '0:00:02 · Renamed');
});

test('title write is skipped when the second has not changed, and forced after a clobber', () => {
  const document = { title: 'old' };
  let S = { active: running() };
  let ME = { id: 1 };
  const BRAND = 'StudyHertz', LANDING_TITLE = 'Land';
  const syncTabTitle = loadSync(document, S, ME, BRAND, LANDING_TITLE);
  syncTabTitle(start + 1500);
  assert.equal(document.title, '0:00:01 · 0:00 today — StudyHertz');
  document.title = 'Translated 0:00:01'; // i18n, or a re-render, wrote over the title
  syncTabTitle(start + 1800); // same displayed second: leave the translation alone
  assert.equal(document.title, 'Translated 0:00:01');
  syncTabTitle(start + 1800, true); // visibility / focus / pageshow / render repairs a clobber
  assert.equal(document.title, '0:00:01 · 0:00 today — StudyHertz');
  S.active.paused = true;
  syncTabTitle(start + 99999);
  assert.equal(document.title, '0:00 today — StudyHertz');
  S.active = null;
  ME = null;
  // ME is a closed-over binding, not a live reassignment of the outer let — pass a fresh call
  const sync2 = loadSync(document, S, null, BRAND, LANDING_TITLE);
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
  assert.match(js, /function wakeTabClock\(\) \{ syncTabTitle\(Date\.now\(\), true\); tick\(\); NOW\.draw\(\); armTabClock\(\); syncTabWorker\(\); armDayTitle\(\); \}/);
  assert.doesNotMatch(js, /setInterval\(\(\) => \{ tick\(\); checkReminder\(\); NOW\.draw\(\); \}, 1000\)/);
  assert.match(js, /if \(tabBus && !document\.hidden && tabClockLive\(\)\)/); // only a visible tab broadcasts
  assert.match(js, /if \(!document\.hidden\) return/); // hidden tabs are the ones that follow the broadcast
  assert.match(js, /function tabWorkerWanted\(\) \{ return !!document\.hidden && tabClockLive\(\); \}/);
  const clock = js.slice(js.indexOf('function tabTitleFor'), js.indexOf('ACT.mode'));
  assert.doesNotMatch(clock, /location\.reload|shTabReload/);
  assert.doesNotMatch(clock, /accentFavicon|favSvg/); // favicon stays on the accent path
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), /studyhertz-shell-v179/);
  assert.match(js, /addEventListener\('pageshow', pinIosWash\)/); // mobile Safari wash fix stays
  assert.match(js, /armTabClock\(\); armDayTitle\(\);/);
});

test('today total is H:MM, saved sessions for the app day, plus the open timer, and pauses do not tick', () => {
  const TZ = global.TZ, zone = 'America/Los_Angeles';
  const now = Date.parse('2026-11-16T20:00:00.000Z'); // 12:00 PST
  const key = (t, shift) => TZ.key(t, zone, shift);
  const sess = (startIso, sec, breakSec = 0) => ({ start: startIso, end: new Date(Date.parse(startIso) + (sec + breakSec) * 1000).toISOString(), breakSec, subject: 'CARS' });
  const sessions = [
    sess('2026-11-16T18:00:00.000Z', 3600),
    sess('2026-11-16T19:00:00.000Z', 20 * 60, 10 * 60),
    sess('2026-11-15T18:00:00.000Z', 90 * 60),
  ];
  const same = shift => s => key(s.start, shift) === key(now, shift);
  assert.equal(api.todayStudySec(sessions, null, now, same(0)), 3600 + 20 * 60);
  const active = { accum: 0, paused: false, start: new Date(now - 125000).toISOString(), subject: 'CARS' };
  assert.equal(api.todayStudySec(sessions, active, now, same(0)), 3600 + 20 * 60 + 125);
  const paused = { accum: 125, paused: true, start: new Date(now - 999999).toISOString(), subject: 'CARS' };
  assert.equal(api.todayStudySec(sessions, paused, now, same(0)), 3600 + 20 * 60 + 125);
  assert.equal(api.todayStudySec(sessions, paused, now + 60000, same(0)), 3600 + 20 * 60 + 125);
  assert.equal(api.todayStudySec(sessions.slice(1), null, now, same(0)), 20 * 60);
  const edited = [{ ...sessions[0], end: new Date(Date.parse(sessions[0].start) + 5400 * 1000).toISOString() }, sessions[1]];
  assert.equal(api.todayStudySec(edited, null, now, same(0)), 5400 + 20 * 60);
  const early = sess('2026-11-16T11:30:00.000Z', 600), late = sess('2026-11-16T12:30:00.000Z', 600);
  assert.equal(key('2026-11-16T11:30:00.000Z', 4), '2026-11-15');
  assert.equal(key('2026-11-16T12:30:00.000Z', 4), '2026-11-16');
  assert.equal(api.todayStudySec([early, late], null, now, s => key(s.start, 4) === key(now, 4)), 600);
  const shift = api.titleDayShift({ dayStartHour: 4, dayStartMinute: 45 });
  assert.equal(shift, 4.75);
  assert.equal(key('2026-11-16T12:30:00.000Z', shift), '2026-11-15');
  assert.equal(key('2026-11-16T13:00:00.000Z', shift), '2026-11-16');
  assert.equal(api.titleDayShift({ dayStartHour: 3 }), 3);
  assert.equal(api.titleDayShift({}), 0);
  assert.equal(api.titleDayShift(undefined), 0);
  const five = sess('2026-11-16T13:00:00.000Z', 900);
  assert.equal(api.todayStudySec([late, five], null, now, s => key(s.start, shift) === key(now, shift)), 900);
  assert.equal(api.fmtHM(0), '0:00');
  assert.equal(api.fmtHM(59), '0:00');
  assert.equal(api.fmtHM(125), '0:02');
  assert.equal(api.fmtHM(2 * 3600 + 5 * 60), '2:05');
  assert.equal(api.fmtHM(9 * 3600 + 3 * 60), '9:03');
  assert.equal(api.fmtHM(10 * 3600), '10:00');
  assert.equal(api.fmtHM(12 * 3600 + 40 * 60), '12:40');
});

test('defaults show the clock, today and the app name; toggles and an empty set fall back cleanly', () => {
  assert.deepEqual(api.tabTitlePrefs(undefined), { timer: true, today: true, subject: false, brand: true });
  assert.deepEqual(api.tabTitlePrefs({ subject: true }), { timer: true, today: true, subject: true, brand: true });
  const runningAt = running();
  const at = start + 25 * 60 * 1000 + 13000;
  assert.equal(tabTitleFor(runningAt, at, true, 'StudyHertz', 'Land', { todaySec: 2 * 3600 + 41 * 60 }), '0:25:13 · 2:41 today — StudyHertz');
  assert.equal(tabTitleFor(null, start, true, 'StudyHertz', 'Land', { todaySec: 2 * 3600 + 41 * 60 }), '2:41 today — StudyHertz');
  assert.equal(tabTitleFor(running({ activity: 'Passages' }), at, true, 'StudyHertz', 'Land', { prefs: { timer: true, today: true, subject: true, brand: true }, todaySec: 2 * 3600 + 41 * 60 }), '0:25:13 · CARS · Passages · 2:41 today — StudyHertz');
  assert.equal(tabTitleFor(null, start, true, 'StudyHertz', 'Land', { prefs: { timer: false, today: true, subject: false, brand: false }, todaySec: 2 * 3600 + 5 * 60 }), '2:05 today');
  assert.equal(tabTitleFor(runningAt, at, true, 'StudyHertz', 'Land', { prefs: { timer: false, today: false, subject: false, brand: false }, todaySec: 3600 }), 'StudyHertz');
  assert.equal(tabTitleFor(null, start, true, 'StudyHertz', 'Land', { prefs: { brand: true, today: false, timer: false, subject: false } }), 'StudyHertz');
});

test('the title follows session edits and the app-day boundary without waiting for a reload', () => {
  const document = { title: '' };
  const before = Date.parse('2026-11-16T07:59:00.000Z'); // 23:59 PST Nov 15
  const after = Date.parse('2026-11-16T08:01:00.000Z'); // 00:01 PST Nov 16
  const S = { active: null, sessions: [{ start: '2026-11-15T20:00:00.000Z', end: '2026-11-15T21:00:00.000Z', breakSec: 0, subject: 'CARS' }], settings: { timezone: 'America/Los_Angeles', dayStartHour: 0 } };
  const sync = loadSync(document, S, { id: 1 }, 'StudyHertz', 'Land');
  sync(before, true);
  assert.equal(document.title, '1:00 today — StudyHertz');
  sync(after, true);
  assert.equal(document.title, '0:00 today — StudyHertz');
  S.sessions = S.sessions.concat([{ start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T09:41:00.000Z', breakSec: 0, subject: 'Bio/Biochem' }]);
  sync(after, true);
  assert.equal(document.title, '1:41 today — StudyHertz');
  S.sessions[1].end = '2026-11-16T08:20:00.000Z';
  sync(after, true);
  assert.equal(document.title, '0:20 today — StudyHertz');
  S.sessions.pop();
  sync(after, true);
  assert.equal(document.title, '0:00 today — StudyHertz');
  const mid = Date.parse('2026-11-16T08:40:00.000Z'); // 00:40 PST, after a 00:30 day start
  S.settings.dayStartMinute = 30;
  S.sessions = [{ start: '2026-11-16T08:10:00.000Z', end: '2026-11-16T09:10:00.000Z', breakSec: 0 }]; // 00:10 PST, still the previous app day
  sync(mid, true);
  assert.equal(document.title, '0:00 today — StudyHertz');
  S.sessions = [{ start: '2026-11-16T08:40:00.000Z', end: '2026-11-16T09:40:00.000Z', breakSec: 0 }];
  sync(mid, true);
  assert.equal(document.title, '1:00 today — StudyHertz');
});

test('tab title settings render as labeled toggles and persist, including when the field was absent', async t => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(js, /id="tabTitleSet"/);
  assert.match(js, /data-chg="tabTitle" data-k="\$\{key\}"/);
  assert.match(js, /row\('ttTimer', 'timer', 'Running session timer'/);
  assert.match(js, /row\('ttToday', 'today', 'Today/);
  assert.match(js, /row\('ttSubject', 'subject', 'Current subject'/);
  assert.match(js, /row\('ttBrand', 'brand', 'App name'/);
  assert.match(js, /function tabTitleCard\(\) \{[\s\S]*<label for="\$\{id\}">\$\{label\}<\/label>/);
  assert.match(js, /ACT\.tabTitle = async[\s\S]*?syncTabTitle\(Date\.now\(\), true\)/);
  assert.match(css, /\.tt-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:640px\)\{\.tt-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  const { migrateUserData } = require('../lib/store');
  const old = migrateUserData({ settings: { dayStartHour: 2 } });
  assert.equal(old.settings.dayStartHour, 2);
  assert.deepEqual(old.settings.tabTitle, { timer: true, today: true, subject: false, brand: true });
  const partial = migrateUserData({ settings: { tabTitle: { subject: true } } });
  assert.equal(partial.settings.tabTitle.subject, true);
  assert.equal(partial.settings.tabTitle.timer, true);
  assert.equal(partial.settings.tabTitle.today, true);
  assert.equal(partial.settings.tabTitle.brand, true);
  const { createApp } = require('../server');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-title-'));
  const server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await call('/api/register', 'POST', { email: 'tab@example.com', agree: true, birthYear: 1990, username: 'tabby', password: 'secret-pass-1' })).status, 200);
  assert.deepEqual((await call('/api/state')).body.settings.tabTitle, { timer: true, today: true, subject: false, brand: true });
  assert.equal((await call('/api/settings', 'POST', { tabTitle: { subject: true } })).status, 200);
  assert.deepEqual((await call('/api/state')).body.settings.tabTitle, { timer: true, today: true, subject: true, brand: true });
  assert.equal((await call('/api/settings', 'POST', { tabTitle: 'nope' })).status, 400);
  assert.equal((await call('/api/settings', 'POST', { tabTitle: { timer: false, brand: false } })).status, 200);
  assert.deepEqual((await call('/api/state')).body.settings.tabTitle, { timer: false, today: true, subject: true, brand: false });
  assert.equal((await call('/api/settings', 'POST', { dayStartHour: 3 })).status, 200);
  const kept = (await call('/api/state')).body.settings;
  assert.equal(kept.dayStartHour, 3);
  assert.deepEqual(kept.tabTitle, { timer: false, today: true, subject: true, brand: false });
});
