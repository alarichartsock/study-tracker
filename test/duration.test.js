'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const Dur = require('../public/duration.js');
const stats = require('../lib/stats'), TZ = require('../public/tz.js');
const { createApp } = require('../server');

test('2.5 hours is 2h 30m, and stored minutes round-trip', () => {
  assert.equal(Dur.fromHours(2.5), 150);
  assert.equal(Dur.fromHours('2.5'), 150);
  assert.equal(Dur.fromHours('2,5'), 150);
  assert.equal(Dur.fromHours('2h 30m'), 150);
  assert.equal(Dur.fromHours('2:30'), 150);
  assert.equal(Dur.fromHours('90m'), 90);
  assert.equal(Dur.fromHours(''), null);
  assert.equal(Dur.fromHours('nope'), null);
  assert.deepEqual(Dur.splitMin(150), { h: 2, m: 30 });
  assert.deepEqual(Dur.splitMin(360), { h: 6, m: 0 });
  assert.deepEqual(Dur.splitMin(0), { h: 0, m: 0 });
  assert.deepEqual(Dur.splitMin(null), { h: '', m: '' });
  assert.equal(Dur.join('2', '30'), 150);
  assert.equal(Dur.join('2', ''), 120);
  assert.equal(Dur.join('', '30'), 30);
  assert.equal(Dur.join('0', '0'), 0);
  assert.equal(Dur.join('', '', { blank: true }), null);
  assert.equal(Dur.join('', ''), 0);
  assert.equal(Dur.join('1', '75'), 135); // 75 minutes carries
  assert.equal(Dur.join('2.5', ''), 150);
  assert.equal(Dur.join('2.5', '0'), 150);
  assert.equal(Dur.join('-1', '10'), 10);
  assert.equal(Dur.short(150), '2h 30m');
  assert.equal(Dur.short(25), '25m');
  assert.equal(Dur.short(120), '2h');
  assert.deepEqual(Dur.parseList('25, 90, 1:30, 1h 30m, 2h'), [25, 90, 90, 90, 120]);
});

test('day-start clock caps at 6:59 and keeps typed minutes', () => {
  assert.equal(Dur.join('3', '30', { clock: true, maxHour: 6 }), 3 * 60 + 30);
  assert.equal(Dur.join('8', '15', { clock: true, maxHour: 6 }), 6 * 60 + 15);
  assert.equal(Dur.join('6', '75', { clock: true, maxHour: 6 }), 6 * 60 + 15);
  assert.equal(Dur.join('', '', { clock: true, maxHour: 6 }), 0);
  const html = Dur.fields({ id: 'gD', label: 'Daily', minutes: 150 });
  assert.match(html, /<input /); assert.equal((html.match(/<input /g) || []).length, 1);
  assert.match(html, /id="gD"/); assert.match(html, /class="html-duration-picker/);
  assert.match(html, /data-hide-seconds/); assert.match(html, /value="02:30"/);
  assert.doesNotMatch(html, /data-part=/);
  const blank = Dur.fields({ id: 'gWE', label: 'Weekend daily', minutes: null, blank: true });
  assert.match(blank, /data-allow-blank/); assert.match(blank, /value=""/);
  const zero = Dur.fields({ id: 'gWE', label: 'Weekend daily', minutes: 0, blank: true });
  assert.match(zero, /value="00:00"/);
  const picker = fs.readFileSync(path.join(__dirname, '../public/html-duration-picker.js'), 'utf8');
  assert.match(picker, /Apache-2\.0/); assert.match(picker, /adjustmentFactor === 60 \? 300/);
});

test('day start of 2:30 counts 2:20am toward the previous day', () => {
  const LA = 'America/Los_Angeles', c = stats.ctx(2, LA, 30);
  assert.equal(+c, 2); assert.equal(c.minute, 30); assert.equal(c.offsetMin, 150);
  assert.equal(TZ.offsetMs(c), 150 * 60e3);
  assert.equal(TZ.offsetMs(3), 3 * 3600e3); // whole hours stay exact
  assert.equal(stats.dayKey('2026-11-04T10:20:00Z', c), '2026-11-03'); // 2:20am PST
  assert.equal(stats.dayKey('2026-11-04T10:40:00Z', c), '2026-11-04'); // 2:40am PST
  assert.equal(stats.dayStart('2026-11-04', c).toISOString(), '2026-11-04T10:30:00.000Z');
  assert.equal(stats.ctxOf({ dayStartHour: 3, dayStartMinute: 45, timezone: LA }).offsetMin, 3 * 60 + 45);
  assert.equal(stats.ctxOf({ dayStartHour: 4 }).offsetMin, 240);
});

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-dur-')), dataFile = path.join(dir, 'data.json');
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true, gaApiSecret: '' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = ''; return async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  }; };
  const c = client();
  await c('/api/register', 'POST', { email: 'dur@example.com', username: 'dur', password: 'secret-pass-1', agree: true, birthYear: 1990 });
  return { c, close: () => new Promise(r => server.close(r)) };
}

