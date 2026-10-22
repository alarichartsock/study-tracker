'use strict';
const crypto = require('crypto');
const KEYLEN = 64, OPTS = { N: 16384, r: 8, p: 1 };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(password), salt, KEYLEN, OPTS, (e, k) => (e ? reject(e) : resolve({ salt, hash: k.toString('hex') }))));
}
async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const r = await hashPassword(password, salt);
  const a = Buffer.from(r.hash, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const newToken = () => crypto.randomBytes(32).toString('hex');
const tokenKey = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(); if (k) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); } }
  }
  return out;
}

class RateLimiter {
  constructor(max = 5, windowMs = 15 * 60e3, now = () => Date.now()) { this.max = max; this.windowMs = windowMs; this.now = now; this.hits = new Map(); }
  blocked(key) { const h = this.hits.get(key); if (!h) return false; if (this.now() - h.first > this.windowMs) { this.hits.delete(key); return false; } return h.count >= this.max; }
  fail(key) { const n = this.now(), h = this.hits.get(key); if (!h || n - h.first > this.windowMs) this.hits.set(key, { first: n, count: 1 }); else h.count++; }
  reset(key) { this.hits.delete(key); }
}

const validUsername = u => typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(u);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 200;

module.exports = { hashPassword, verifyPassword, newToken, tokenKey, parseCookies, RateLimiter, validUsername, validPassword };
