'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const TZ = require('../public/tz.js'), stats = require('../lib/stats'), analytics = require('../lib/analytics'), csv = require('../lib/csv'), mix = require('../public/mix.js');
const { blankUserData } = require('../lib/store');
const { createApp } = require('../server');
const iso = t => new Date(t).toISOString();
const LA = 'America/Los_Angeles';

test('toUtc: plain times, DST spring-forward gap and fall-back overlap, half-hour and southern zones', () => {
  assert.equal(iso(TZ.toUtc('2026-07-01', '12:00', LA)), '2026-07-01T19:00:00.000Z');
  assert.equal(iso(TZ.toUtc('2026-03-08', '01:30', LA)), '2026-03-08T09:30:00.000Z'); // PST
  assert.equal(iso(TZ.toUtc('2026-03-08', '02:30', LA)), '2026-03-08T10:30:00.000Z'); // gap -> 03:30 PDT
  assert.equal(iso(TZ.toUtc('2026-03-08', '03:00', LA)), '2026-03-08T10:00:00.000Z'); // PDT
  assert.equal(iso(TZ.toUtc('2026-11-01', '01:30', LA)), '2026-11-01T08:30:00.000Z'); // overlap -> first (PDT)
  assert.equal(iso(TZ.toUtc('2026-11-01', '02:00', LA)), '2026-11-01T10:00:00.000Z'); // PST
  assert.equal(iso(TZ.toUtc('2026-01-01', '00:00', 'Asia/Kolkata')), '2025-12-31T18:30:00.000Z');
  assert.equal(iso(TZ.toUtc('2026-04-05', '02:30', 'Australia/Sydney')), '2026-04-04T15:30:00.000Z'); // overlap, AEDT first
  assert.equal(iso(TZ.toUtc('2026-10-04', '02:30', 'Australia/Sydney')), '2026-10-03T16:30:00.000Z'); // gap
  assert.ok(TZ.valid(LA) && TZ.valid('UTC') && !TZ.valid('Mars/Base') && !TZ.valid('') && !TZ.valid(42));
});

test('day keys follow the user zone and dayStartHour, not the server zone', () => {
  const t = '2026-11-04T07:30:00Z'; // 11:30 PM Nov 3 in LA, 4:30 PM Nov 4 in Tokyo
  assert.equal(stats.dayKey(t, stats.ctx(0, LA)), '2026-11-03');
  assert.equal(stats.dayKey(t, stats.ctx(0, 'Asia/Tokyo')), '2026-11-04');
  assert.equal(stats.dayKey('2026-11-04T09:30:00Z', stats.ctx(2, LA)), '2026-11-03'); // 1:30 AM counts for the previous day
  assert.equal(stats.dayKey('2026-11-04T10:30:00Z', stats.ctx(2, LA)), '2026-11-04');
  assert.equal(stats.ctx(3, 'Nope/Zone').tz, LA); assert.equal(+stats.ctx(3), 3); assert.equal(stats.ctxOf({}).tz, LA);
  assert.equal(stats.dayStart('2026-03-08', stats.ctx(0, LA)).toISOString(), '2026-03-08T08:00:00.000Z');
  assert.equal(stats.dayStart('2026-03-09', stats.ctx(0, LA)).toISOString(), '2026-03-09T07:00:00.000Z'); // 23-hour day before
});

