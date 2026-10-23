'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const a = require('../lib/analytics'), st = require('../lib/stats');
const { blankUserData } = require('../lib/store');
const S = (m, d, h, mins, subject = 'CARS', extra = {}) => { const s = new Date(2026, m - 1, d, h); return { subject, start: s.toISOString(), end: new Date(+s + mins * 60e3).toISOString(), ...extra }; };

test('report: totals, averages, best day/week/month, weekday & hour buckets', () => {
  const list = [S(10, 19, 9, 120), S(10, 20, 23, 90, 'Bio/Biochem', { activity: 'Flashcards', focus: 4 }), S(10, 21, 14, 30, 'CARS', { focus: 2 }), S(9, 1, 9, 60)];
  const r = a.report(list, { from: '2026-10-19', to: '2026-10-25' });
  assert.equal(r.count, 3); assert.equal(r.total, 240 * 60); assert.equal(r.spanDays, 7); assert.equal(r.activeDays, 3);
  assert.equal(r.avgPerDay, 240 * 60 / 7); assert.equal(r.avgSession, 80 * 60); assert.equal(r.avgFocus, 3);
  assert.deepEqual(r.bestDay, ['2026-10-19', 7200]); assert.equal(r.byWeekday[0], 7200); // Monday
  assert.equal(r.byHour[23], 3600); assert.equal(r.byHour[0], 1800); // 23:00-00:30 split across hours
  assert.equal(r.byActivity.Flashcards, 5400); assert.equal(r.byActivity.Unspecified, 9000);
  assert.equal(r.matrix.activitySubject.Flashcards['Bio/Biochem'], 5400); assert.ok(r.matrix.subjectWeek.CARS['2026-W43']);
  assert.equal(r.streak, 3);
});
test('breaks are excluded from study time', () => {
  assert.equal(st.secs(S(10, 1, 9, 60, 'CARS', { breakSec: 600 })), 3000);
});
test('compare against previous equal-length period', () => {
  const c = a.compare([S(10, 19, 9, 120), S(10, 12, 9, 60)], '2026-10-19', '2026-10-25');
  assert.equal(c.previous.from, '2026-10-12'); assert.equal(c.previous.to, '2026-10-18'); assert.equal(c.previous.total, 3600); assert.equal(c.change, 1);
});
test('isoWeek', () => { assert.equal(a.isoWeek(new Date(2026, 0, 1)), '2026-W01'); assert.equal(a.isoWeek(new Date(2025, 11, 29)), '2026-W01'); assert.equal(a.isoWeek(new Date(2026, 9, 22)), '2026-W43'); });
test('medals by thresholds', () => {
  const th = { bronze: 60, silver: 180, gold: 300, platinum: 480 };
  assert.equal(a.medalFor(59 * 60, th), null); assert.equal(a.medalFor(60 * 60, th), 'bronze'); assert.equal(a.medalFor(300 * 60, th), 'gold'); assert.equal(a.medalFor(600 * 60, th), 'platinum');
  const r = a.report([S(10, 1, 9, 200), S(10, 2, 9, 500)], { medals: th }); assert.deepEqual(r.medals, { platinum: 1, gold: 0, silver: 1, bronze: 0 });
});
test('pace & forecast', () => {
  const now = new Date(2026, 9, 22, 12); // Thu, day 4 of Mon-Sun week
  const p = a.pace(4 * 3600, 20 * 3600, '2026-10-19', '2026-10-25', now);
  assert.equal(p.daysLeft, 4); assert.equal(p.remainingSec, 16 * 3600); assert.equal(p.perDaySec, 4 * 3600); assert.equal(p.forecastSec, 7 * 3600); assert.equal(p.onTrack, false);
  assert.equal(a.pace(10, 5, '2026-10-01', '2026-10-05', now).daysLeft, 0);
  assert.equal(a.pace(0, 3600, '2026-11-01', '2026-11-10', now).daysLeft, 10);
});
test('goalProgress: weekend goal, weekly/monthly/term, per-subject, planned day', () => {
  const ud = blankUserData(); ud.settings.goals = { dailyMin: 300, weekendDailyMin: 120, weeklyMin: 1200, monthlyMin: 5000, termMin: 20000 };
  ud.settings.term = { start: '2026-09-01', end: '2026-12-31' }; ud.subjectMeta = { CARS: { weeklyGoalMin: 300 } };
  ud.sessions = [S(10, 22, 9, 60), S(10, 20, 9, 60, 'Bio/Biochem')];
  const sat = a.goalProgress(ud, new Date(2026, 9, 24, 12)); assert.equal(sat.day.goal, 120 * 60);
  const g = a.goalProgress(ud, new Date(2026, 9, 22, 12));
  assert.equal(g.day.goal, 300 * 60); assert.equal(g.day.done, 3600); assert.equal(g.week.done, 7200); assert.equal(g.week.goal, 1200 * 60);
  assert.ok(g.month && g.term); assert.equal(g.subjects.CARS.done, 3600);
  ud.plan = { '2026-10-22': 90 }; assert.equal(a.goalProgress(ud, new Date(2026, 9, 22, 12)).day.goal, 90 * 60);
});
test('dayStartHour shifts late-night study to the previous day', () => {
  const s = [S(10, 22, 1, 60)]; // 1am Oct 22
  assert.ok(st.computeStats(s, { now: new Date(2026, 9, 22, 1, 30), dayStartHour: 3 }).byDay['2026-10-21']);
  assert.ok(st.computeStats(s, { now: new Date(2026, 9, 22, 1, 30) }).byDay['2026-10-22']);
});
test('cumulative series and duration suggestion', () => {
  assert.deepEqual(a.cumulative([S(10, 2, 9, 60), S(10, 1, 9, 30)]).map(x => x[1]), [1800, 5400]);
  assert.equal(a.suggestDuration([S(10, 1, 9, 50), S(10, 2, 9, 52), S(10, 3, 9, 90)]), 3000);
  assert.equal(a.suggestDuration([], 'CARS'), null);
});
test('achievements: shape, categories, renamed set, no idiosyncratic badges', () => {
  const ud = blankUserData(); ud.sessions = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'].map((x, i) => S(10, 19 + i, 9, 200, x, { activity: i ? 'Anki' : 'UBook' })); ud.sessions[0].mode = 'pomodoro';
  const R = a.achievements(ud); assert.ok(Array.isArray(R.global) && Array.isArray(R.personal) && Array.isArray(R.categories));
  const cats = new Set(R.categories.map(c => c.id)); assert.ok(R.global.every(x => cats.has(x.cat)), 'every global badge has a known category');
  const got = Object.fromEntries(R.global.map(x => [x.id, x.earned]));
  assert.equal(got.first, true); assert.equal(got.h10, true); assert.equal(got.s3, true); assert.equal(got.s7, false); assert.equal(got.marathon, true); assert.equal(got.timer1, true); assert.equal(got.pomo, false); assert.equal(got.subj3day, false);
  assert.equal(got.allsec, undefined, 'MCAT-section badge removed');
  assert.ok(!R.global.some(x => /anki|ubook/i.test(x.name + x.id + x.desc)), 'no activity-specific global badges');
  assert.equal(new Set(R.global.map(x => x.id)).size, R.global.length, 'unique ids');
  for (const bad of ['First Steps', 'Time Keeper', 'Explorer', 'Week Warrior', 'Polymath', 'Deep Focus', 'Carbon Copy']) assert.ok(!R.global.some(x => x.name === bad), bad);
});
test('achievements: personal badges per activity and subject', () => {
  const ud = blankUserData(); ud.sessions = [S(10, 12, 9, 90, 'CARS', { activity: 'Anki' }), S(10, 13, 9, 30, 'CARS', { activity: 'UBook' }), S(10, 14, 9, 30, 'Bio/Biochem')];
  const P = a.achievements(ud).personal, keys = k => [...new Set(P.filter(x => x.kind === k).map(x => x.key))].sort();
  assert.deepEqual(keys('activity'), ['Anki', 'UBook']); assert.deepEqual(keys('subject'), ['Bio/Biochem', 'CARS']);
  const by = Object.fromEntries(P.map(x => [x.id, x]));
  assert.equal(by['activity:anki:h1'].earned, true); assert.equal(by['activity:ubook:h1'].earned, false); assert.ok(Math.abs(by['activity:ubook:h1'].progress - 0.5) < 1e-9);
  assert.equal(by['subject:cars:h1'].earned, true); assert.equal(by['activity:anki:n10'].value, 1);
  assert.equal(P.filter(x => x.key === 'Anki').length, 8, '5 hour tiers + 3 session tiers');
  assert.equal(new Set(P.map(x => x.id)).size, P.length);
});
test('achievements: tiers, progress and goal badges', () => {
  const ud = blankUserData(); ud.settings.goals.dailyMin = 60;
  ud.sessions = [S(10, 12, 9, 70, 'CARS', { activity: 'Flashcards' }), S(10, 13, 9, 70), S(10, 14, 9, 130), S(10, 15, 9, 70), S(10, 16, 5, 30), S(10, 17, 9, 70), S(10, 18, 9, 70)];
  const A = a.achievements(ud).global, by = Object.fromEntries(A.map(x => [x.id, x]));
  assert.ok(A.length >= 60);
  for (const id of ['first', 'h1', 's3', 's7', 'sess1h', 'sess2h', 'day2', 'week7', 'weekend', 'early', 'g3', 'week1', 'goal200']) assert.equal(by[id].earned, true, id);
  for (const id of ['h10', 's14', 'marathon', 'n10', 'day4', 'g7', 'month1', 'early7']) assert.equal(by[id].earned, false, id);
  assert.equal(by.n10.value, 7); assert.ok(Math.abs(by.n10.progress - 0.7) < 1e-9);
  assert.equal(by.g3.value, 3); assert.equal(by.g7.value, 4, 'Oct 16 (30 min) breaks the goal streak');
});
test('achievements: earnedCounts aggregates across users', () => {
  const u1 = blankUserData(), u2 = blankUserData(); u1.sessions = [S(10, 12, 9, 70)];
  const E = a.earnedCounts([[u1, 0], [u2, 0]]); assert.equal(E.users, 2); assert.equal(E.counts.first, 1); assert.equal(E.counts.h10, undefined);
  assert.deepEqual(Object.keys(E).sort(), ['counts', 'users']);
});
test('achievements: empty user has locked badges with zero progress and no goal badges without a goal', () => {
  const ud = blankUserData(); ud.settings.goals.dailyMin = 0; const R = a.achievements(ud);
  assert.ok(R.global.every(x => !x.earned && x.progress === 0)); assert.ok(!R.global.some(x => /^g\d+$/.test(x.id))); assert.equal(R.personal.length, 0);
});