test('saving hour+minute goals keeps minute precision and old minute clients', async t => {
  const app = await start(); t.after(app.close); const c = app.c;
  // 2h 30m daily, blank weekend, 25h 30m weekly, day starts 3:45. Same minute fields older clients already send.
  const save = await c('/api/settings', 'POST', { goals: { dailyMin: Dur.join('2', '30'), weekendDailyMin: Dur.join('', '', { blank: true }), weeklyMin: Dur.join('25', '30'), monthlyMin: 0, termMin: Dur.fromHours(2.5) }, dayStartHour: 3, dayStartMinute: 45, pomodoro: { focusMin: Dur.join('1', '35'), shortMin: 45, longMin: 90 } });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const s = (await c('/api/state')).body.settings;
  assert.equal(s.goals.dailyMin, 150); assert.equal(s.dailyGoalMin, 150);
  assert.equal(s.goals.weekendDailyMin, null);
  assert.equal(s.goals.weeklyMin, 25 * 60 + 30);
  assert.equal(s.goals.termMin, 150);
  assert.equal(s.dayStartHour, 3); assert.equal(s.dayStartMinute, 45);
  assert.equal(s.pomodoro.focusMin, 95);
  assert.deepEqual(Dur.splitMin(s.goals.dailyMin), { h: 2, m: 30 });
  // An older client that only knows hours still sets H:00 and still sends minutes for goals.
  const old = await c('/api/settings', 'POST', { goals: { dailyMin: 240, weekendDailyMin: 120 }, dayStartHour: 4 });
  assert.equal(old.status, 200);
  const s2 = (await c('/api/state')).body.settings;
  assert.equal(s2.goals.dailyMin, 240); assert.equal(s2.goals.weekendDailyMin, 120);
  assert.equal(s2.dayStartHour, 4); assert.equal(s2.dayStartMinute, 0);
  assert.equal(s2.goals.weeklyMin, 25 * 60 + 30); // untouched keys stay
  const sub = await c('/api/subjects', 'PUT', { name: 'CARS', weeklyGoalMin: Dur.join('1', '30') });
  assert.equal(sub.status, 200); assert.equal(sub.body.subjectMeta.CARS.weeklyGoalMin, 90);
  assert.equal((await c('/api/plan', 'POST', { date: '2026-11-02', minutes: Dur.join('1', '15') })).body['2026-11-02'], 75);
  assert.equal((await c('/api/settings', 'POST', { dayStartMinute: 60 })).status, 400);
  assert.equal((await c('/api/settings', 'POST', { dayStartHour: 3, dayStartMinute: 59 })).status, 200);
  assert.equal((await c('/api/state')).body.settings.dayStartMinute, 59);
});

test('duration picker is wired into every duration surface and the shell cache', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const id of ['gD', 'gWE', 'gW', 'gM', 'gT', 'gDS', 'pF', 'pS', 'pL', 'durm', 'brk', 'plan', 'cd', 'tourWk']) assert.match(app, new RegExp("id: '" + id + "'"));
  assert.match(app, /id: 'sg' \+ i/); assert.match(app, /id: 'md_' \+ m/);
  assert.match(app, /name: 'durm'/);
  assert.match(app, /dayStartMinute: day\.minute/);
  assert.match(html, /src="\/html-duration-picker\.js"/); assert.match(html, /src="\/duration\.js"/);
  assert.match(sw, /studyhertz-shell-v177/); assert.match(sw, /'\/html-duration-picker\.js'/);
});
