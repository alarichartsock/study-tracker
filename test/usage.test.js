'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const usage = require('../lib/usage');
const NOW = new Date(2026, 9, 30, 18);
const sess = (daysAgo, mins, subject = 'CARS', mode = 'stopwatch') => { const s = new Date(2026, 9, 30 - daysAgo, 10); return { subject, mode, start: s.toISOString(), end: new Date(+s + mins * 60e3).toISOString() }; };

test('touch records lastSeen and one entry per day, capped', () => {
  const u = {}; assert.equal(usage.touch(u, NOW), true); assert.equal(usage.touch(u, new Date(+NOW + 60e3)), false);
  assert.equal(u.activeDays.length, 1); assert.ok(u.lastSeen);
  for (let i = 1; i < 200; i++) usage.touch(u, new Date(+NOW + i * 864e5)); assert.equal(u.activeDays.length, usage.KEEP_DAYS);
  assert.equal(usage.touch(null), false);
});
test('perUser computes hours, windows, streaks, goals, features, plan', () => {
  const u = { id: 2, username: 'a', created: new Date(2026, 9, 1).toISOString(), attribution: { utm_source: 'ig', utm_medium: 'paid' }, signupLang: 'en-US', activeDays: ['2026-10-29'] };
  const ud = { sessions: [sess(0, 60), sess(1, 30, 'Bio', 'manual'), sess(2, 90), sess(20, 120, 'Bio')], exams: [{}], settings: { goals: { dailyMin: 60 }, lang: 'es' }, subjectMeta: { CARS: { weeklyGoalMin: 300 } }, flags: { tinker: 1 } };
  const r = usage.perUser(u, ud, { now: NOW, bstat: () => ({ enabled: true, trial: true, trialEnds: '2026-11-01T00:00:00Z', trialDaysLeft: 2 }), achievements: () => ({ global: [{ earned: true }, { earned: false }], personal: [{ earned: true }] }) });
  assert.equal(r.sessions, 4); assert.equal(r.hours, 5); assert.equal(r.hours7, 3); assert.equal(r.hours30, 5); assert.equal(r.avgSessionMin, 75);
  assert.equal(r.days7, 3); assert.equal(r.days30, 4); assert.equal(r.streak, 3); assert.equal(r.bestStreak, 3);
  assert.equal(r.goalsSet, 2); assert.equal(r.goalDaysMet, 3); assert.equal(r.trophies, 2); assert.equal(r.plan, 'trial'); assert.equal(r.source, 'ig / paid');
  assert.equal(r.topSubjects[0].name, 'CARS'); assert.equal(r.spark.length, 30); assert.equal(r.spark[29], 60);
  assert.deepEqual([r.features.timer, r.features.manual, r.features.exams, r.features.settings, r.features.lang], [3, 1, 1, true, 'es']);
  assert.ok(r.lastActive);
  const e = usage.perUser({ id: 3, username: 'b' }, undefined, { now: NOW }); assert.equal(e.sessions, 0); assert.equal(e.lastActive, null); assert.equal(e.source, null);
});
test('summary: DAU/WAU/MAU, stickiness, retention, cohorts, activation; admin excluded', () => {
  const mk = (id, created, days, extra = {}) => ({ id, admin: false, created: new Date(2026, 9, 30 - created).toISOString(), activeDays: days, sessions: days.length, hours: days.length, hours30: days.length, days30: days.length, plan: 'trial', paid: false, features: { timer: days.length, manual: 0 }, ...extra });
  const rows = [mk(1, 40, ['2026-10-30'], { admin: true }), mk(2, 10, ['2026-10-20', '2026-10-21', '2026-10-30']), mk(3, 3, ['2026-10-27']), mk(4, 0, [])];
  const s = usage.summary(rows, NOW);
  assert.equal(s.users, 3); assert.equal(s.dau, 1); assert.equal(s.wau, 2); assert.equal(s.mau, 2); assert.equal(s.dauMau, 50);
  assert.equal(s.daily.length, 30); assert.equal(s.daily[29][1], 1); assert.equal(s.activated, 2); assert.equal(s.activationRate, 66.7);
  assert.equal(s.retention.d1.of, 2); assert.equal(s.retention.d1.pct, 50); assert.equal(s.retention.d7.of, 1); assert.equal(s.retention.d30, null);
  assert.ok(s.cohorts.length >= 1); assert.equal(s.features.timer, 2);
});
test('/api/admin/usage is admin-only and API use records activity', async () => {
  const { createApp } = require('../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-usage-')), server = createApp({ dataFile: path.join(dir, 'data.json'), quiet: true, minSessionSec: 0, gaApiSecret: '' });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let ck = ''; return async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { Cookie: ck } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, body: await r.json() }; }; };
  try {
    const a = client(), b = client();
    assert.equal((await a('/api/register', 'POST', { username: 'admin1', password: 'pass-12345', agree: true, birthYear: 1990 })).status, 200);
    assert.equal((await b('/api/register', 'POST', { username: 'user2', password: 'pass-12345', agree: true, birthYear: 1990 })).status, 200);
    await b('/api/me');
    assert.equal((await b('/api/admin/usage')).status, 403);
    const r = await a('/api/admin/usage'); assert.equal(r.status, 200);
    const u2 = r.body.users.find(x => x.username === 'user2'); assert.ok(u2.lastSeen); assert.equal(u2.days7, 1);
    assert.equal(r.body.summary.users, 1); assert.equal(r.body.summary.dau, 1); assert.ok(!('salt' in u2) && !('hash' in u2));
  } finally { await new Promise(r => server.close(r)); }
});
