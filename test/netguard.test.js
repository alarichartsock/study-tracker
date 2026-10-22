'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const g = require('../lib/netguard');

test('isPrivateIP blocks loopback, private, link-local, CGNAT (Tailscale), ULA, mapped', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.184', '169.254.169.254', '100.96.98.48', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd7a:115c:a1e0::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1'])
    assert.equal(g.isPrivateIP(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) assert.equal(g.isPrivateIP(ip), false, ip);
  assert.equal(g.isPrivateIP('not-an-ip'), true);
});
test('normalizeFeedUrl: https/webcal only, no creds, no odd ports, no local names or IPs', () => {
  assert.equal(g.normalizeFeedUrl('webcal://athenify.io/feed/abc.ics').toString(), 'https://athenify.io/feed/abc.ics');
  for (const bad of ['http://athenify.io/x', 'file:///etc/passwd', 'ftp://x', 'https://user:pw@athenify.io/', 'https://athenify.io:8443/', 'https://localhost/x', 'https://127.0.0.1/x',
    'https://[::1]/x', 'https://192.168.0.1/x', 'https://box.tail1234.ts.net/x', 'https://printer.local/', 'not a url'])
    assert.throws(() => g.normalizeFeedUrl(bad), undefined, bad);
});
test('guardedLookup rejects hostnames resolving to private addresses', async () => {
  await assert.rejects(new Promise((res, rej) => g.guardedLookup('localhost', {}, (e, a) => (e ? rej(e) : res(a)))), /Private/);
});
test('safeFetchText refuses before connecting for blocked targets', async () => {
  await assert.rejects(g.safeFetchText('http://example.com/x.ics'), /https/);
  await assert.rejects(g.safeFetchText('https://10.0.0.1/x.ics'), /Private/);
  await assert.rejects(g.safeFetchText('https://localhost/x.ics'), /Private/);
  // a public-looking name that resolves to loopback is blocked at lookup time (DNS rebinding guard)
  const lookup = (h, o, cb) => g.guardedLookup('localhost', o, cb);
  await assert.rejects(g.safeFetchText('https://evil.example/x.ics', { lookup }), /Private/);
});
