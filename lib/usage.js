'use strict';
// Admin-only usage metrics, computed from existing study data plus the lightweight per-user activity days (user.activeDays).
const { dayKey, keyToDate, addDays, secs, streaks, goalFor } = require('./stats');
const DAY = 864e5, KEEP_DAYS = 120;

// Record authenticated API use: lastSeen (ISO) + a capped list of UTC-agnostic local day keys. Returns true when a save is warranted (new day).
function touch(user, now = new Date()) {
  if (!user) return false;
  const k = dayKey(now), days = Array.isArray(user.activeDays) ? user.activeDays : (user.activeDays = []);
  user.lastSeen = now.toISOString();
  if (days[days.length - 1] === k) return false;
  if (!days.includes(k)) { days.push(k); days.sort(); if (days.length > KEEP_DAYS) days.splice(0, days.length - KEEP_DAYS); }
  return true;
}

const r1 = v => Math.round(v * 10) / 10, pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
const host = x => { try { return new URL(x).hostname.replace(/^www\./, ''); } catch { return null; } };
const TIMER_MODES = new Set(['stopwatch', 'pomodoro', 'countdown']);

function perUser(u, ud, { now = new Date(), bstat, achievements } = {}) {
  ud = ud || {}; const ss = (ud.sessions || []).filter(s => secs(s) > 0), settings = ud.settings || {}, g = settings.goals || {};
  const today = keyToDate(dayKey(now)), k7 = dayKey(addDays(today, -6)), k30 = dayKey(addDays(today, -29));
  const byDay = {}, subj = {}; let total = 0, h7 = 0, h30 = 0, lastStudy = 0, timer = 0, manual = 0;
  for (const s of ss) { const v = secs(s), k = dayKey(s.start); byDay[k] = (byDay[k] || 0) + v; total += v; subj[s.subject || 'Other'] = (subj[s.subject || 'Other'] || 0) + v;
    if (k >= k7) h7 += v; if (k >= k30) h30 += v; lastStudy = Math.max(lastStudy, Date.parse(s.end || s.start) || 0);
    if (TIMER_MODES.has(s.mode)) timer++; else manual++; }
  const active = new Set([...Object.keys(byDay), ...(Array.isArray(u.activeDays) ? u.activeDays : [])]);
  const lastDay = [...active].sort().pop(), lastActive = Math.max(lastStudy, Date.parse(u.lastSeen) || 0, lastDay ? +keyToDate(lastDay) : 0) || null;
  const st = streaks(byDay, now);
  const goalsSet = ['dailyMin', 'weeklyMin', 'monthlyMin', 'termMin'].filter(k => +g[k] > 0).length + (g.weekendDailyMin != null && g.weekendDailyMin !== '' ? 1 : 0)
    + Object.values(ud.subjectMeta || {}).filter(m => +m.weeklyGoalMin > 0).length;
  const goalDays = Object.keys(byDay).filter(k => { const gs = goalFor(keyToDate(k), g); return gs > 0 && byDay[k] >= gs; }).length;
  let trophies = 0; try { if (achievements) { const A = achievements(ud, +settings.dayStartHour || 0); trophies = [...A.global, ...A.personal].filter(x => x.earned).length; } } catch { /* ignore */ }
  const spark = []; for (let i = 29; i >= 0; i--) { const k = dayKey(addDays(today, -i)); spark.push(Math.round((byDay[k] || 0) / 60)); }
  const b = bstat ? bstat(u) : { enabled: false };
  const plan = !b.enabled ? 'billing off' : b.exempt === 'admin' ? 'admin' : b.exempt === 'comp' ? 'comped' : b.exempt === 'legacy' ? 'early user' : b.lifetime ? 'lifetime'
    : b.subscribed ? ((b.subscription && b.subscription.plan) || 'paid') : b.trial ? 'trial' : 'trial ended';
  const a = u.attribution || {}, source = a.utm_source ? a.utm_source + (a.utm_medium ? ' / ' + a.utm_medium : '') : a.gclid ? 'google (gclid)' : a.fbclid ? 'facebook (fbclid)' : a.referrer ? host(a.referrer) : u.attribution ? 'direct' : null;
  return { id: u.id, username: u.username, admin: !!u.admin, created: u.created || null, source, landing: a.landing || null, signupLang: u.signupLang || null, lang: settings.lang || null,
    lastActive: lastActive ? new Date(lastActive).toISOString() : null, lastSeen: u.lastSeen || null,
    days7: [...active].filter(k => k >= k7).length, days30: [...active].filter(k => k >= k30).length, activeDays: [...active].sort(),
    sessions: ss.length, hours: r1(total / 3600), hours7: r1(h7 / 3600), hours30: r1(h30 / 3600), avgSessionMin: ss.length ? Math.round(total / ss.length / 60) : 0,
    streak: st.current, bestStreak: st.best, topSubjects: Object.entries(subj).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, v]) => ({ name: n, hours: r1(v / 3600) })),
    goalsSet, goalDaysMet: goalDays, trophies, plan, paid: ['lifetime', 'monthly', 'yearly', 'paid'].includes(plan), trialEnd: b.trial && b.trialEnds ? b.trialEnds : null, trialDaysLeft: b.trialDaysLeft ?? null,
    features: { timer, manual, goals: goalsSet > 0, exams: (ud.exams || []).length, trophies, settings: !!(ud.flags && ud.flags.tinker), lang: settings.lang || null }, spark };
}

