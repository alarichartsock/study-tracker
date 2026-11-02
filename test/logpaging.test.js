'use strict';
const test = require('node:test'), assert = require('node:assert');
const { createLogger } = require('../lib/reqlog');
test('log query pages newest-first over all matches with offset/limit and total', () => {
  const L = createLogger({ stdout: false }), t0 = Date.now() - 1e6;
  for (let i = 0; i < 250; i++) L.record({ t: new Date(t0 + i * 1000).toISOString(), id: 'e' + i, status: i % 5 ? 200 : 404, path: '/p' + i, method: 'GET' });
  const p1 = L.query({}, 100), p3 = L.query({ offset: 200 }, 100);
  assert.equal(p1.total, 250); assert.equal(p1.offset, 0); assert.equal(p1.events[0].id, 'e249'); assert.equal(p1.events.length, 100);
  assert.equal(p3.events.length, 50); assert.equal(p3.events.at(-1).id, 'e0');
  const f = L.query({ status: '404', offset: 10 }, 20); assert.equal(f.total, 50); assert.equal(f.events.length, 20); assert.ok(f.events.every(e => e.status === 404)); assert.equal(f.events[0].id, 'e195');
  assert.equal(L.query({ offset: 9999 }, 10).events.length, 0); assert.equal(L.query({ offset: -5 }, 10).offset, 0);
});
test('admin UI has a pager and pins pages', () => {
  const s = require('fs').readFileSync(__dirname + '/../public/app.js', 'utf8');
  assert.match(s, /ACT\.logPg = /); assert.match(s, /offset: String\(\(pg - 1\) \* PS\)/); assert.match(s, /\(pts\|limit\|offset\)/);
});
