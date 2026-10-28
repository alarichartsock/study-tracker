'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const { verifyIdToken, appleClientSecret, decodeJwt, Jwks, pkce, loadConfig, OAuth, MS_CONSUMER_TID } = require('../lib/oauth');
const { createApp } = require('../server');

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), KID = 'k1';
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (claims, { kid = KID, key = rsa.privateKey } = {}) => { const h = b64({ alg: 'RS256', kid, typ: 'JWT' }), p = b64(claims); return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url'); };
const now = Date.now(), S = Math.floor(now / 1000);
const json = (o, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => o });
const mockJwks = (keys = [jwk]) => { let calls = 0; return { j: new Jwks(async () => { calls++; return json({ keys }); }), calls: () => calls }; };
const base = { iss: 'https://accounts.google.com', aud: 'cid', sub: '123', exp: S + 600, iat: S, nonce: 'n1' };
const opts = j => ({ jwks: j, jwksUrl: 'https://x/jwks', iss: ['https://accounts.google.com'], aud: 'cid', nonce: 'n1', now });

test('ID token verification against a mocked JWKS', async () => {
  const { j, calls } = mockJwks();
  assert.equal((await verifyIdToken(sign(base), opts(j))).sub, '123');
  await verifyIdToken(sign(base), opts(j)); assert.equal(calls(), 1, 'JWKS cached');
  const bad = [[{ ...base, aud: 'other' }, /audience/], [{ ...base, iss: 'https://evil' }, /issuer/], [{ ...base, exp: S - 3600 }, /expired/], [{ ...base, nonce: 'x' }, /nonce/], [{ ...base, iat: S + 3600 }, /future/]];
  for (const [c, re] of bad) await assert.rejects(verifyIdToken(sign(c), opts(j)), re);
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(verifyIdToken(sign(base, { key: other.privateKey }), opts(j)), /signature/);
  const t = sign(base).split('.'); t[1] = b64({ ...base, sub: 'admin' }); await assert.rejects(verifyIdToken(t.join('.'), opts(j)), /signature/, 'tampered payload');
  await assert.rejects(verifyIdToken(sign(base, { kid: 'nope' }), opts(j)), /unknown signing key/);
  const h = b64({ alg: 'none', kid: KID }); await assert.rejects(verifyIdToken(h + '.' + b64(base) + '.', opts(j)), /unsupported alg/);
});

test('JWKS refetches once for a rotated key', async () => {
  let keys = []; const j = new Jwks(async () => json({ keys }), () => now);
  await j.keys('https://x/jwks'); keys = [jwk];
  assert.equal((await verifyIdToken(sign(base), opts(j))).sub, '123');
});

test('Microsoft issuer is checked against the tenant in the token', async () => {
  const { j } = mockJwks(), iss = c => [`https://login.microsoftonline.com/${c.tid}/v2.0`];
  const c = { ...base, tid: MS_CONSUMER_TID, iss: `https://login.microsoftonline.com/${MS_CONSUMER_TID}/v2.0` };
  assert.ok(await verifyIdToken(sign(c), { ...opts(j), iss }));
  await assert.rejects(verifyIdToken(sign({ ...c, iss: 'https://login.microsoftonline.com/other/v2.0' }), { ...opts(j), iss }), /issuer/);
});

test('Apple client secret is a valid ES256 JWT; PKCE challenge is S256 of the verifier', () => {
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const t = appleClientSecret({ teamId: 'TEAM123456', clientId: 'com.example.web', keyId: 'KEY1234567', privateKey: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }) }, now);
  const d = decodeJwt(t); assert.deepEqual(d.header, { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
  assert.equal(d.payload.iss, 'TEAM123456'); assert.equal(d.payload.sub, 'com.example.web'); assert.equal(d.payload.aud, 'https://appleid.apple.com'); assert.ok(d.payload.exp > d.payload.iat);
  assert.equal(d.sig.length, 64); assert.ok(crypto.verify('sha256', Buffer.from(d.signed), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, d.sig));
  const { verifier, challenge } = pkce(); assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
});

test('providers stay hidden until fully configured', () => {
  assert.deepEqual(loadConfig({}).providers, {});
  assert.deepEqual(Object.keys(loadConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }).providers), [], 'no base URL');
  const c = loadConfig({ OAUTH_BASE_URL: 'https://example.com/', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GITHUB_CLIENT_ID: 'x', APPLE_SERVICES_ID: 's', APPLE_TEAM_ID: 't', APPLE_KEY_ID: 'k' });
  assert.deepEqual(Object.keys(c.providers), ['google']); assert.equal(c.base, 'https://example.com');
});

