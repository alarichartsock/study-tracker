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
test('achievements', () => {
  const ud = blankUserData(); ud.sessions = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'].map((x, i) => S(10, 19 + i, 9, 200, x)); ud.sessions[0].mode = 'pomodoro';
  const got = Object.fromEntries(a.achievements(ud).map(x => [x.id, x.earned]));
  assert.equal(got.first, true); assert.equal(got.h10, true); assert.equal(got.s3, true); assert.equal(got.s7, false); assert.equal(got.marathon, true); assert.equal(got.allsec, true); assert.equal(got.silver ?? got.bronze, true); assert.equal(got.pomo, false);
});