function summary(rows, now = new Date()) {
  const today = keyToDate(dayKey(now)), key = i => dayKey(addDays(today, -i)), users = rows.filter(r => !r.admin), n = users.length;
  const inWin = (r, d) => { const from = key(d - 1); return r.activeDays.some(k => k >= from); };
  const dau = users.filter(r => inWin(r, 1)).length, wau = users.filter(r => inWin(r, 7)).length, mau = users.filter(r => inWin(r, 30)).length;
  const daily = []; for (let i = 29; i >= 0; i--) { const k = key(i); daily.push([k, users.filter(r => r.activeDays.includes(k)).length]); }
  // retention: share of users (old enough) active on day N after signup, or later
  const ret = N => { const el = users.filter(r => r.created && (now - Date.parse(r.created)) / DAY >= N); if (!el.length) return null;
    const ok = el.filter(r => { const c = dayKey(new Date(r.created)), t = dayKey(addDays(keyToDate(c), N)); return r.activeDays.some(k => k >= t); }).length; return { pct: pct(ok, el.length), of: el.length }; };
  const cohorts = {}; for (const r of users) { if (!r.created) continue; const c = keyToDate(dayKey(new Date(r.created))), wk = dayKey(addDays(c, -((c.getDay() + 6) % 7)));
    const o = cohorts[wk] ||= { week: wk, size: 0, w: [0, 0, 0, 0, 0] };
    o.size++; for (let w = 0; w < 5; w++) { const a = dayKey(addDays(keyToDate(wk), 7 * w)), b = dayKey(addDays(keyToDate(wk), 7 * w + 6)); if (r.activeDays.some(k => k >= a && k <= b)) o.w[w]++; } }
  const cohortList = Object.values(cohorts).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 8).map(o => ({ ...o, w: o.w.map((v, i) => keyToDate(o.week).getTime() + 7 * i * DAY > +now ? null : pct(v, o.size)) }));
  const act30 = users.filter(r => r.days30 > 0), hrs = users.reduce((a, r) => a + r.hours, 0), hrs30 = act30.reduce((a, r) => a + r.hours30, 0), sess = users.reduce((a, r) => a + r.sessions, 0);
  const activated = users.filter(r => r.sessions > 0).length, f = k => users.filter(r => r.features[k]).length;
  return { users: n, dau, wau, mau, dauMau: pct(dau, mau), wauMau: pct(wau, mau), daily,
    totalHours: r1(hrs), avgHoursPerActive: act30.length ? r1(hrs30 / act30.length) : 0, sessionsPerUser: n ? r1(sess / n) : 0, sessions: sess,
    retention: { d1: ret(1), d7: ret(7), d30: ret(30) }, cohorts: cohortList, activated, activationRate: pct(activated, n),
    plans: { trial: users.filter(r => r.plan === 'trial').length, paid: users.filter(r => r.paid).length, ended: users.filter(r => r.plan === 'trial ended').length, other: users.filter(r => !r.paid && !['trial', 'trial ended'].includes(r.plan)).length },
    features: { timer: f('timer'), manual: f('manual'), goals: f('goals'), exams: f('exams'), trophies: f('trophies'), settings: f('settings'), lang: f('lang') } };
}

module.exports = { touch, perUser, summary, KEEP_DAYS };
