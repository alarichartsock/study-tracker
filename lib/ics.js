'use strict';
// iCalendar (RFC 5545) parsing for the Athenify calendar feed import. Pure functions.
function unfold(text) { return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, ''); }
const unescapeText = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseLine(line) {
  // NAME;PARAM=a;PARAM2="x:y":VALUE  (colon inside quoted params is not the separator)
  let i = 0, q = false; for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
  const head = line.slice(0, i), value = line.slice(i + 1), parts = head.split(';'), params = {};
  for (const p of parts.slice(1)) { const e = p.indexOf('='); if (e > 0) params[p.slice(0, e).toUpperCase()] = p.slice(e + 1).replace(/^"|"$/g, ''); }
  return { name: parts[0].toUpperCase(), params, value };
}

// Offset (ms) of a time zone at a UTC instant, via Intl (no tz database needed).
function tzOffset(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
}
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffset(guess, tz); t = guess - tzOffset(t, tz); // second pass handles DST edges
  return new Date(t);
}
const WINDOWS_TZ = { 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'GMT Standard Time': 'Europe/London',
  'Pacific Standard Time': 'America/Los_Angeles', 'Mountain Standard Time': 'America/Denver', 'Central Standard Time': 'America/Chicago', 'Eastern Standard Time': 'America/New_York', 'UTC': 'UTC' };
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

// Returns { date: Date, allDay: bool } or null.
function parseDateValue(value, params = {}) {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return /^\d{8}$/.test(v) ? { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true } : null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v); if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || 0].map(Number);
  if (m[7]) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  let tz = params.TZID && params.TZID.replace(/^\/+/, ''); if (tz && WINDOWS_TZ[tz]) tz = WINDOWS_TZ[tz];
  if (tz && validTz(tz)) return { date: zonedToUtc(y, mo, d, h, mi, s, tz), allDay: false };
  return { date: new Date(y, mo - 1, d, h, mi, s), allDay: false }; // floating time -> server local
}
function parseDuration(v) { // ISO 8601 duration, e.g. PT1H30M
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim()); if (!m) return NaN;
  return ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * (m[1] === '-' ? -1 : 1);
}

function parseICS(text) {
  const lines = unfold(text).split('\n'), events = []; let cur = null, depth = 0, skipped = { allDay: 0, invalid: 0 };
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const { name, params, value } = parseLine(raw);
    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (name === 'BEGIN') { depth++; continue; } // nested VALARM etc.
    if (name === 'END' && depth > 0) { depth--; continue; }
    if (depth > 0) continue;
    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      const st = cur.DTSTART && parseDateValue(cur.DTSTART.value, cur.DTSTART.params);
      let en = cur.DTEND && parseDateValue(cur.DTEND.value, cur.DTEND.params);
      if (!en && st && cur.DURATION) { const d = parseDuration(cur.DURATION.value); if (d > 0) en = { date: new Date(+st.date + d * 1000), allDay: st.allDay }; }
      if (st && st.allDay) skipped.allDay++;
      else if (!st || !en || !(en.date > st.date) || en.date - st.date > 864e5) skipped.invalid++;
      else events.push({ uid: cur.UID ? unescapeText(cur.UID.value).slice(0, 200) : `${+st.date}-${cur.SUMMARY ? cur.SUMMARY.value : ''}`,
        summary: unescapeText(cur.SUMMARY ? cur.SUMMARY.value : '').trim(), description: unescapeText(cur.DESCRIPTION ? cur.DESCRIPTION.value : '').trim(),
        categories: cur.CATEGORIES ? unescapeText(cur.CATEGORIES.value) : '', start: st.date.toISOString(), end: en.date.toISOString() });
      cur = null; continue;
    }
    if (!cur[name]) cur[name] = { params, value };
  }
  return { events, skipped };
}

// Heuristic: Athenify-style summaries look like "Subject", "Subject - Activity", "Subject · Activity" or "Subject (Activity)".
const SEPARATORS = /\s+[-–—·|:]\s+/;
function splitSummary(summary, mode = 'auto') {
  const s = String(summary || '').trim();
  if (mode === 'subject') return { subject: s, activity: '' };
  if (mode === 'activity') return { subject: '', activity: s };
  let m = /^(.*?)\s*\(([^()]+)\)$/.exec(s); if (m && m[1]) return { subject: m[1].trim(), activity: m[2].trim() };
  const parts = s.split(SEPARATORS); if (parts.length >= 2) return { subject: parts[0].trim(), activity: parts.slice(1).join(' - ').trim() };
  return { subject: s, activity: '' };
}
// Summarize distinct subjects/activities for the preview/mapping step.
function summarize(events, mode = 'auto') {
  const subjects = {}, activities = {};
  for (const e of events) { const { subject, activity } = splitSummary(e.summary, mode), d = (new Date(e.end) - new Date(e.start)) / 1000;
    const sk = subject || e.categories || '(none)'; (subjects[sk] ||= { count: 0, secs: 0 }).count++; subjects[sk].secs += d;
    if (activity) { (activities[activity] ||= { count: 0, secs: 0 }).count++; activities[activity].secs += d; } }
  return { subjects, activities };
}
module.exports = { unfold, parseLine, parseDateValue, parseDuration, parseICS, splitSummary, summarize, zonedToUtc, tzOffset };
