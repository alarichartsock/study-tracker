'use strict';
// Reports, data-room matrices, pace/forecast, medals, achievements. Pure functions.
const { dayKey, keyToDate, secs, startOfWeek, startOfMonth, addDays, streaks, goalFor } = require('./stats');
const DAY = 864e5;
const inRange = (k, from, to) => (!from || k >= from) && (!to || k <= to);
const daysBetween = (from, to) => Math.round((keyToDate(to) - keyToDate(from)) / DAY) + 1;
const isoWeek = d => { d = new Date(d); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4);
  return `${d.getFullYear()}-W${String(1 + Math.round(((d - w1) / DAY - 3 + ((w1.getDay() + 6) % 7)) / 7)).padStart(2, '0')}`; };

const MEDALS = ['platinum', 'gold', 'silver', 'bronze'];
function medalFor(sec, th = {}) { for (const m of MEDALS) if (th[m] && sec >= th[m] * 60) return m; return null; }

function report(sessions, { from, to, h = 0, medals = {} } = {}) {
  const list = sessions.filter(s => inRange(dayKey(s.start, h), from, to));
  const byDay = {}, bySubject = {}, byActivity = {}, byWeekday = Array(7).fill(0), byHour = Array(24).fill(0);
  const actSubj = {}, subjWeek = {}, byWeek = {}, byMonth = {};
  let total = 0, breakSec = 0, focusSum = 0, focusN = 0;
  for (const s of list) {
    const v = secs(s), k = dayKey(s.start, h), st = new Date(s.start), subj = s.subject || 'Other', act = s.activity || 'Unspecified';
    total += v; breakSec += +s.breakSec || 0; byDay[k] = (byDay[k] || 0) + v;
    bySubject[subj] = (bySubject[subj] || 0) + v; byActivity[act] = (byActivity[act] || 0) + v;
    byWeekday[(keyToDate(k).getDay() + 6) % 7] += v; // Mon=0
    // spread across clock hours for time-of-day analysis
    let t = +st; const end = +st + v * 1000;
    while (t < end) { const hr = new Date(t), next = Math.min(end, new Date(hr).setMinutes(60, 0, 0)); byHour[hr.getHours()] += (next - t) / 1000; t = next; }
    (actSubj[act] ||= {})[subj] = (actSubj[act][subj] || 0) + v;
    const wk = isoWeek(keyToDate(k)); (subjWeek[subj] ||= {})[wk] = (subjWeek[subj][wk] || 0) + v; byWeek[wk] = (byWeek[wk] || 0) + v;
    const mo = k.slice(0, 7); byMonth[mo] = (byMonth[mo] || 0) + v;
    if (s.focus) { focusSum += +s.focus; focusN++; }
  }
  const keys = Object.keys(byDay).sort();
  const f = from || keys[0], t = to || keys[keys.length - 1];
  const span = f && t ? daysBetween(f, t) : 0, activeDays = keys.filter(k => byDay[k] > 0).length;
  const best = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0] || null;
  const medalCount = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  for (const k of keys) { const m = medalFor(byDay[k], medals); if (m) medalCount[m]++; }
  return {
    from: f || null, to: t || null, total, count: list.length, breakSec, activeDays, spanDays: span,
    avgPerDay: span ? total / span : 0, avgPerActiveDay: activeDays ? total / activeDays : 0, avgSession: list.length ? total / list.length : 0,
    longestSession: list.reduce((m, s) => Math.max(m, secs(s)), 0), avgFocus: focusN ? focusSum / focusN : null,
    bestDay: best(byDay), bestWeek: best(byWeek), bestMonth: best(byMonth), streak: streaks(byDay, t ? keyToDate(t) : new Date()).best,
    byDay, bySubject, byActivity, byWeekday, byHour, byWeek, byMonth, matrix: { activitySubject: actSubj, subjectWeek: subjWeek }, medals: medalCount,
  };
}

// Compare [from,to] with the equally long period right before it.
function compare(sessions, from, to, opts = {}) {
  const n = daysBetween(from, to), pTo = dayKey(addDays(keyToDate(from), -1)), pFrom = dayKey(addDays(keyToDate(from), -n));
  const cur = report(sessions, { ...opts, from, to }), prev = report(sessions, { ...opts, from: pFrom, to: pTo });
  return { current: cur, previous: { from: pFrom, to: pTo, total: prev.total, count: prev.count, activeDays: prev.activeDays },
    change: prev.total ? (cur.total - prev.total) / prev.total : null };
}

// Pace: how much per remaining day is needed to hit a goal in [from,to], and a linear forecast.
function pace(doneSec, goalSec, from, to, now = new Date(), h = 0) {
  const today = dayKey(now, h);
  if (today > to) return { remainingSec: Math.max(0, goalSec - doneSec), daysLeft: 0, perDaySec: 0, forecastSec: doneSec, onTrack: doneSec >= goalSec };
  const elapsed = today < from ? 0 : daysBetween(from, today), total = daysBetween(from, to), daysLeft = total - elapsed + (today >= from ? 1 : 0);
  // include today in remaining days (today may not be finished)
  const remaining = Math.max(0, goalSec - doneSec), forecast = elapsed ? (doneSec / elapsed) * total : 0;
  return { remainingSec: remaining, daysLeft, perDaySec: daysLeft ? remaining / daysLeft : remaining, forecastSec: forecast, onTrack: forecast >= goalSec || remaining === 0 };
}

