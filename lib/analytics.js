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

const H = 3600;
// [id, name, desc, metric, target, unit]  unit: h (seconds shown as hours), d (days), n (count)
const ACHIEVEMENTS = [
  ['first', 'First step', 'Log your first study session', 'count', 1, 'n'],
  ...[[1, 'h1', 'Hour one'], [10, 'h10', 'Getting serious'], [25, 'h25', 'Quarter century'], [50, 'h50', 'Half century'], [100, 'h100', 'Centurion'], [250, 'h250', 'Dedicated'], [300, 'h300', 'MCAT ready'], [500, 'h500', 'Scholar'], [1000, 'h1000', 'Master of hours']]
    .map(([n, id, name]) => [id, name, n + ' hour' + (n > 1 ? 's' : '') + ' studied', 'total', n * H, 'h']),
  ...[[3, 's3', 'Warming up'], [7, 's7', 'One week strong'], [14, 's14', 'Fortnight'], [30, 's30', 'Unbreakable'], [60, 's60', 'Iron will'], [100, 's100', 'Centennial streak']]
    .map(([n, id, name]) => [id, name, n + '-day streak', 'bestStreak', n, 'd']),
  ...[[2, 'day2', 'Solid day'], [4, 'day4', 'Big day'], [6, 'day6', 'Huge day'], [8, 'day8', 'Full-length day']]
    .map(([n, id, name]) => [id, name, n + '+ hours in one day', 'bestDay', n * H, 'h']),
  ...[[1, 'sess1h', 'Locked in'], [2, 'sess2h', 'Deep focus'], [3, 'marathon', 'Marathon']]
    .map(([n, id, name]) => [id, name, 'A single session of ' + n + '+ hour' + (n > 1 ? 's' : ''), 'longest', n * H, 'h']),
  ...[[10, 'n10', 'Regular'], [50, 'n50', 'Habit formed'], [100, 'n100', 'Hundred sessions'], [500, 'n500', 'Relentless']]
    .map(([n, id, name]) => [id, name, n + ' study sessions', 'count', n, 'n']),
  ['week7', 'Consistent week', 'Study every day of one Mon-Sun week', 'bestWeekDays', 7, 'd'],
  ['weekend', 'Weekend warrior', 'Study on both Saturday and Sunday of one weekend', 'weekendBoth', 1, 'n'],
  ['allsec', 'Well rounded', 'Study all four MCAT sections in one week', 'sectionsWeek', 4, 'n'],
  ['early', 'Early bird', 'Start a session between 4am and 7am', 'early', 1, 'n'],
  ['night', 'Night owl', 'Study after 11pm', 'night', 1, 'n'],
  ['bronze', 'On the podium', 'Earn a bronze medal', 'anyMedal', 1, 'n'],
  ['gold', 'Gold standard', 'Earn a gold medal', 'goldMedal', 1, 'n'],
  ['plat', 'Platinum', 'Earn a platinum medal', 'platMedal', 1, 'n'],
  ['pomo', 'Tomato farmer', 'Complete 25 Pomodoro sessions', 'pomodoros', 25, 'n'],
  ['tasks10', 'Checklist', 'Complete 10 tasks', 'tasksDone', 10, 'n'],
];
const GOAL_STREAKS = [[3, 'g3', 'On target'], [7, 'g7', 'Goal getter'], [30, 'g30', 'Goal machine']];
const ACT_TIERS = [[10, 'Practiced'], [50, 'Expert'], [100, 'Master']];
const SECTIONS = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'];
function runBest(keys) { let best = 0, run = 0, prev = null; for (const k of [...keys].sort()) { run = prev && daysBetween(prev, k) === 2 ? run + 1 : 1; best = Math.max(best, run); prev = k; } return best; }
function achievements(ud, h = 0) {
  const ss = ud.sessions || [], r = report(ss, { h, medals: ud.settings.medals }), weeks = {}, wdays = {}, byAct = {};
  for (const s of ss) { const k = dayKey(s.start, h), w = isoWeek(keyToDate(k)); (weeks[w] ||= new Set()).add(s.subject); if (secs(s) > 0) (wdays[w] ||= new Set()).add(k); if (s.activity) byAct[s.activity] = (byAct[s.activity] || 0) + secs(s); }
  const dayset = Object.keys(r.byDay).filter(k => r.byDay[k] > 0), has = new Set(dayset);
  const g = ud.settings.goals || {}, goalDays = dayset.filter(k => { const gs = goalFor(keyToDate(k), g); return gs > 0 && r.byDay[k] >= gs; });
  const md = r.medals;
  const a = { count: r.count, total: r.total, bestStreak: r.streak, longest: r.longestSession, bestDay: r.bestDay ? r.bestDay[1] : 0,
    bestWeekDays: Math.max(0, ...Object.values(wdays).map(x => x.size)),
    weekendBoth: dayset.some(k => keyToDate(k).getDay() === 6 && has.has(dayKey(addDays(keyToDate(k), 1)))) ? 1 : 0,
    sectionsWeek: Math.max(0, ...Object.values(weeks).map(set => SECTIONS.filter(x => set.has(x)).length)),
    early: ss.some(s => { const x = new Date(s.start).getHours(); return x < 7 && x >= 4; }) ? 1 : 0,
    night: ss.some(s => { const e = new Date(s.end); return e.getHours() >= 23 || (e.getHours() < 4 && secs(s) > 0); }) ? 1 : 0,
    anyMedal: md.bronze + md.silver + md.gold + md.platinum, goldMedal: md.gold + md.platinum, platMedal: md.platinum,
    pomodoros: ss.filter(s => s.mode === 'pomodoro').length, tasksDone: (ud.tasks || []).filter(t => t.done).length, goalStreak: runBest(goalDays) };
  const list = ACHIEVEMENTS.map(([id, name, desc, metric, target, unit]) => ({ id, name, desc, metric, target, unit }));
  if (g.dailyMin > 0) list.push(...GOAL_STREAKS.map(([n, id, name]) => ({ id, name, desc: 'Hit your daily goal ' + n + ' days in a row', metric: 'goalStreak', target: n, unit: 'd' })));
  for (const [act, v] of Object.entries(byAct).sort((x, y) => y[1] - x[1])) for (const [n, tier] of ACT_TIERS) { a['act:' + act] = v; list.push({ id: 'act-' + act.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + n, name: act + ' ' + tier.toLowerCase(), desc: n + ' hours of ' + act, metric: 'act:' + act, target: n * H, unit: 'h', group: 'activity' }); }
  return list.map(({ metric, ...x }) => { const value = Math.min(a[metric] || 0, x.target); return { ...x, value, progress: x.target ? value / x.target : 0, earned: (a[metric] || 0) >= x.target }; });
}

module.exports = { report, compare, pace, goalProgress, cumulative, suggestDuration, achievements, medalFor, isoWeek, daysBetween, MEDALS };