// ---- full flows through the server with mocked provider endpoints ----
async function app(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-')), ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const cfg = loadConfig({ OAUTH_BASE_URL: 'https://study.example', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gs', GITHUB_CLIENT_ID: 'hid', GITHUB_CLIENT_SECRET: 'hs',
    APPLE_SERVICES_ID: 'com.example.web', APPLE_TEAM_ID: 'TEAM', APPLE_KEY_ID: 'KEY', APPLE_PRIVATE_KEY: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const st = { claims: {}, gh: {}, ghEmails: [], tokenCalls: [] };
  const fetchFn = async (url, o = {}) => {
    if (/jwks|certs|auth\/keys/.test(url)) return json({ keys: [jwk] });
    if (url.endsWith('access_token')) return json({ access_token: 'gh-at' });
    if (/token$/.test(url)) { const b = new URLSearchParams(o.body); st.tokenCalls.push(b); const iss = url.includes('apple') ? 'https://appleid.apple.com' : 'https://accounts.google.com';
      return json({ id_token: sign({ iss, aud: b.get('client_id'), exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), nonce: st.nonce, ...st.claims }) }); }
    if (url.endsWith('/user')) return json(st.gh);
    if (url.endsWith('/user/emails')) return json(st.ghEmails);
    throw new Error('unexpected fetch ' + url);
  };
  const server = createApp({ dataFile: path.join(dir, 'data.json'), oauth: cfg, fetch: fetchFn, quiet: true, ...extra });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const B = `http://127.0.0.1:${server.address().port}`;
  const signIn = async (p, { form, bindOverride, complete = {} } = {}) => {
    const s = await fetch(B + `/api/oauth/${p}/start`, { redirect: 'manual' }), loc = new URL(s.headers.get('location'));
    const bind = s.headers.get('set-cookie').match(/oa=([^;]+)/)[1]; st.nonce = loc.searchParams.get('nonce'); st.lastStart = loc;
    const q = { state: loc.searchParams.get('state'), code: 'c0de' }, cookie = 'oa=' + (bindOverride || bind);
    const r = form ? await fetch(B + `/api/oauth/${p}/callback`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ ...q, ...form }).toString() })
      : await fetch(B + `/api/oauth/${p}/callback?` + new URLSearchParams(q), { redirect: 'manual', headers: { Cookie: cookie } });
    let to = r.headers.get('location'), sc = r.headers.get('set-cookie') || '';
    if (to === '/?complete_signup=1') {
      const ps = sc.match(/ps=([^;]+)/)[1], c = await fetch(B + '/api/oauth/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'ps=' + ps }, body: JSON.stringify({ agree: true, birthYear: complete.birthYear ?? 1990, ...(complete.agree === false ? { agree: false } : {}) }) });
      const cj = await c.json(); st.lastComplete = { status: c.status, body: cj };
      if (c.ok) { to = '/?welcome=1'; sc = c.headers.get('set-cookie') || ''; } else { to = '/?oauth_error=' + encodeURIComponent(cj.error); sc = ''; }
    }
    const sid = sc.match(/sid=([^;]+)/); const me = sid ? await (await fetch(B + '/api/me', { headers: { Cookie: 'sid=' + sid[1] } })).json() : null;
    return { loc: to, me };
  };
  const register = (u, pw) => fetch(B + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw, agree: true, birthYear: 1990 }) });
  return { B, st, signIn, register, close: () => server.close() };
}

test('configured providers are listed; start uses PKCE, state, nonce; Apple uses form_post', async t => {
  const a = await app(); t.after(a.close);
  const me = await (await fetch(a.B + '/api/me')).json(); assert.deepEqual(me.oauth.map(x => x.id).sort(), ['apple', 'github', 'google']);
  await a.signIn('google'); const g = a.st.lastStart;
  assert.equal(g.searchParams.get('code_challenge_method'), 'S256'); assert.equal(g.searchParams.get('redirect_uri'), 'https://study.example/api/oauth/google/callback');
  assert.ok(a.st.tokenCalls.at(-1).get('code_verifier'));
  await a.signIn('apple', { form: {} }); assert.equal(a.st.lastStart.searchParams.get('response_mode'), 'form_post');
  assert.equal(decodeJwt(a.st.tokenCalls.at(-1).get('client_secret')).header.alg, 'ES256');
  assert.equal((await fetch(a.B + '/api/oauth/microsoft/start', { redirect: 'manual' })).headers.get('location'), '/?oauth_error=That%20sign-in%20option%20is%20not%20available');
});

