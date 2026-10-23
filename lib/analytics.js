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
const CATEGORIES = [['launch', 'Launch pad'], ['time', 'Total time'], ['streaks', 'Streaks & rhythm'], ['intensity', 'Big days'], ['focus', 'Focus & craft'], ['goals', 'Goals & planning'], ['medals', 'Medals'], ['explore', 'Exploration']];
const VIEW_KEYS = ['timer', 'dash', 'sess', 'cal', 'stats', 'plan', 'trophy', 'data', 'set'];
// [id, cat, name, desc, metric, target, unit]  unit: h (seconds shown as hours), d (days), n (count)
const hrs = n => n + ' hour' + (n > 1 ? 's' : '');
const ACHIEVEMENTS = [
  ['first', 'launch', 'Liftoff', 'Log your first study session', 'count', 1, 'n'],
  ['week1', 'launch', 'Week Zero', 'Keep studying across your first 7 days', 'span', 7, 'd'],
  ['timer1', 'launch', 'Clock In', 'Time a session with the built-in timer', 'timerUsed', 1, 'n'],
  ['subjgoal', 'launch', 'Aim High', 'Set a weekly goal for a subject', 'subjGoalSet', 1, 'n'],
  ['onboard', 'launch', 'Ready Room', 'Go through the welcome tour', 'onboarded', 1, 'n'],
  ['tinker', 'launch', 'Knob Turner', 'Change a setting', 'tinker', 1, 'n'],
  ['explore', 'launch', 'Grand Tour', 'Open every section of the app', 'views', VIEW_KEYS.length, 'n'],
  ['month1', 'launch', 'Thirty Down', 'Keep studying across your first 30 days', 'span', 30, 'd'],
  ...[[1, 'h1', 'Hour Zero'], [10, 'h10', 'Warm Engine'], [25, 'h25', 'Quarter Mark'], [50, 'h50', 'Fifty Club'], [100, 'h100', 'Triple Digits'], [250, 'h250', 'Deep Roots'], [300, 'h300', 'Long Game'], [500, 'h500', 'Half-K'], [1000, 'h1000', 'The Thousand']]
    .map(([n, id, name]) => [id, 'time', name, 'Study ' + hrs(n) + ' in total', 'total', n * H, 'h']),
  ...[[10, 'n10', 'Ten Logged'], [50, 'n50', 'Fifty Logged'], [100, 'n100', 'Century Log'], [300, 'n300', 'Logbook'], [500, 'n500', 'The Archive']]
    .map(([n, id, name]) => [id, 'time', name, 'Log ' + n + ' study sessions', 'count', n, 'n']),
  ...[[3, 's3', 'Spark Chain'], [7, 's7', 'Seven Strong'], [14, 's14', 'Two-Week Tear'], [30, 's30', 'Moon Cycle'], [42, 's42', 'Six-Week Run'], [60, 's60', 'Iron Habit'], [100, 's100', 'Hundred Hold']]
    .map(([n, id, name]) => [id, 'streaks', name, 'Study ' + n + ' days in a row', 'bestStreak', n, 'd']),
  ['week7', 'streaks', 'Full Week', 'Study every day of one Mon-Sun week', 'bestWeekDays', 7, 'd'],
  ['weekend', 'streaks', 'Sat-Sun Sweep', 'Study on both Saturday and Sunday of one weekend', 'weekendBoth', 1, 'n'],
  ['weekend10', 'streaks', 'Ten Weekends', 'Study on 10 weekends in a row', 'weekendRun', 10, 'n'],
  ['early', 'streaks', 'Dawn Patrol', 'Start a session between 4am and 7am', 'earlyRun', 1, 'd'],
  ['early7', 'streaks', 'Sunrise Regular', 'Start before 7am on 7 days in a row', 'earlyRun', 7, 'd'],
  ['night', 'streaks', 'Midnight Oil', 'Study after 11pm', 'nightRun', 1, 'd'],
  ['night7', 'streaks', 'Moonlighter', 'Study after 11pm on 7 days in a row', 'nightRun', 7, 'd'],
  ['samesub30', 'streaks', 'Single-Minded', 'Study the same subject 30 days in a row', 'subjRun', 30, 'd'],
  ...[[2, 'day2', 'Solid Shift'], [4, 'day4', 'Heavy Lift'], [6, 'day6', 'Overdrive'], [8, 'day8', 'Full Throttle']]
    .map(([n, id, name]) => [id, 'intensity', name, 'Study ' + hrs(n) + ' in one day', 'bestDay', n * H, 'h']),
  ...[[1, 'sess1h', 'In the Zone'], [2, 'sess2h', 'Tunnel Vision'], [3, 'marathon', 'Endurance'], [4, 'sess4h', 'Unbroken']]
    .map(([n, id, name]) => [id, 'intensity', name, 'Study ' + hrs(n) + ' in a single session', 'longest', n * H, 'h']),
  ['carbon', 'intensity', 'Deja Vu', 'Study exactly the same time (to the minute) on two days', 'twinDays', 1, 'n'],
  ['pomo', 'focus', 'Tomato Patch', 'Complete 25 Pomodoro sessions', 'pomodoros', 25, 'n'],
  ['detail', 'focus', 'Full Picture', 'Log a session with a subject, activity and note', 'detailed', 1, 'n'],
  ['notes50', 'focus', 'Field Notes', 'Add notes to 50 sessions', 'noted', 50, 'n'],
  ['breaks100', 'focus', 'Recharge', 'Log breaks in 100 sessions', 'breaks', 100, 'n'],
  ['focus5', 'focus', 'Laser Mode', 'Rate your focus 5 stars on 10 sessions', 'focus5', 10, 'n'],
  ['goal200', 'goals', 'Double Up', 'Study twice your daily goal in one day', 'goal200', 1, 'n'],
  ['subjgoalmet', 'goals', 'Subject Sealed', "Meet a subject's weekly goal", 'subjGoalMet', 1, 'n'],
  ['termgoal', 'goals', 'Term Champion', 'Reach your term goal', 'termGoal', 1, 'n'],
  ['photo', 'goals', 'Buzzer Beater', 'Hit your daily goal with under 30 minutes left in the day', 'photo', 1, 'n'],
  ['goalmonth', 'goals', 'Perfect Month', 'Hit your daily goal every day of a calendar month', 'goalMonth', 1, 'n'],
  ['tasks10', 'goals', 'Check, Check', 'Complete 10 to-dos', 'tasksDone', 10, 'n'],
  ['exams10', 'goals', 'Exam Planner', 'Add 10 exams', 'exams', 10, 'n'],
  ['bronze', 'medals', 'Podium', 'Earn a medal', 'anyMedal', 1, 'n'],
  ['gold', 'medals', 'Golden Day', 'Earn a gold medal', 'goldMedal', 1, 'n'],
  ['plat', 'medals', 'Platinum Day', 'Earn a platinum medal', 'platMedal', 1, 'n'],
  ['gold23', 'medals', 'Gold Hoard', 'Earn 23 gold medals', 'goldMedal', 23, 'n'],
  ['medalset', 'medals', 'Full Set', 'Earn a bronze, a silver and a gold medal', 'medalKinds', 3, 'n'],
  ['subj5', 'explore', 'Five Fronts', 'Study 5 different subjects', 'subjects', 5, 'n'],
  ['subj3day', 'explore', 'Triple Play', 'Study 3 different subjects in one day', 'subjDay', 3, 'n'],
  ['acts10', 'explore', 'Ten Tools', 'Use 10 different activities', 'activities', 10, 'n'],
  ['daynight', 'explore', 'Sun to Moon', 'Study before 7am and after 11pm on the same day', 'dayNight', 1, 'n'],
  ['seasons', 'explore', 'All Weather', 'Study in spring, summer, fall and winter', 'seasons', 4, 'n'],
  ['spectrum', 'explore', 'Round the Clock', 'Study in all six 4-hour blocks of one day', 'spectrum', 6, 'n'],
];
const GOAL_STREAKS = [[3, 'g3', 'Hat Trick'], [7, 'g7', 'Seven Hits'], [30, 'g30', 'Clockwork']];
const HOUR_TIERS = [[1, 'Spark'], [10, 'Kindling'], [50, 'Blaze'], [100, 'Bonfire'], [250, 'Wildfire']];
const COUNT_TIERS = [[10, 'Regular'], [50, 'Devotee'], [100, 'Lifer']];
function runBest(keys) { let best = 0, run = 0, prev = null; for (const k of [...new Set(keys)].sort()) { run = prev && daysBetween(prev, k) === 2 ? run + 1 : 1; best = Math.max(best, run); prev = k; } return best; }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const finish = (x, v) => { const value = Math.min(v || 0, x.target); return { ...x, value, progress: x.target ? value / x.target : 0, earned: (v || 0) >= x.target }; };
function achievements(ud, h = 0) {
  const ss = ud.sessions || [], r = report(ss, { h, medals: ud.settings.medals }), weeks = {}, wdays = {}, flags = ud.flags || {};
  const act = {}, sub = {}, subDays = {}, daySubs = {}, early = [], night = [], periods = {}, seasons = new Set(), subWeek = {};
  for (const s of ss) { const sec = secs(s); if (!(sec > 0)) continue; const k = dayKey(s.start, h), w = isoWeek(keyToDate(k));
    (wdays[w] ||= new Set()).add(k); (daySubs[k] ||= new Set()).add(s.subject); (subDays[s.subject] ||= []).push(k);
    subWeek[s.subject + '|' + w] = (subWeek[s.subject + '|' + w] || 0) + sec;
    for (const [m, key] of [[act, s.activity], [sub, s.subject]]) if (key) { const o = m[key] ||= { sec: 0, n: 0 }; o.sec += sec; o.n++; }
    const st = new Date(s.start), en = new Date(s.end), sh = st.getHours(), eh = en.getHours();
    if (sh >= 4 && sh < 7) early.push(k); if (eh >= 23 || eh < 4) night.push(k);
    seasons.add([3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3][st.getMonth()]);
    for (let t = new Date(st); t < en; t = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours() + 1)) (periods[dayKey(t, h)] ||= new Set()).add(Math.floor(t.getHours() / 4)); }
  const dayset = Object.keys(r.byDay).filter(k => r.byDay[k] > 0).sort(), has = new Set(dayset);
  const g = ud.settings.goals || {}, goalOf = k => goalFor(keyToDate(k), g), goalDays = dayset.filter(k => goalOf(k) > 0 && r.byDay[k] >= goalOf(k)), goalSet = new Set(goalDays);
  const md = r.medals, meta = ud.subjectMeta || {}, term = ud.settings.term || {};
  const wkKeys = [...new Set(dayset.filter(k => [0, 6].includes(keyToDate(k).getDay())).map(k => { const d = keyToDate(k); return dayKey(addDays(d, d.getDay() === 0 ? -1 : 0)); }))].sort();
  let wkRun = 0, wkBest = 0; wkKeys.forEach((k, i) => { wkRun = i && daysBetween(wkKeys[i - 1], k) === 8 ? wkRun + 1 : 1; wkBest = Math.max(wkBest, wkRun); });
  const mins = dayset.map(k => Math.floor(r.byDay[k] / 60)).filter(m => m > 0);
  const photo = goalDays.some(k => { const goal = goalOf(k), end = +addDays(keyToDate(k), 1) + h * H * 1000; let acc = 0;
    for (const s of ss.filter(s => dayKey(s.start, h) === k).sort((x, y) => new Date(x.end) - new Date(y.end))) { acc += secs(s); if (acc >= goal) return end - new Date(s.end) <= 30 * 60e3 && end - new Date(s.end) >= 0; } return false; });
  const months = {}; for (const k of goalDays) months[k.slice(0, 7)] = (months[k.slice(0, 7)] || 0) + 1;
  const goalMonth = Object.entries(months).some(([m, n]) => { const [y, mo] = m.split('-').map(Number); return n >= new Date(y, mo, 0).getDate(); });
  const termTotal = term.start && term.end ? dayset.filter(k => inRange(k, term.start, term.end)).reduce((t, k) => t + r.byDay[k], 0) : 0;
  const a = { count: r.count, total: r.total, bestStreak: r.streak, longest: r.longestSession, bestDay: r.bestDay ? r.bestDay[1] : 0,
    span: dayset.length ? daysBetween(dayset[0], dayset[dayset.length - 1]) : 0,
    timerUsed: ss.filter(s => ['stopwatch', 'pomodoro', 'countdown'].includes(s.mode)).length,
    subjGoalSet: Object.values(meta).some(m => +m.weeklyGoalMin > 0) ? 1 : 0, onboarded: flags.onboarded ? 1 : 0, tinker: flags.tinker ? 1 : 0,
    views: VIEW_KEYS.filter(v => (flags.views || []).includes(v)).length,
    bestWeekDays: Math.max(0, ...Object.values(wdays).map(x => x.size)),
    weekendBoth: dayset.some(k => keyToDate(k).getDay() === 6 && has.has(dayKey(addDays(keyToDate(k), 1)))) ? 1 : 0, weekendRun: wkBest,
    earlyRun: runBest(early), nightRun: runBest(night), subjRun: Math.max(0, ...Object.values(subDays).map(runBest)),
    twinDays: new Set(mins).size < mins.length ? 1 : 0,
    pomodoros: ss.filter(s => s.mode === 'pomodoro').length, detailed: ss.some(s => s.subject && s.activity && s.note) ? 1 : 0,
    noted: ss.filter(s => s.note).length, breaks: ss.filter(s => +s.breakSec > 0).length, focus5: ss.filter(s => +s.focus === 5).length,
    goal200: dayset.some(k => goalOf(k) > 0 && r.byDay[k] >= 2 * goalOf(k)) ? 1 : 0,
    subjGoalMet: Object.entries(subWeek).some(([k, v]) => { const m = meta[k.slice(0, k.lastIndexOf('|'))]; return m && +m.weeklyGoalMin > 0 && v >= m.weeklyGoalMin * 60; }) ? 1 : 0,
    termGoal: +g.termMin > 0 && termTotal >= g.termMin * 60 ? 1 : 0, photo: photo ? 1 : 0, goalMonth: goalMonth ? 1 : 0,
    tasksDone: (ud.tasks || []).filter(t => t.done).length, exams: (ud.exams || []).length, goalStreak: runBest(goalDays),
    anyMedal: md.bronze + md.silver + md.gold + md.platinum, goldMedal: md.gold + md.platinum, platMedal: md.platinum,
    medalKinds: [md.bronze, md.silver, md.gold + md.platinum].filter(x => x > 0).length,
    subjects: Object.keys(sub).length, subjDay: Math.max(0, ...Object.values(daySubs).map(x => x.size)), activities: Object.keys(act).length,
    dayNight: early.some(k => night.includes(k)) ? 1 : 0, seasons: seasons.size, spectrum: Math.max(0, ...Object.values(periods).map(x => x.size)) };
  void goalSet;
  const list = ACHIEVEMENTS.map(([id, cat, name, desc, metric, target, unit]) => ({ id, cat, name, desc, metric, target, unit }));
  if (+g.dailyMin > 0) list.push(...GOAL_STREAKS.map(([n, id, name]) => ({ id, cat: 'goals', name, desc: 'Hit your daily goal ' + n + ' days in a row', metric: 'goalStreak', target: n, unit: 'd' })));
  const global = list.map(({ metric, ...x }) => finish(x, a[metric]));
  const personal = [];
  for (const [kind, m] of [['activity', act], ['subject', sub]]) for (const [key, o] of Object.entries(m).sort((x, y) => y[1].sec - x[1].sec)) {
    for (const [n, tier] of HOUR_TIERS) personal.push(finish({ id: kind + ':' + slug(key) + ':h' + n, kind, key, name: tier, desc: 'Study ' + hrs(n) + ' of ' + key, target: n * H, unit: 'h' }, o.sec));
    for (const [n, tier] of COUNT_TIERS) personal.push(finish({ id: kind + ':' + slug(key) + ':n' + n, kind, key, name: tier, desc: 'Log ' + n + ' sessions of ' + key, target: n, unit: 'n' }, o.n)); }
  return { categories: CATEGORIES.map(([id, name]) => ({ id, name })), global, personal };
}
// Aggregate, anonymous counts: how many users have earned each global badge. Input: array of [userData, dayStartHour].
function earnedCounts(entries) { const counts = {}; for (const [ud, h] of entries) for (const x of achievements(ud, h).global) if (x.earned) counts[x.id] = (counts[x.id] || 0) + 1; return { users: entries.length, counts }; }

module.exports = { report, compare, pace, goalProgress, cumulative, suggestDuration, achievements, earnedCounts, VIEW_KEYS, medalFor, isoWeek, daysBetween, MEDALS };
