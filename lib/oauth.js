'use strict';
// Social sign-in (OAuth 2.0 / OpenID Connect) for Apple, Google, GitHub and Microsoft with no dependencies:
// PKCE + state + nonce from node:crypto, ID tokens verified against each provider's JWKS.
// Configure with environment variables or a gitignored oauth.config.json (see docs/social-sign-in.md).
const crypto = require('crypto'), fs = require('fs');

const b64u = b => Buffer.from(b).toString('base64url');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const pkce = () => { const verifier = rand(48); return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) }; };
const MS_CONSUMER_TID = '9188040d-6c67-4c5b-b112-36a304b66dad'; // personal Microsoft accounts (email is verified by Microsoft)

const PROVIDERS = {
  google: { label: 'Google', oidc: true, auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs', iss: ['https://accounts.google.com', 'accounts.google.com'], scope: 'openid email profile', pkce: true },
  microsoft: { label: 'Microsoft', oidc: true, auth: c => `https://login.microsoftonline.com/${c.tenant || 'common'}/oauth2/v2.0/authorize`,
    token: c => `https://login.microsoftonline.com/${c.tenant || 'common'}/oauth2/v2.0/token`, jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    iss: (claims) => [`https://login.microsoftonline.com/${claims.tid}/v2.0`], scope: 'openid email profile', pkce: true },
  apple: { label: 'Apple', oidc: true, auth: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token',
    jwks: 'https://appleid.apple.com/auth/keys', iss: ['https://appleid.apple.com'], scope: 'name email', formPost: true, pkce: false },
  github: { label: 'GitHub', oidc: false, auth: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', scope: 'read:user user:email', pkce: true }
};

// ---- configuration ----
function loadConfig(env = process.env, file) {
  let f = {}; if (file && fs.existsSync(file)) f = JSON.parse(fs.readFileSync(file, 'utf8'));
  const g = (k, d) => env[k] ?? f[k] ?? d;
  let appleKey = g('APPLE_PRIVATE_KEY'); const akf = g('APPLE_PRIVATE_KEY_FILE'); if (!appleKey && akf && fs.existsSync(akf)) appleKey = fs.readFileSync(akf, 'utf8');
  if (appleKey) appleKey = appleKey.replace(/\\n/g, '\n');
  const base = String(g('OAUTH_BASE_URL', '') || '').replace(/\/+$/, '');
  const c = { base, providers: {} };
  const add = (p, o) => { if (base && Object.values(o).every(Boolean)) c.providers[p] = o; };
  add('google', { clientId: g('GOOGLE_CLIENT_ID'), clientSecret: g('GOOGLE_CLIENT_SECRET') });
  add('github', { clientId: g('GITHUB_CLIENT_ID'), clientSecret: g('GITHUB_CLIENT_SECRET') });
  add('microsoft', { clientId: g('MICROSOFT_CLIENT_ID'), clientSecret: g('MICROSOFT_CLIENT_SECRET') }); if (c.providers.microsoft) c.providers.microsoft.tenant = g('MICROSOFT_TENANT', 'common');
  add('apple', { clientId: g('APPLE_SERVICES_ID'), teamId: g('APPLE_TEAM_ID'), keyId: g('APPLE_KEY_ID'), privateKey: appleKey });
  return c;
}
const redirectUri = (cfg, p) => `${cfg.base}/api/oauth/${p}/callback`;

// ---- JWT ----
function decodeJwt(t) {
  const parts = String(t || '').split('.'); if (parts.length !== 3) throw new Error('malformed token');
  const [h, p] = parts.slice(0, 2).map(s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')));
  return { header: h, payload: p, signed: parts[0] + '.' + parts[1], sig: Buffer.from(parts[2], 'base64url') };
}
class Jwks {
  constructor(fetchFn = fetch, now = () => Date.now()) { this.fetch = fetchFn; this.now = now; this.cache = new Map(); }
  async keys(url, force) { const c = this.cache.get(url); if (c && !force && this.now() - c.at < 3600e3) return c.keys;
    const r = await this.fetch(url); if (!r.ok) throw new Error('JWKS fetch failed'); const keys = (await r.json()).keys || []; this.cache.set(url, { at: this.now(), keys }); return keys; }
  async key(url, kid) { let k = (await this.keys(url)).find(x => x.kid === kid); if (!k) { const c = this.cache.get(url); if (!c || this.now() - (c.refetched || 0) > 60e3) { k = (await this.keys(url, true)).find(x => x.kid === kid); this.cache.get(url).refetched = this.now(); } }
    if (!k) throw new Error('unknown signing key'); return crypto.createPublicKey({ key: k, format: 'jwk' }); }
}
const ALGS = { RS256: ['RSA-SHA256', {}], ES256: ['sha256', { dsaEncoding: 'ieee-p1363' }] };
// verify signature + iss/aud/exp/iat/nonce; returns claims
async function verifyIdToken(token, { jwks, jwksUrl, iss, aud, nonce, now = Date.now(), skewSec = 120 }) {
  const t = decodeJwt(token), alg = ALGS[t.header.alg]; if (!alg) throw new Error('unsupported alg ' + t.header.alg);
  const key = await jwks.key(jwksUrl, t.header.kid);
  if (!crypto.verify(alg[0], Buffer.from(t.signed), { key, ...alg[1] }, t.sig)) throw new Error('bad signature');
  const c = t.payload, s = Math.floor(now / 1000), issuers = typeof iss === 'function' ? iss(c) : iss;
  if (!issuers.includes(c.iss)) throw new Error('bad issuer');
  if (!(Array.isArray(c.aud) ? c.aud.includes(aud) : c.aud === aud)) throw new Error('bad audience');
  if (typeof c.exp !== 'number' || c.exp + skewSec < s) throw new Error('token expired');
  if (typeof c.iat === 'number' && c.iat - skewSec > s) throw new Error('token issued in the future');
  if (nonce !== undefined && c.nonce !== nonce) throw new Error('bad nonce');
  if (!c.sub) throw new Error('missing subject');
  return c;
}
// Apple's client_secret: an ES256 JWT signed with the .p8 key (valid up to 6 months; we mint 5-minute ones)
function appleClientSecret({ teamId, clientId, keyId, privateKey }, now = Date.now()) {
  const iat = Math.floor(now / 1000), h = b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })), p = b64u(JSON.stringify({ iss: teamId, iat, exp: iat + 300, aud: 'https://appleid.apple.com', sub: clientId }));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return h + '.' + p + '.' + b64u(sig);
}
const truthy = v => v === true || v === 'true';

