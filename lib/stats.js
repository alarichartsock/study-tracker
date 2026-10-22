'use strict';
const pad = n => String(n).padStart(2, '0');
const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const secs = s => Math.max(0, (new Date(s.end) - new Date(s.start)) / 1000);
const startOfDay = d => { d = new Date(d); d.setHours(0, 0, 0, 0); return d; };
const startOfWeek = d => { d = startOfDay(d); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }; // Monday
const startOfMonth = d => { d = startOfDay(d); d.setDate(1); return d; };
const addDays = (d, n) => { d = new Date(d); d.setDate(d.getDate() + n); return d; };

function streaks(byDay, now = new Date()) {
  let cur = 0, d = startOfDay(now);
  if (!byDay[dayKey(d)]) d = addDays(d, -1); // today not studied yet doesn't break the streak
  while (byDay[dayKey(d)] > 0) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(byDay).filter(k => byDay[k] > 0).sort()) {
    const dt = new Date(k + 'T00:00:00');
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1; best = Math.max(best, run); prev = dt;
  }
  return { current: cur, best };
}

function computeStats(sessions, { now = new Date(), goalMin = 360, chartDays = 14 } = {}) {
  const today = dayKey(now), ws = startOfWeek(now), ms = startOfMonth(now), chartFrom = addDays(startOfDay(now), -(chartDays - 1));
  const byDay = {}, byDaySubject = {}, subj = { week: {}, month: {}, all: {} };
  let week = 0, month = 0, total = 0;
  for (const s of sessions) {
    const v = secs(s), st = new Date(s.start), k = dayKey(st), name = s.subject || 'Other';
    byDay[k] = (byDay[k] || 0) + v; total += v; subj.all[name] = (subj.all[name] || 0) + v;
    if (st >= ws) { week += v; subj.week[name] = (subj.week[name] || 0) + v; }
    if (st >= ms) { month += v; subj.month[name] = (subj.month[name] || 0) + v; }
    if (st >= chartFrom) { (byDaySubject[k] ||= {})[name] = (byDaySubject[k][name] || 0) + v; }
  }
  const st = streaks(byDay, now), goalSec = goalMin * 60, todaySec = byDay[today] || 0;
  return { today: todaySec, week, month, total, sessions: sessions.length, streak: st.current, bestStreak: st.best,
    goalSec, goalPct: goalSec ? Math.min(100, (todaySec / goalSec) * 100) : 0, byDay, byDaySubject, bySubject: subj, todayKey: today };
}
module.exports = { dayKey, secs, startOfDay, startOfWeek, startOfMonth, addDays, streaks, computeStats };
