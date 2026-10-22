'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const c = require('../lib/csv');
const L = (y, m, d, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s).toISOString();

test('parseCSV handles quotes, CRLF, BOM and ; separator', () => {
  assert.deepEqual(c.parseCSV('\uFEFFa,b\r\n"x, y","he said ""hi"""\r\n\r\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(c.parseCSV('Datum;Dauer\n20.10.2026;1:30'), [['Datum', 'Dauer'], ['20.10.2026', '1:30']]);
  assert.deepEqual(c.parseCSV('a,b\n"multi\nline",2'), [['a', 'b'], ['multi\nline', '2']]);
});
test('parseDuration formats', () => {
  assert.equal(c.parseDuration('1:30'), 5400);
  assert.equal(c.parseDuration('0:45:30'), 2730);
  assert.equal(c.parseDuration('1h 30m'), 5400);
  assert.equal(c.parseDuration('2 hours'), 7200);
  assert.equal(c.parseDuration('90 min'), 5400);
  assert.equal(c.parseDuration('45'), 2700);
  assert.equal(c.parseDuration('1,5h'), 5400);
  assert.ok(Number.isNaN(c.parseDuration(''))); assert.ok(Number.isNaN(c.parseDuration('abc')));
});
test('toDate date formats', () => {
  assert.equal(c.toDate('2026-10-20', '09:05').toISOString(), L(2026, 10, 20, 9, 5));
  assert.equal(c.toDate('20.10.2026', '14:00').toISOString(), L(2026, 10, 20, 14));   // dd.mm.yyyy
  assert.equal(c.toDate('10/20/2026', '2:30 PM').toISOString(), L(2026, 10, 20, 14, 30)); // US
  assert.equal(c.toDate('10/20/2026', '12:15 am').toISOString(), L(2026, 10, 20, 0, 15));
  assert.equal(c.toDate('', '2026-10-20 08:00:00').toISOString(), L(2026, 10, 20, 8));
  assert.equal(c.toDate('2026-10-20T08:00:00Z').toISOString(), '2026-10-20T08:00:00.000Z');
  assert.equal(c.toDate('2026-10-20').toISOString(), L(2026, 10, 20));
  assert.equal(c.toDate('31.02.2026'), null); assert.equal(c.toDate('nonsense', '10:00'), null); assert.equal(c.toDate('', ''), null);
  assert.equal(c.toDate('2026-10-20', '25:00'), null);
});
test('mapColumns auto-detect and explicit mapping', () => {
  assert.deepEqual(c.mapColumns(['Date', 'Start', 'End', 'Category', 'Comment']), { date: 0, start: 1, end: 2, duration: -1, subject: 3, note: 4 });
  assert.deepEqual(c.mapColumns(['Start date', 'Date', 'Dauer', 'Kategorie']), { date: 1, start: 0, end: -1, duration: 2, subject: 3, note: -1 });
  const m = c.mapColumns(['When', 'Mins', 'What'], { date: 'when', duration: 'Mins', subject: 'what' });
  assert.equal(m.date, 0); assert.equal(m.duration, 1); assert.equal(m.subject, 2);
});
test('csvToSessions with start/end, overnight and duration columns', () => {
  const r = c.csvToSessions('Date,Start,End,Duration,Category,Note\n2026-10-20,09:00,10:30,,CARS,passages\n2026-10-20,23:30,00:30,,Bio/Biochem,\n2026-10-21,08:00,,1:15,Psych/Soc,\n2026-10-22,,,,Chem/Phys,');
  assert.equal(r.sessions.length, 3); assert.equal(r.skipped, 1);
  assert.deepEqual(r.sessions[0], { subject: 'CARS', note: 'passages', start: L(2026, 10, 20, 9), end: L(2026, 10, 20, 10, 30) });
  assert.equal(r.sessions[1].end, L(2026, 10, 21, 0, 30));
  assert.equal(r.sessions[2].end, L(2026, 10, 21, 9, 15));
  assert.equal(r.columns.subject, 'Category');
});
test('empty End with no duration is skipped, not a fake midnight session (regression)', () => {
  const r = c.csvToSessions('Date,Start,End,Category\n21.10.2026,14:00,,Bio/Biochem');
  assert.equal(r.sessions.length, 0); assert.equal(r.skipped, 1);
});
test('hours column with bare number is hours; missing subject gets default; >24h skipped', () => {
  const r = c.csvToSessions('Day;Hours;Note\n20.10.2026;1,5;x\n21.10.2026;30;too long');
  assert.equal(r.sessions.length, 1); assert.equal(r.skipped, 1);
  assert.equal(new Date(r.sessions[0].end) - new Date(r.sessions[0].start), 5400e3);
  assert.equal(r.sessions[0].subject, 'Imported');
});
test('empty / header-only input', () => {
  assert.deepEqual(c.csvToSessions('').sessions, []); assert.deepEqual(c.csvToSessions('Date,Start').sessions, []);
});
test('sessionsToCSV round-trips through csvToSessions', () => {
  const s = [{ subject: 'CARS, hard', note: 'said "hi"', start: L(2026, 10, 20, 9), end: L(2026, 10, 20, 10) }];
  const out = c.sessionsToCSV(s);
  assert.match(out, /^date,start,end,duration_min,subject,note\n/); assert.match(out, /"CARS, hard"/);
  const back = c.csvToSessions(out);
  assert.equal(back.sessions[0].subject, 'CARS, hard'); assert.equal(back.sessions[0].note, 'said "hi"'); assert.equal(back.sessions[0].start, s[0].start);
});
