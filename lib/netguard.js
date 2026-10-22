'use strict';
// SSRF-safe HTTPS fetch for user-supplied feed URLs: https only, public IPs only (checked at connect time,
// so DNS rebinding can't swap in a private address), size + time capped, limited redirects re-validated each hop.
const https = require('https'), dns = require('dns'), net = require('net');

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); if (m) return isPrivateIP(m[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
  }
  return true; // unknown -> block
}
function normalizeFeedUrl(input) {
  let s = String(input || '').trim(); if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:/i, 'https:');
  let u; try { u = new URL(s); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'https:') throw new Error('Only https:// (or webcal://) feed URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  if (u.port && u.port !== '443') throw new Error('Only the default HTTPS port is allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateIP(host)) throw new Error('Private or local addresses are not allowed');
  if (/^(localhost|.*\.local|.*\.internal|.*\.ts\.net)$/i.test(host)) throw new Error('Private or local addresses are not allowed');
  return u;
}
function guardedLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find(a => isPrivateIP(a.address)); if (bad || !addrs.length) return cb(new Error('Private or local addresses are not allowed'));
    if (opts && opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}
function safeFetchText(input, { maxBytes = 5 * 1024 * 1024, timeoutMs = 10000, maxRedirects = 3, lookup = guardedLookup } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = normalizeFeedUrl(input); } catch (e) { return reject(e); }
    const req = https.get(u, { lookup, timeout: timeoutMs, headers: { 'User-Agent': 'mcat-tracker-feed-import', Accept: 'text/calendar, text/plain, */*' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        return safeFetchText(new URL(res.headers.location, u).toString(), { maxBytes, timeoutMs, maxRedirects: maxRedirects - 1, lookup }).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('Feed returned HTTP ' + res.statusCode)); }
      let size = 0; const chunks = [];
      res.on('data', c => { size += c.length; if (size > maxBytes) { req.destroy(); reject(new Error('Feed is too large')); } else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Feed request timed out')));
    req.on('error', reject);
    setTimeout(() => req.destroy(new Error('Feed request timed out')), timeoutMs + 1000).unref();
  });
}
module.exports = { isPrivateIP, normalizeFeedUrl, guardedLookup, safeFetchText };
