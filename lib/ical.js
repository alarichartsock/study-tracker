'use strict';
// Minimal RFC 5545 iCalendar feed of study sessions, exams and tasks with due dates.
const fold = line => { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); };
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = k => String(k).replace(/-/g, '');
function toICS(ud, { name = 'MCAT study', now = new Date() } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mcat-tracker//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + esc(name)];
  for (const s of ud.sessions) L.push('BEGIN:VEVENT', `UID:session-${s.id}@mcat-tracker`, 'DTSTAMP:' + utc(now), 'DTSTART:' + utc(s.start), 'DTEND:' + utc(s.end),
    'SUMMARY:' + esc(s.subject + (s.activity ? ' · ' + s.activity : '')), ...(s.note ? ['DESCRIPTION:' + esc(s.note)] : []), 'END:VEVENT');
  for (const e of ud.exams || []) if (e.date) L.push('BEGIN:VEVENT', `UID:exam-${e.id}@mcat-tracker`, 'DTSTAMP:' + utc(now), 'DTSTART;VALUE=DATE:' + dateOnly(e.date),
    'SUMMARY:' + esc('Exam: ' + e.name), 'END:VEVENT');
  for (const t of ud.tasks || []) if (t.due && !t.done) L.push('BEGIN:VEVENT', `UID:task-${t.id}@mcat-tracker`, 'DTSTAMP:' + utc(now), 'DTSTART;VALUE=DATE:' + dateOnly(t.due),
    'SUMMARY:' + esc('To-do: ' + t.title), 'END:VEVENT');
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
module.exports = { toICS };
