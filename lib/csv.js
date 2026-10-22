'use strict';
// CSV parsing + Athenify-style import mapping. Pure functions (no I/O).
function parseCSV(s) {
  s = String(s || '').replace(/^\uFEFF/, '');
  const first = s.split(/\r?\n/)[0] || '';
  const count = ch => first.split(ch).length - 1;
  const sep = [';', '\t'].reduce((best, c) => (count(c) > count(best) ? c : best), ',');
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; r.push(f); f = ''; if (r.some(x => x !== '')) rows.push(r); r = []; }
    else f += c;
  }
  r.push(f); if (r.some(x => x !== '')) rows.push(r);
  return rows;
}
const csvEscape = v => { v = String(v ?? ''); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

// Returns seconds. "1:30" = 1h30m, "1:30:15" h:m:s, "1h 30m", "90 min", bare number = minutes.
function parseDuration(v) {
  v = String(v ?? '').trim().toLowerCase(); if (!v) return NaN;
  let m;
  if ((m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(v))) return +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0);
  const h = /([\d.,]+)\s*(h|hr|hrs|hour|hours|std)\b/.exec(v), mi = /([\d.,]+)\s*(m|min|mins|minute|minutes)\b/.exec(v), se = /([\d.,]+)\s*(s|sec|secs|seconds)\b/.exec(v);
  const num = x => parseFloat(x.replace(',', '.'));
  if (h || mi || se) return (h ? num(h[1]) * 3600 : 0) + (mi ? num(mi[1]) * 60 : 0) + (se ? num(se[1]) : 0);
  const n = Number(v.replace(',', '.'));
  return isNaN(n) ? NaN : n * 60;
}

function parseDatePart(s) {
  s = s.trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return [+m[1], +m[2], +m[3], s.slice(m[0].length)];
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) return [+m[3], +m[2], +m[1], s.slice(m[0].length)]; // dd.mm.yyyy
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return [+m[3], +m[1], +m[2], s.slice(m[0].length)]; // mm/dd/yyyy
  return null;
}
function parseTimePart(s) {
  s = String(s || '').trim().replace(/^[T,]\s*/, '');
  if (!s) return [0, 0, 0];
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]\.?m\.?)?$/i.exec(s);
  if (!m) return null;
  let h = +m[1];
  if (m[4]) { const pm = /p/i.test(m[4]); if (h === 12) h = 0; if (pm) h += 12; }
  if (h > 23 || +m[2] > 59) return null;
  return [h, +m[2], +(m[3] || 0)];
}
// Combine a date cell and an optional time cell (time cell may itself be a full date-time). Local time.
function toDate(d, t) {
  d = String(d || '').trim(); t = String(t || '').trim();
  if (!d && !t) return null;
  for (const s of [t, d]) if (/^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:?\d\d)$/.test(s)) { const x = new Date(s); return isNaN(x) ? null : x; }
  let dp = t ? parseDatePart(t) : null, rest;
  if (dp) rest = dp[3]; else { dp = parseDatePart(d); if (!dp) return null; rest = t || dp[3]; }
  const tp = parseTimePart(rest); if (!tp) return null;
  const x = new Date(dp[0], dp[1] - 1, dp[2], tp[0], tp[1], tp[2]);
  return isNaN(x) || x.getMonth() !== dp[1] - 1 ? null : x;
}

const CANDIDATES = {
  date: ['date', 'datum', 'day'],
  start: ['start', 'begin', 'from'],
  end: ['end', 'stop', 'ende', 'until', 'finish'],
  duration: ['duration', 'dauer', 'minutes', 'time spent', 'hours', 'length', 'lernzeit'],
  subject: ['subject', 'category', 'kategorie', 'project', 'activity', 'fach', 'topic'],
  note: ['note', 'comment', 'description', 'notiz', 'title'],
};
function mapColumns(header, map) {
  const h = header.map(x => String(x).trim().toLowerCase()), used = new Set(), out = {};
  // explicit mappings first
  for (const k of Object.keys(CANDIDATES)) if (map && map[k]) { out[k] = h.indexOf(String(map[k]).trim().toLowerCase()); if (out[k] >= 0) used.add(out[k]); }
  // exact header matches before substring matches, so "Start date" doesn't steal "Date"
  for (const exact of [true, false]) for (const k of Object.keys(CANDIDATES)) {
    if (out[k] !== undefined && out[k] >= 0) continue; if (map && map[k]) continue;
    const i = h.findIndex((x, j) => !used.has(j) && CANDIDATES[k].some(c => (exact ? x === c : x.includes(c))));
    if (i >= 0) { out[k] = i; used.add(i); }
  }
  for (const k of Object.keys(CANDIDATES)) if (out[k] === undefined) out[k] = -1;
  return out;
}
const MAX_SECS = 24 * 3600;
function csvToSessions(text, map, defaultSubject = 'Imported') {
  const rows = parseCSV(text);
  if (rows.length < 2) return { sessions: [], skipped: 0, columns: {} };
  const ci = mapColumns(rows[0], map), sessions = []; let skipped = 0;
  for (const r of rows.slice(1)) {
    const g = i => (i >= 0 ? String(r[i] || '').trim() : '');
    const st = toDate(g(ci.date), g(ci.start));
    let en = g(ci.end) ? toDate(g(ci.date), g(ci.end)) : null; // empty End must NOT be treated as midnight
    let dur = NaN;
    if (st && en) { if (en <= st) en = new Date(+en + 864e5); dur = (en - st) / 1000; }
    else if (g(ci.duration)) { dur = parseDuration(g(ci.duration)); if (/hour|stunden/.test(rows[0][ci.duration].toLowerCase()) && /^[\d.,]+$/.test(g(ci.duration))) dur *= 60; }
    if (!st || !(dur > 0) || dur > MAX_SECS) { skipped++; continue; }
    sessions.push({ subject: g(ci.subject) || defaultSubject, note: g(ci.note), start: st.toISOString(), end: new Date(+st + dur * 1000).toISOString() });
  }
  return { sessions, skipped, columns: Object.fromEntries(Object.entries(ci).map(([k, i]) => [k, i >= 0 ? rows[0][i] : null])) };
}
function sessionsToCSV(sessions) {
  return 'date,start,end,duration_min,subject,note\n' + sessions.map(s =>
    [s.start.slice(0, 10), s.start, s.end, ((new Date(s.end) - new Date(s.start)) / 6e4).toFixed(1), s.subject, s.note].map(csvEscape).join(',')).join('\n') + '\n';
}
module.exports = { parseCSV, csvEscape, parseDuration, toDate, mapColumns, csvToSessions, sessionsToCSV };
