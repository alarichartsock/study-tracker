'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../public/mix.js');
const S = (subject, d, h, mins, extra = {}) => { const s = new Date(2026, 9, d, h); return { subject, start: s.toISOString(), end: new Date(+s + mins * 60e3).toISOString(), ...extra }; };
const now = new Date(2026, 9, 22, 20); // Thu Oct 22 2026

test('studyMix: shares per window (day / week from Monday / month)', () => {
  const ss = [S('CARS', 22, 9, 60), S('Bio', 22, 13, 180), S('CARS', 19, 9, 120), S('Psych', 12, 9, 60), S('Chem', 1, 9, 30, { breakSec: 600 }), S('Old', 1, 9, 60).subject && S('Old', 30, 9, 60)];
  const day = M.studyMix(ss, { win: 'day', now }); assert.deepEqual(day.parts.map(p => [p.subject, p.share]), [['Bio', 0.75], ['CARS', 0.25]]);
  const week = M.studyMix(ss, { win: 'week', now }); assert.deepEqual(week.parts.map(p => p.subject), ['Bio', 'CARS']); assert.equal(week.total, 360 * 60); assert.equal(week.parts[1].share, 0.5);
  const month = M.studyMix(ss, { win: 'month', now }); assert.deepEqual(month.parts.map(p => p.subject), ['Bio', 'CARS', 'Psych', 'Chem']); assert.equal(month.parts[3].sec, 20 * 60, 'breaks are excluded');
  assert.ok(Math.abs(month.parts.reduce((t, p) => t + p.share, 0) - 1) < 1e-9);
  assert.deepEqual(M.studyMix([], { now }).parts, []);
});
test('studyMix: at most 5 parts, the rest folded into the biggest; dayStartHour shifts the window', () => {
  const ss = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x, i) => S(x, 21, 9, 100 - i * 10));
  const m = M.studyMix(ss, { win: 'week', now }); assert.equal(m.parts.length, 5); assert.equal(m.others, (50 + 40) * 60); assert.equal(m.parts[0].sec, (100 + 50 + 40) * 60);
  const late = [S('CARS', 22, 2, 60)]; assert.equal(M.studyMix(late, { win: 'day', now, h: 4 }).parts.length, 0, '2am counts as the previous day when the day starts at 4am');
});
test('blobs: one per part sized by share; single subject gets a tinted default', () => {
  const b = M.blobs([{ subject: 'A', share: 0.75 }, { subject: 'B', share: 0.25 }], s => s === 'A' ? '#ff0000' : '#00ff00');
  assert.equal(b.length, 2); assert.equal(b[0].color, '#ff0000'); assert.ok(b[0].size > b[1].size);
  const one = M.blobs([{ subject: 'A', share: 1 }], () => '#123456'); assert.equal(one.length, 3); assert.ok(one.every(x => x.color.includes('#123456')));
  assert.deepEqual(M.blobs([], () => '#000'), []);
});
test('cleanBackground: whitelist validation', () => {
  assert.deepEqual(M.cleanBackground({}), { mode: 'auto', window: 'week', motion: true });
  assert.deepEqual(M.cleanBackground({ mode: 'static', motion: false }, { mode: 'auto', window: 'month', motion: true }), { mode: 'static', window: 'month', motion: false });
  for (const bad of [{ mode: 'rainbow' }, { window: 'year' }, { motion: 'yes' }, { mode: '<script>' }]) assert.throws(() => M.cleanBackground(bad));
});