function goalProgress(ud, now = new Date()) {
  const h = +ud.settings.dayStartHour || 0, g = ud.settings.goals || {}, tk = dayKey(now, h), td = keyToDate(tk);
  const ws = dayKey(startOfWeek(td)), we = dayKey(addDays(startOfWeek(td), 6)), ms = dayKey(startOfMonth(td));
  const me = dayKey(addDays(startOfMonth(addDays(startOfMonth(td), 32)), -1));
  const sum = (f, t, subj) => ud.sessions.reduce((a, s) => { const k = dayKey(s.start, h); return inRange(k, f, t) && (!subj || s.subject === subj) ? a + secs(s) : a; }, 0);
  const out = { day: { done: sum(tk, tk), goal: goalFor(td, g) } };
  if (g.weeklyMin) out.week = { done: sum(ws, we), goal: g.weeklyMin * 60, ...pace(sum(ws, we), g.weeklyMin * 60, ws, we, now, h) };
  if (g.monthlyMin) out.month = { done: sum(ms, me), goal: g.monthlyMin * 60, ...pace(sum(ms, me), g.monthlyMin * 60, ms, me, now, h) };
  const term = ud.settings.term || {};
  if (term.start && term.end && g.termMin) out.term = { done: sum(term.start, term.end), goal: g.termMin * 60, ...pace(sum(term.start, term.end), g.termMin * 60, term.start, term.end, now, h) };
  out.subjects = {};
  for (const [name, m] of Object.entries(ud.subjectMeta || {})) if (m.weeklyGoalMin) out.subjects[name] = { done: sum(ws, we, name), goal: m.weeklyGoalMin * 60 };
  // planned minutes for today from the calendar plan override the default daily goal
  if (ud.plan && ud.plan[tk] != null) out.day.goal = ud.plan[tk] * 60;
  return out;
}

// Cumulative "share price" series per day.
function cumulative(sessions, h = 0) {
  const byDay = {}; for (const s of sessions) { const k = dayKey(s.start, h); byDay[k] = (byDay[k] || 0) + secs(s); }
  let acc = 0; return Object.keys(byDay).sort().map(k => [k, (acc += byDay[k])]);
}

// Suggested timer length: median of recent session lengths for the subject (SmartTimer-like).
function suggestDuration(sessions, subject) {
  const xs = sessions.filter(s => !subject || s.subject === subject).slice(-30).map(secs).filter(v => v >= 300).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  return Math.max(300, Math.round(m / 300) * 300); // nearest 5 min
}

const ACHIEVEMENTS = [
  ['first', 'First step', 'Log your first study session', a => a.count >= 1],
  ['h10', 'Getting serious', '10 hours studied', a => a.total >= 10 * 3600],
  ['h50', 'Half century', '50 hours studied', a => a.total >= 50 * 3600],
  ['h100', 'Centurion', '100 hours studied', a => a.total >= 100 * 3600],
  ['h300', 'MCAT ready', '300 hours studied', a => a.total >= 300 * 3600],
  ['s3', 'Warming up', '3-day streak', a => a.bestStreak >= 3],
  ['s7', 'One week strong', '7-day streak', a => a.bestStreak >= 7],
  ['s30', 'Unbreakable', '30-day streak', a => a.bestStreak >= 30],
  ['marathon', 'Marathon', 'A single session of 3+ hours', a => a.longest >= 3 * 3600],
  ['day8', 'Full-length day', '8+ hours in one day', a => a.bestDay >= 8 * 3600],
  ['allsec', 'Well rounded', 'Study all four MCAT sections in one week', a => a.allSectionsWeek],
  ['bronze', 'On the podium', 'Earn a bronze medal', a => a.medals.bronze + a.medals.silver + a.medals.gold + a.medals.platinum > 0],
  ['gold', 'Gold standard', 'Earn a gold medal', a => a.medals.gold + a.medals.platinum > 0],
  ['plat', 'Platinum', 'Earn a platinum medal', a => a.medals.platinum > 0],
  ['early', 'Early bird', 'Start a session before 7am', a => a.early],
  ['night', 'Night owl', 'Study after 11pm', a => a.night],
  ['pomo', 'Tomato farmer', 'Complete 25 Pomodoro sessions', a => a.pomodoros >= 25],
  ['tasks10', 'Checklist', 'Complete 10 tasks', a => a.tasksDone >= 10],
];
const SECTIONS = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'];
function achievements(ud, h = 0) {
  const r = report(ud.sessions, { h, medals: ud.settings.medals });
  const weeks = {}; for (const s of ud.sessions) { (weeks[isoWeek(keyToDate(dayKey(s.start, h)))] ||= new Set()).add(s.subject); }
  const a = { count: r.count, total: r.total, bestStreak: r.streak, longest: r.longestSession, bestDay: r.bestDay ? r.bestDay[1] : 0, medals: r.medals,
    allSectionsWeek: Object.values(weeks).some(set => SECTIONS.every(x => set.has(x))),
    early: ud.sessions.some(s => new Date(s.start).getHours() < 7 && new Date(s.start).getHours() >= 4),
    night: ud.sessions.some(s => { const e = new Date(s.end); return e.getHours() >= 23 || (e.getHours() < 4 && secs(s) > 0); }),
    pomodoros: ud.sessions.filter(s => s.mode === 'pomodoro').length, tasksDone: (ud.tasks || []).filter(t => t.done).length };
  return ACHIEVEMENTS.map(([id, name, desc, test]) => ({ id, name, desc, earned: !!test(a) }));
}

module.exports = { report, compare, pace, goalProgress, cumulative, suggestDuration, achievements, medalFor, isoWeek, daysBetween, MEDALS };