test('computeStats: today, streaks across the DST change, late-night sessions on the right day', () => {
  const S = (startZ, min) => ({ subject: 'CARS', start: startZ, end: new Date(Date.parse(startZ) + min * 60e3).toISOString() });
  // 11 PM local each night Oct 30 - Nov 2 (DST ends Nov 1): 06:00Z before, 07:00Z after
  const ss = [S('2026-10-31T06:00:00Z', 30), S('2026-11-01T06:00:00Z', 30), S('2026-11-02T07:00:00Z', 30), S('2026-11-03T07:00:00Z', 30)];
  const la = stats.computeStats(ss, { now: new Date('2026-11-03T08:00:00Z'), dayStartHour: stats.ctx(0, LA) }); // midnight-ish Nov 3 LA
  assert.deepEqual(Object.keys(la.byDay).sort(), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(la.todayKey, '2026-11-03'); assert.equal(la.streak, 4); assert.equal(la.bestStreak, 4); assert.equal(la.today, 0);
  const ny = stats.computeStats(ss, { now: new Date('2026-11-03T08:00:00Z'), dayStartHour: stats.ctx(0, 'America/New_York') });
  assert.deepEqual(Object.keys(ny.byDay).sort(), ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']); assert.equal(ny.todayKey, '2026-11-03'); assert.equal(ny.today, 1800);
});

test('report: time-of-day buckets use the user zone (spring-forward gap)', () => {
  const r = analytics.report([{ subject: 'CARS', start: '2026-03-08T09:30:00Z', end: '2026-03-08T11:00:00Z' }], { h: stats.ctx(0, LA) });
  assert.equal(r.byHour[1], 1800); assert.equal(r.byHour[2], 0); assert.equal(r.byHour[3], 3600);
  assert.equal(r.byHourSubject[1].CARS, 1800); assert.equal(r.byHourSubject[3].CARS, 3600); assert.equal(Object.keys(r.byHourSubject[2]).length, 0);
  const t = analytics.report([{ subject: 'CARS', start: '2026-03-08T09:30:00Z', end: '2026-03-08T11:00:00Z' }], { h: stats.ctx(0, 'UTC') });
  assert.equal(t.byHour[9], 1800); assert.equal(t.byHour[10], 3600);
});

test('goalProgress: week/day windows in the user zone', () => {
  const ud = blankUserData(); ud.settings.timezone = LA; ud.settings.goals = { dailyMin: 60, weeklyMin: 600 };
  ud.sessions = [{ subject: 'CARS', start: '2026-11-02T07:30:00Z', end: '2026-11-02T08:30:00Z' }]; // Sun Nov 1 11:30 PM PST -> previous week
  const g = analytics.goalProgress(ud, new Date('2026-11-02T20:00:00Z')); // Mon Nov 2 noon LA
  assert.equal(g.day.done, 0); assert.equal(g.week.done, 0);
  ud.settings.timezone = 'UTC'; const u = analytics.goalProgress(ud, new Date('2026-11-02T20:00:00Z'));
  assert.equal(u.day.done, 3600); assert.equal(u.week.done, 3600);
});

test('CSV import reads wall-clock times in the user zone; export adds local date/time columns', () => {
  const r = csv.csvToSessions('date,start,end,subject\n2026-03-08,01:30,03:30,CARS\n2026-07-01,09:00,10:00,CARS\n', null, 'Imported', LA);
  assert.equal(r.sessions[0].start, '2026-03-08T09:30:00.000Z'); assert.equal(r.sessions[0].end, '2026-03-08T10:30:00.000Z'); // 1h real time across the gap
  assert.equal(r.sessions[1].start, '2026-07-01T16:00:00.000Z');
  const z = csv.csvToSessions('date,start,end,subject\n2026-07-01,09:00,10:00,CARS\n', null, 'Imported', 'Asia/Tokyo'); assert.equal(z.sessions[0].start, '2026-07-01T00:00:00.000Z');
  assert.equal(csv.toDate('2026-07-01T09:00:00Z', '', LA).toISOString(), '2026-07-01T09:00:00.000Z'); // explicit offsets win
  assert.equal(csv.toDate('2026-02-30', '10:00', LA), null);
  const out = csv.sessionsToCSV([{ subject: 'CARS', note: '', start: '2026-11-04T07:30:00.000Z', end: '2026-11-04T08:30:00.000Z' }], LA).split('\n')[1].split(',');
  assert.equal(out[0], '2026-11-03'); assert.equal(out[1], '2026-11-04T07:30:00.000Z'); assert.equal(out[6], '2026-11-03 23:30'); assert.equal(out[7], '2026-11-04 00:30'); assert.equal(out[8], LA);
});

test('study-mix window starts at midnight in the user zone', () => {
  assert.equal(mix.windowStart('day', new Date('2026-11-04T07:30:00Z'), 0, LA).toISOString(), '2026-11-03T08:00:00.000Z');
  assert.equal(mix.windowStart('week', new Date('2026-11-04T07:30:00Z'), 0, LA).toISOString(), '2026-11-02T08:00:00.000Z'); // Mon Nov 2 (PST)
  assert.equal(mix.windowStart('month', new Date('2026-11-04T07:30:00Z'), 0, LA).toISOString(), '2026-11-01T07:00:00.000Z'); // Nov 1 was still PDT at midnight
});

test('API: timezone set at signup, validated and editable in settings; stats follow it; sessions unchanged', async t => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-tz-')), 'data.json');
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`; let cookie = '';
  const c = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc && /^sid=/.test(sc)) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => null) }; };
  assert.equal((await c('/api/register', 'POST', { agree: true, birthYear: 1990, username: 'tzu', password: 'pass-12345', email: 't@example.com', timezone: 'Asia/Tokyo' })).status, 200);
  assert.equal((await c('/api/state')).body.settings.timezone, 'Asia/Tokyo');
  assert.equal((await c('/api/settings', 'POST', { timezone: 'Not/AZone' })).status, 400);
  assert.equal((await c('/api/settings', 'POST', { timezone: 'Pacific/Kiritimati' })).status, 200); // UTC+14
  const k1 = (await c('/api/stats')).body.todayKey; assert.equal(k1, TZ.key(Date.now(), 'Pacific/Kiritimati'));
  assert.equal((await c('/api/settings', 'POST', { timezone: 'Pacific/Pago_Pago' })).status, 200); // UTC-11
  assert.equal((await c('/api/stats')).body.todayKey, TZ.key(Date.now(), 'Pacific/Pago_Pago')); assert.notEqual(k1, TZ.key(Date.now(), 'Pacific/Pago_Pago'));
  const s = await c('/api/sessions', 'POST', { subject: 'CARS', start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T16:00:00.000Z' });
  await c('/api/settings', 'POST', { timezone: LA });
  const st = (await c('/api/state')).body; assert.equal(st.sessions[0].start, s.body.start || '2026-10-01T15:00:00.000Z'); assert.equal(st.settings.timezone, LA);
});
