'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const ics = require('../lib/ics'), ical = require('../lib/ical');
const { blankUserData } = require('../lib/store');
const CAL = ev => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' + ev.join('\r\n') + '\r\nEND:VCALENDAR\r\n';

test('parses UTC, TZID (incl. DST), floating times and folded lines', () => {
  const r = ics.parseICS(CAL([
    'BEGIN:VEVENT', 'UID:u1', 'DTSTART:20261020T070000Z', 'DTEND:20261020T083000Z', 'SUMMARY:Bio/Biochem - Flash', ' cards', 'DESCRIPTION:Line 1\\nLine 2\\, ok', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:u2', 'DTSTART;TZID=Europe/Berlin:20260115T090000', 'DTEND;TZID=Europe/Berlin:20260115T100000', 'SUMMARY:CARS', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:u3', 'DTSTART;TZID="America/New_York":20260710T090000', 'DURATION:PT45M', 'SUMMARY:Psych', 'BEGIN:VALARM', 'TRIGGER:-PT5M', 'SUMMARY:alarm', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:u4', 'DTSTART;TZID=W. Europe Standard Time:20260710T090000', 'DTEND;TZID=W. Europe Standard Time:20260710T091500', 'SUMMARY:x', 'END:VEVENT',
  ]));
  assert.equal(r.events.length, 4);
  assert.equal(r.events[0].summary, 'Bio/Biochem - Flashcards'); assert.equal(r.events[0].description, 'Line 1\nLine 2, ok'); assert.equal(r.events[0].start, '2026-10-20T07:00:00.000Z');
  assert.equal(r.events[1].start, '2026-01-15T08:00:00.000Z'); // CET = UTC+1
  assert.equal(r.events[2].start, '2026-07-10T13:00:00.000Z'); assert.equal(r.events[2].end, '2026-07-10T13:45:00.000Z'); assert.equal(r.events[2].summary, 'Psych'); // EDT, VALARM ignored
  assert.equal(r.events[3].start, '2026-07-10T07:00:00.000Z'); // Windows zone name mapped
});
test('skips all-day and invalid events', () => {
  const r = ics.parseICS(CAL(['BEGIN:VEVENT', 'UID:a', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261021', 'SUMMARY:Exam day', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'DTSTART:20261020T100000Z', 'DTEND:20261020T090000Z', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:c', 'SUMMARY:no dates', 'END:VEVENT']));
  assert.equal(r.events.length, 0); assert.deepEqual(r.skipped, { allDay: 1, invalid: 2 });
});
test('parseLine handles quoted params with colons', () => {
  assert.deepEqual(ics.parseLine('DTSTART;TZID="Etc/GMT+1:x":20260101T000000'), { name: 'DTSTART', params: { TZID: 'Etc/GMT+1:x' }, value: '20260101T000000' });
});
test('duration parsing', () => { assert.equal(ics.parseDuration('PT1H30M'), 5400); assert.equal(ics.parseDuration('P1DT2H'), 93600); assert.ok(Number.isNaN(ics.parseDuration('x'))); });
test('summary split heuristics and summarize', () => {
  assert.deepEqual(ics.splitSummary('CARS - Practice questions'), { subject: 'CARS', activity: 'Practice questions' });
  assert.deepEqual(ics.splitSummary('Biology (Flashcards)'), { subject: 'Biology', activity: 'Flashcards' });
  assert.deepEqual(ics.splitSummary('Chem/Phys'), { subject: 'Chem/Phys', activity: '' });
  assert.deepEqual(ics.splitSummary('A - B', 'subject'), { subject: 'A - B', activity: '' });
  assert.deepEqual(ics.splitSummary('A - B', 'activity'), { subject: '', activity: 'A - B' });
  const s = ics.summarize([{ summary: 'CARS - Q', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' }, { summary: 'CARS', start: '2026-01-02T00:00:00Z', end: '2026-01-02T00:30:00Z' }]);
  assert.deepEqual(s.subjects.CARS, { count: 2, secs: 5400 }); assert.equal(s.activities.Q.count, 1);
});
test('ical export is valid and round-trips through the parser', () => {
  const ud = blankUserData(); ud.sessions = [{ id: 1, subject: 'CARS', activity: 'Passages', note: 'semi;colon, comma', start: '2026-10-20T16:00:00.000Z', end: '2026-10-20T17:00:00.000Z' }];
  ud.exams = [{ id: 2, name: 'MCAT', date: '2027-01-15' }]; ud.tasks = [{ id: 3, title: 'AAMC FL1', due: '2026-11-01', done: false }];
  const out = ical.toICS(ud, { name: 'x'.repeat(100) });
  assert.match(out, /^BEGIN:VCALENDAR\r\n/); assert.ok(out.split('\r\n').every(l => l.length <= 75));
  const back = ics.parseICS(out); assert.equal(back.events.length, 1); assert.equal(back.events[0].summary, 'CARS · Passages'); assert.equal(back.events[0].description, 'semi;colon, comma'); assert.equal(back.skipped.allDay, 2);
});
