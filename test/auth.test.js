'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const auth = require('../lib/auth');

test('hashPassword uses a random per-user salt and verifies', async () => {
  const a = await auth.hashPassword('correct horse'), b = await auth.hashPassword('correct horse');
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.hash, b.hash); assert.equal(a.hash.length, 128);
  assert.equal(await auth.verifyPassword('correct horse', a.salt, a.hash), true);
  assert.equal(await auth.verifyPassword('wrong horse', a.salt, a.hash), false);
  assert.equal(await auth.verifyPassword('correct horse', '', ''), false);
});
test('same salt gives deterministic hash', async () => {
  assert.equal((await auth.hashPassword('pw', 'abc')).hash, (await auth.hashPassword('pw', 'abc')).hash);
});
test('tokens are random and stored only as sha256', () => {
  const t1 = auth.newToken(), t2 = auth.newToken();
  assert.match(t1, /^[0-9a-f]{64}$/); assert.notEqual(t1, t2);
  assert.notEqual(auth.tokenKey(t1), t1); assert.equal(auth.tokenKey(t1), auth.tokenKey(t1));
});
test('parseCookies', () => {
  assert.deepEqual(auth.parseCookies('a=1; sid=abc%20d; bad; =x'), { a: '1', sid: 'abc d' });
  assert.deepEqual(auth.parseCookies(undefined), {});
});
test('RateLimiter blocks after max failures and expires', () => {
  let now = 0; const rl = new auth.RateLimiter(3, 1000, () => now);
  for (let i = 0; i < 3; i++) { assert.equal(rl.blocked('k'), false); rl.fail('k'); }
  assert.equal(rl.blocked('k'), true); assert.equal(rl.blocked('other'), false);
  now = 1001; assert.equal(rl.blocked('k'), false);
  rl.fail('k'); rl.reset('k'); assert.equal(rl.blocked('k'), false);
});
test('username/password validation', () => {
  assert.ok(auth.validUsername('alaric_h')); assert.ok(!auth.validUsername('ab')); assert.ok(!auth.validUsername('a b c'));
  assert.ok(auth.validPassword('12345678')); assert.ok(!auth.validPassword('short')); assert.ok(!auth.validPassword(undefined));
});