// ---- flow ----
class OAuth {
  constructor(cfg, { fetchFn = fetch, now = () => Date.now() } = {}) { this.cfg = cfg; this.fetch = fetchFn; this.now = now; this.jwks = new Jwks(fetchFn, now); this.pending = new Map(); }
  enabled() { return Object.keys(this.cfg.providers); }
  start(p) {
    const P = PROVIDERS[p], c = this.cfg.providers[p]; if (!P || !c) throw new Error('provider not configured');
    for (const [k, v] of this.pending) if (this.now() - v.at > 10 * 60e3) this.pending.delete(k);
    const state = rand(), nonce = rand(), { verifier, challenge } = pkce(), bind = rand();
    this.pending.set(state, { p, nonce, verifier, bind, at: this.now() });
    const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirectUri(this.cfg, p), response_type: 'code', scope: P.scope, state });
    if (P.oidc) q.set('nonce', nonce); if (P.pkce) { q.set('code_challenge', challenge); q.set('code_challenge_method', 'S256'); }
    if (P.formPost) q.set('response_mode', 'form_post'); if (p === 'google') q.set('prompt', 'select_account');
    const auth = typeof P.auth === 'function' ? P.auth(c) : P.auth;
    return { url: auth + '?' + q, state, bind };
  }
  // params: query (GET) or form body (Apple form_post). bind: value of the browser-binding cookie.
  async callback(p, params, bind) {
    const P = PROVIDERS[p], c = this.cfg.providers[p]; if (!P || !c) throw new Error('provider not configured');
    if (params.error) throw new Error('Sign-in was cancelled');
    const st = this.pending.get(params.state); this.pending.delete(params.state);
    if (!st || st.p !== p || this.now() - st.at > 10 * 60e3) throw new Error('Sign-in expired, please try again');
    if (!bind || !crypto.timingSafeEqual(Buffer.from(String(bind).padEnd(64).slice(0, 64)), Buffer.from(st.bind.padEnd(64).slice(0, 64)))) throw new Error('Sign-in session mismatch, please try again');
    if (!params.code) throw new Error('missing code');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: params.code, redirect_uri: redirectUri(this.cfg, p), client_id: c.clientId,
      client_secret: p === 'apple' ? appleClientSecret(c, this.now()) : c.clientSecret });
    if (P.pkce) body.set('code_verifier', st.verifier);
    const tokenUrl = typeof P.token === 'function' ? P.token(c) : P.token;
    const r = await this.fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() });
    const tok = await r.json().catch(() => ({})); if (!r.ok || tok.error) throw new Error('Token exchange failed');
    if (p === 'github') return this.github(tok.access_token);
    const cl = await verifyIdToken(tok.id_token, { jwks: this.jwks, jwksUrl: P.jwks, iss: P.iss, aud: c.clientId, nonce: st.nonce, now: this.now() });
    const id = { provider: p, sub: String(cl.sub), email: cl.email ? String(cl.email).toLowerCase() : null, emailVerified: false, name: cl.name || null };
    if (p === 'google') id.emailVerified = truthy(cl.email_verified);
    if (p === 'microsoft') { id.email = (cl.email || '').toLowerCase() || null; id.emailVerified = !!id.email && (cl.tid === MS_CONSUMER_TID || truthy(cl.xms_edov)); id.sub = cl.tid + ':' + cl.oid; }
    if (p === 'apple') { id.emailVerified = truthy(cl.email_verified); id.privateRelay = truthy(cl.is_private_email) || /@privaterelay\.appleid\.com$/i.test(id.email || '');
      // Apple sends the user's name only on the very first authorization, as a JSON form field
      try { const u = params.user ? JSON.parse(params.user) : null; const n = u && u.name ? [u.name.firstName, u.name.lastName].filter(Boolean).join(' ') : ''; if (n) id.name = n; } catch { /* ignore */ } }
    return id;
  }
  async github(at) {
    if (!at) throw new Error('Token exchange failed');
    const h = { Authorization: 'Bearer ' + at, Accept: 'application/vnd.github+json', 'User-Agent': 'study-tracker' };
    const u = await (await this.fetch('https://api.github.com/user', { headers: h })).json();
    const emails = await (await this.fetch('https://api.github.com/user/emails', { headers: h })).json().catch(() => []);
    const best = (Array.isArray(emails) ? emails : []).filter(e => e.verified).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))[0];
    if (!u || u.id == null) throw new Error('GitHub profile unavailable');
    return { provider: 'github', sub: String(u.id), email: best ? best.email.toLowerCase() : null, emailVerified: !!best, name: u.name || u.login || null, login: u.login };
  }
}
module.exports = { OAuth, PROVIDERS, loadConfig, redirectUri, verifyIdToken, appleClientSecret, decodeJwt, Jwks, pkce, MS_CONSUMER_TID };
