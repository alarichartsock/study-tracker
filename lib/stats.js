'use strict';
const pad = n => String(n).padStart(2, '0');
// dayStartHour lets night owls count 1am study toward the previous day (Athenify "day start time").
const TZ = require('../public/tz.js');
const shift = (d, h = 0) => new Date(+new Date(d) - h * 3600e3);
// Day context: the user's dayStartHour plus IANA time zone. It is a Number object (valueOf = hour), so existing
// arithmetic on `h` keeps working; functions that turn an INSTANT into a day/hour read `.tz` from it.
// Calendar-date helpers (keyToDate/addDays/startOfWeek...) never take a context: they work on plain calendar dates.
const ctx = (h = 0, tz = TZ.DEFAULT) => Object.assign(new Number(+h || 0), { tz: TZ.valid(tz) ? tz : TZ.DEFAULT }); // eslint-disable-line no-new-wrappers
const ctxOf = settings => ctx(settings && settings.dayStartHour, settings && settings.timezone);
const tzOf = h => (h && h.tz) || null;
// Day key of an instant: in the context's zone when given, else the process zone (calendar dates, legacy callers).
const dayKey = (d, h = 0) => { const z = tzOf(h); if (z) return TZ.key(d, z, +h); d = shift(d, +h); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hourOf = (t, h) => { const z = tzOf(h); return z ? TZ.parts(t, z).h : new Date(t).getHours(); };
const monthOf = (t, h) => { const z = tzOf(h); return z ? TZ.parts(t, z).mo - 1 : new Date(t).getMonth(); };
const minuteOf = (t, h) => { const z = tzOf(h); if (z) { const p = TZ.parts(t, z); return p.mi * 60 + p.s; } const d = new Date(t); return d.getMinutes() * 60 + d.getSeconds(); };
// Instant at which calendar day `k` starts for this context (midnight in the zone, plus dayStartHour).
const dayStart = (k, h = 0) => { const z = tzOf(h); return z ? new Date(+TZ.toUtc(k, '00:00', z) + (+h) * 3600e3) : new Date(+keyToDate(k) + (+h) * 3600e3); };
function keyToDate(k) { return keyToDate_(k); }
const keyToDate_ = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
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
module.exports = { TZ, ctx, ctxOf, hourOf, monthOf, minuteOf, dayStart, dayKey, keyToDate, secs, startOfDay, startOfWeek, startOfMonth, addDays, isWeekend, streaks, goalFor, computeStats };
