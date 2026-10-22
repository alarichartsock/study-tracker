'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const st = require('../lib/stats');
const sess = (d, h, mins, subject = 'CARS') => { const s = new Date(2026, 9, d, h); return { subject, start: s.toISOString(), end: new Date(+s + mins * 60e3).toISOString() }; };
const NOW = new Date(2026, 9, 22, 18); // Thu Oct 22 2026

test('dayKey / week / month boundaries', () => {
  assert.equal(st.dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(st.dayKey(st.startOfWeek(NOW)), '2026-10-19'); // Monday
  assert.equal(st.dayKey(st.startOfWeek(new Date(2026, 9, 25))), '2026-10-19'); // Sunday belongs to prior week
  assert.equal(st.dayKey(st.startOfMonth(NOW)), '2026-10-01');
});
test('totals today/week/month and per subject', () => {
  const s = [sess(22, 9, 60), sess(22, 11, 30, 'Bio/Biochem'), sess(20, 9, 120), sess(15, 9, 45, 'Psych/Soc'), sess(2, 9, 15), { subject: 'X', start: new Date(2026, 8, 30, 9).toISOString(), end: new Date(2026, 8, 30, 10).toISOString() }];
  const r = st.computeStats(s, { now: NOW, goalMin: 180 });
  assert.equal(r.today, 90 * 60); assert.equal(r.week, 210 * 60); assert.equal(r.month, (90 + 120 + 45 + 15) * 60); assert.equal(r.total, (270 + 60) * 60);
  assert.equal(r.bySubject.week.CARS, 180 * 60); assert.equal(r.bySubject.week['Bio/Biochem'], 30 * 60); assert.equal(r.bySubject.month['Psych/Soc'], 45 * 60);
  assert.equal(r.goalSec, 180 * 60); assert.equal(r.goalPct, 50); assert.equal(r.sessions, 6);
  assert.ok(r.byDaySubject['2026-10-15']); assert.equal(r.byDaySubject['2026-10-02'], undefined); // outside 14-day window
});
test('streak counts back from today, or yesterday if nothing today yet', () => {
  const s = [sess(22, 9, 10), sess(21, 9, 10), sess(20, 9, 10), sess(18, 9, 10), sess(17, 9, 10), sess(16, 9, 10), sess(15, 9, 10)];
  const r = st.computeStats(s, { now: NOW }); assert.equal(r.streak, 3); assert.equal(r.bestStreak, 4);
  assert.equal(st.computeStats(s.slice(1), { now: NOW }).streak, 2);
  assert.equal(st.computeStats(s.slice(2), { now: NOW }).streak, 0);
  assert.equal(st.computeStats([], { now: NOW }).streak, 0);
});
test('goalPct caps at 100 and handles zero goal; negative durations ignored', () => {
  assert.equal(st.computeStats([sess(22, 1, 600)], { now: NOW, goalMin: 60 }).goalPct, 100);
  assert.equal(st.computeStats([sess(22, 1, 600)], { now: NOW, goalMin: 0 }).goalPct, 0);
  assert.equal(st.secs({ start: '2026-10-22T10:00:00Z', end: '2026-10-22T09:00:00Z' }), 0);
});
