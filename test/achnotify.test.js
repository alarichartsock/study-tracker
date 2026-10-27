'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), N = require('../lib/achnotify'), analytics = require('../lib/analytics');
const mk = () => ({ sessions: [], exams: [], tasks: [], plan: {}, subjects: ['Bio'], subjectMeta: { Bio: { color: '#00ff00' } }, activities: ['Reading'], settings: { medals: {}, goals: {}, dailyGoalMin: 0, dayStartHour: 0 }, flags: {} });
const sess = (d, h) => ({ subject: 'Bio', activity: 'Reading', start: d + 'T10:00:00Z', end: d + 'T' + String(10 + h).padStart(2, '0') + ':00:00Z', breakSec: 0 });
test('first run marks everything already earned as notified (no flood)', () => {
  const ud = mk(); ud.sessions.push(sess('2026-10-01', 2), sess('2026-10-02', 2)); const A = analytics.achievements(ud);
  assert.ok(N.earnedIds(A).length > 0); const r = N.pending(ud, A); assert.equal(r.init, true); assert.deepEqual(r.ids, []);
  assert.deepEqual(N.pending(ud, A).ids, [], 'still nothing new on the next poll');
});
test('newly earned achievements show up once, then are marked seen', () => {
  const ud = mk(); N.pending(ud, analytics.achievements(ud));
  ud.sessions.push(sess('2026-10-01', 2)); const A = analytics.achievements(ud), r = N.pending(ud, A);
  assert.equal(r.init, false); assert.ok(r.ids.length >= 1, 'first session unlocks something');
  assert.equal(N.markSeen(ud, A, [...r.ids, 'bogus-id']), r.ids.length, 'unknown/unearned ids are ignored');
  assert.deepEqual(N.pending(ud, A).ids, []);
});
