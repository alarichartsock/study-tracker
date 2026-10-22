'use strict';
const pad = n => String(n).padStart(2, '0');
// dayStartHour lets night owls count 1am study toward the previous day (Athenify "day start time").
const shift = (d, h = 0) => new Date(+new Date(d) - h * 3600e3);
const dayKey = (d, h = 0) => { d = shift(d, h); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const secs = s => Math.max(0, (new Date(s.end) - new Date(s.start)) / 1000 - (+s.breakSec || 0));
const startOfDay = d => { d = new Date(d); d.setHours(0, 0, 0, 0); return d; };
const startOfWeek = d => { d = startOfDay(d); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }; // Monday
const startOfMonth = d => { d = startOfDay(d); d.setDate(1); return d; };
const addDays = (d, n) => { d = new Date(d); d.setDate(d.getDate() + n); return d; };
const isWeekend = d => [0, 6].includes(new Date(d).getDay());

function streaks(byDay, now = new Date(), h = 0) {
  let cur = 0, d = keyToDate(dayKey(now, h));
  if (!byDay[dayKey(d)]) d = addDays(d, -1); // today not studied yet doesn't break the streak
  while (byDay[dayKey(d)] > 0) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(byDay).filter(k => byDay[k] > 0).sort()) {
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1; best = Math.max(best, run); prev = keyToDate(k);
  }
  return { current: cur, best };
}

// Daily goal for a given date: weekend goal overrides when set.
function goalFor(date, g = {}) { const wk = isWeekend(date) && g.weekendDailyMin != null && g.weekendDailyMin !== '' ? +g.weekendDailyMin : +(g.dailyMin ?? 0); return wk * 60; }

function computeStats(sessions, { now = new Date(), goalMin = 360, goals, chartDays = 14, dayStartHour = 0 } = {}) {
  const h = dayStartHour, today = dayKey(now, h), tDate = keyToDate(today);
  const ws = startOfWeek(tDate), ms = startOfMonth(tDate), chartFrom = addDays(tDate, -(chartDays - 1));
  const byDay = {}, byDaySubject = {}, subj = { week: {}, month: {}, all: {} };
  let week = 0, month = 0, total = 0;
  for (const s of sessions) {
    const v = secs(s), k = dayKey(s.start, h), kd = keyToDate(k), name = s.subject || 'Other';
    byDay[k] = (byDay[k] || 0) + v; total += v; subj.all[name] = (subj.all[name] || 0) + v;
    if (kd >= ws) { week += v; subj.week[name] = (subj.week[name] || 0) + v; }
    if (kd >= ms) { month += v; subj.month[name] = (subj.month[name] || 0) + v; }
    if (kd >= chartFrom) { (byDaySubject[k] ||= {})[name] = (byDaySubject[k][name] || 0) + v; }
  }
  const st = streaks(byDay, now, h), goalSec = goals ? goalFor(tDate, goals) : goalMin * 60, todaySec = byDay[today] || 0;
  return { today: todaySec, week, month, total, sessions: sessions.length, streak: st.current, bestStreak: st.best,
    goalSec, goalPct: goalSec ? Math.min(100, (todaySec / goalSec) * 100) : 0, byDay, byDaySubject, bySubject: subj, todayKey: today };
}
module.exports = { dayKey, keyToDate, secs, startOfDay, startOfWeek, startOfMonth, addDays, isWeekend, streaks, goalFor, computeStats };