test('new social user gets the tour; same identity signs back in to the same account', async t => {
  const a = await app(); t.after(a.close); await a.register('owner', 'pass-12345');
  a.st.claims = { sub: 'g-1', email: 'Ada@Example.com', email_verified: true, name: 'Ada L' };
  const r1 = await a.signIn('google'); assert.equal(r1.loc, '/?welcome=1'); assert.equal(r1.me.user.username, 'ada'); assert.equal(r1.me.user.displayName, 'Ada L');
  const r2 = await a.signIn('google'); assert.equal(r2.loc, '/'); assert.equal(r2.me.user.id, r1.me.user.id);
  const login = await fetch(a.B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ada', password: 'anything-long' }) });
  assert.equal(login.status, 401, 'social-only accounts have no password');
});

test('links to an existing account by verified email only', async t => {
  const a = await app(); t.after(a.close); await a.register('owner', 'pass-12345');
  a.st.gh = { id: 77, login: 'ada-gh', name: 'Ada' }; a.st.ghEmails = [{ email: 'ada@example.com', verified: true, primary: true }];
  const gh = await a.signIn('github'); assert.equal(gh.me.user.username, 'ada-gh');
  a.st.claims = { sub: 'g-2', email: 'ada@example.com', email_verified: true };
  const lk = await a.signIn('google'); assert.ok(lk.me, 'link ' + lk.loc); assert.equal(lk.me.user.id, gh.me.user.id, 'verified email links');
  a.st.claims = { sub: 'g-3', email: 'ada@example.com', email_verified: false };
  const u = await a.signIn('google'); assert.ok(u.me, 'g3 ' + u.loc); assert.notEqual(u.me.user.id, gh.me.user.id, 'unverified email never links'); assert.equal(u.loc, '/?welcome=1');
  a.st.gh = { id: 78, login: 'bob' }; a.st.ghEmails = [{ email: 'ada@example.com', verified: false, primary: true }];
  const b2 = await a.signIn('github'); assert.ok(b2.me, 'bob ' + b2.loc); assert.notEqual(b2.me.user.id, gh.me.user.id);
});

test('Apple: private relay email, name kept from the first sign-in only', async t => {
  const a = await app(); t.after(a.close); await a.register('owner', 'pass-12345');
  a.st.claims = { sub: 'apl-1', email: 'x7f9@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true' };
  const r1 = await a.signIn('apple', { form: { user: JSON.stringify({ name: { firstName: 'Grace', lastName: 'Hopper' } }) } });
  assert.equal(r1.loc, '/?welcome=1'); assert.equal(r1.me.user.displayName, 'Grace Hopper'); assert.ok(!/x7f9/.test(r1.me.user.username), 'relay address not used as username');
  const r2 = await a.signIn('apple', { form: {} }); assert.equal(r2.me.user.id, r1.me.user.id); assert.equal(r2.me.user.displayName, 'Grace Hopper');
});

test('rejects a forged state, a wrong browser binding, and sign-up floods', async t => {
  const a = await app(); t.after(a.close); await a.register('owner', 'pass-12345');
  a.st.claims = { sub: 'g-9', email: 'z@example.com', email_verified: true };
  assert.match((await a.signIn('google', { bindOverride: 'wrong' })).loc, /oauth_error=.*mismatch/);
  const bad = await fetch(a.B + '/api/oauth/google/callback?state=forged&code=x', { redirect: 'manual', headers: { Cookie: 'oa=x' } });
  assert.match(bad.headers.get('location'), /oauth_error=Sign-in%20expired/);
  const b = await app({ regMax: 1 }); t.after(b.close); await b.register('owner', 'pass-12345');
  b.st.claims = { sub: 'g-10', email: 'q@example.com', email_verified: true };
  assert.match((await b.signIn('google')).loc, /oauth_error=Too%20many/, 'social sign-up shares the sign-up rate limit');
});

test('social sign-up needs the clickwrap and age gate before any account exists; consent is logged', async t => {
  const a = await app(); t.after(a.close); await a.register('owner', 'pass-12345', true);
  a.st.claims = { sub: 'kid-1', email: 'kid@example.com', email_verified: true };
  const kid = await a.signIn('google', { complete: { birthYear: new Date().getUTCFullYear() - 10 } });
  assert.equal(a.st.lastComplete.status, 403); assert.equal(kid.me, null); assert.doesNotMatch(a.st.lastComplete.body.error, /13|age|old/i, 'neutral message');
  a.st.claims = { sub: 'nb-1', email: 'nb@example.com', email_verified: true };
  await a.signIn('google', { complete: { agree: false } }); assert.equal(a.st.lastComplete.status, 400);
  const ok = await a.signIn('google'); assert.equal(ok.loc, '/?welcome=1'); assert.ok(ok.me.user); assert.equal(ok.me.termsRequired, undefined);
});
