'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), net = require('net'), os = require('os'), path = require('path');
const { createApp } = require('../server');
const ev = require('../lib/email-verify');
const mailer = require('../lib/mailer');
const reqlog = require('../lib/reqlog');

const L = { agree: true, birthYear: 1990, password: 'pass-12345' };

function tokenOf(msg) {
  const m = /[?&]token=([A-Za-z0-9_-]+)/.exec(msg.text || '');
  assert.ok(m, 'plain-text part includes the link');
  assert.match(msg.html || '', new RegExp(m[1]));
  return m[1];
}
async function start(mail, extra = {}) {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ev-')), 'data.json');
  const outbox = [];
  const mailerOpt = mail || { configured: true, provider: 'test', send: async msg => { outbox.push(msg); return { ok: true, sent: true, provider: 'test' }; } };
  const server = createApp({ dataFile, minSessionSec: 0, quiet: true, mailer: mailerOpt, ...extra });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { const c = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc && /^sid=/.test(sc)) c.cookie = sc.split(';')[0];
    const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* redirect has no body */ }
    return { status: r.status, body: json, headers: r.headers, text };
  }; c.cookie = ''; return c; };
  return { base, outbox, server, dataFile, client, close: () => new Promise(r => server.close(r)) };
}
function fakeSmtp() {
  const received = [];
  return new Promise(resolve => {
    const srv = net.createServer(sock => {
      sock.write('220 localhost ESMTP\r\n');
      let buf = '', mode = 'cmd', data = '';
      sock.on('data', chunk => {
        const s = chunk.toString();
        if (mode === 'data') { data += s; if (data.includes('\r\n.\r\n')) { received.push(data); sock.write('250 queued\r\n'); mode = 'cmd'; data = ''; } return; }
        buf += s; let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2); const up = line.toUpperCase();
          if (up.startsWith('EHLO') || up.startsWith('HELO')) sock.write('250-localhost\r\n250 AUTH PLAIN\r\n');
          else if (up.startsWith('AUTH PLAIN ')) sock.write('235 ok\r\n');
          else if (up.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
          else if (up.startsWith('RCPT TO')) sock.write('250 ok\r\n');
          else if (up === 'DATA') { sock.write('354 go\r\n'); mode = 'data'; }
          else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('500 no\r\n');
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, received, close: () => new Promise(r => srv.close(r)) }));
  });
}

test('a verification token is stored only as a hash, expires, and works once', () => {
  const user = { email: 'Ada@Example.com' }, t0 = 1_700_000_000_000;
  const token = ev.issue(user, t0);
  assert.equal(user.emailVerify.hash, ev.hashToken(token));
  assert.notEqual(user.emailVerify.hash, token);
  assert.ok(!JSON.stringify(user).includes(token));
  assert.equal(user.emailVerify.email, 'ada@example.com');
  const expired = { email: 'ada@example.com', emailVerify: { ...user.emailVerify } };
  assert.equal(ev.consume(expired, token, t0 + ev.TTL_MS).reason, 'expired');
  assert.ok(!expired.emailVerify);
  assert.equal(expired.emailVerified, undefined);
  assert.equal(ev.consume(user, token, t0 + ev.TTL_MS - 1).ok, true);
  assert.equal(user.emailVerified, true);
  assert.ok(user.emailVerifiedAt);
  assert.ok(!user.emailVerify);
  assert.equal(ev.consume(user, token, t0 + 1).reason, 'invalid');
});

test('a token bound to an old address does not verify a new one', () => {
  const user = { email: 'a@example.com' };
  const token = ev.issue(user);
  user.email = 'b@example.com';
  assert.equal(ev.consume(user, token).reason, 'invalid');
  assert.ok(!user.emailVerified);
  assert.ok(!user.emailVerify);
});

test('the message has a plain-text part and a branded HTML part', () => {
  const url = 'https://studyhertz.com/api/email/verify?token=abc_DEF-123';
  const msg = ev.message({ to: 'ada@example.com', url, username: 'ada', logoUrl: 'https://studyhertz.com/icon-192.png' });
  assert.equal(msg.subject, 'Verify your StudyHertz email');
  assert.match(msg.text, /ada@example.com/);
  assert.match(msg.text, /abc_DEF-123/);
  assert.doesNotMatch(msg.text, /<a |<html/i);
  assert.match(msg.html, /#6c8cff/);
  assert.match(msg.html, /#4c6ef5/);
  assert.match(msg.html, /#22c3a6/);
  assert.match(msg.html, /icon-192\.png/);
  assert.match(msg.html, /Verify email/);
  assert.match(msg.html, />Hi ada,</);
  const bad = ev.message({ to: 'a@b.co', url: 'https://x.test/v?token=abc', username: '<script>', logoUrl: 'https://x.test/i.png' });
  assert.match(bad.html, /&lt;script&gt;/);
  assert.doesNotMatch(bad.html, /<script>/);
});

test('sign-up sends one link; the verify endpoint is single-use; unverified users can sign in', async t => {
  const app = await start(); t.after(app.close);
  const a = app.client();
  const reg = await a('/api/register', 'POST', { ...L, username: 'ada', email: 'Ada@Example.com' });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.user.email, 'ada@example.com');
  assert.equal(reg.body.user.emailVerified, false);
  assert.equal(reg.body.verificationSent, true);
  assert.equal(app.outbox.length, 1);
  const token = tokenOf(app.outbox[0]);
  const row = app.server.store.db.users[0];
  assert.ok(!JSON.stringify(row).includes(token));
  assert.equal(row.emailVerify.hash, ev.hashToken(token));
  assert.equal((await a('/api/state')).status, 200); // using the app does not require a verified email
  const other = app.client();
  const login = await other('/api/login', 'POST', { username: 'ada', password: L.password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.emailVerified, false);
  assert.equal((await fetch(app.base + '/api/email/verify?token=not-a-real-token', { redirect: 'manual' })).headers.get('location'), '/?email=invalid');
  const hit = await fetch(app.base + '/api/email/verify?token=' + encodeURIComponent(token), { redirect: 'manual' });
  assert.equal(hit.status, 302);
  assert.equal(hit.headers.get('location'), '/?email=verified');
  assert.equal((await a('/api/me')).body.user.emailVerified, true);
  assert.ok(!app.server.store.db.users[0].emailVerify);
  const again = await fetch(app.base + '/api/email/verify?token=' + encodeURIComponent(token), { redirect: 'manual' });
  assert.equal(again.status, 302);
  assert.equal(again.headers.get('location'), '/?email=invalid');
  assert.equal((await a('/api/me')).body.user.emailVerified, true);
  const done = await a('/api/email/verify/resend', 'POST', {});
  assert.equal(done.status, 200);
  assert.equal(done.body.verified, true);
  assert.equal(done.body.sent, false);
  assert.equal(app.outbox.length, 1);
});

test('an expired link does not verify, and the hash still works after a restart', async t => {
  const app = await start();
  const a = app.client();
  await a('/api/register', 'POST', { ...L, username: 'ada', email: 'ada@example.com' });
  const token = tokenOf(app.outbox[0]);
  const file = app.dataFile;
  await app.close();
  const again = createApp({ dataFile: file, minSessionSec: 0, quiet: true, mailer: { configured: true, send: async () => ({ sent: false }) } });
  await new Promise(r => again.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => again.close(r)));
  const base = `http://127.0.0.1:${again.address().port}`;
  again.store.db.users[0].emailVerify.exp = Date.now() - 5;
  again.store.save();
  const hit = await fetch(base + '/api/email/verify?token=' + token, { redirect: 'manual' });
  assert.equal(hit.headers.get('location'), '/?email=expired');
  assert.equal(again.store.db.users[0].emailVerified, false);
  const second = await fetch(base + '/api/email/verify?token=' + token, { redirect: 'manual' });
  assert.equal(second.headers.get('location'), '/?email=invalid');
});

test('changing the email invalidates the previous link and sends a new one', async t => {
  const app = await start(); t.after(app.close);
  const a = app.client();
  await a('/api/register', 'POST', { ...L, username: 'ada', email: 'ada@example.com' });
  const first = tokenOf(app.outbox[0]);
  const ch = await a('/api/account/email', 'POST', { email: 'New@Example.com', password: L.password });
  assert.equal(ch.status, 200);
  assert.equal(ch.body.user.email, 'new@example.com');
  assert.equal(ch.body.user.emailVerified, false);
  assert.equal(ch.body.verificationSent, true);
  const second = tokenOf(app.outbox[1]);
  assert.notEqual(first, second);
  assert.equal((await fetch(app.base + '/api/email/verify?token=' + first, { redirect: 'manual' })).headers.get('location'), '/?email=invalid');
  assert.equal((await a('/api/me')).body.user.emailVerified, false);
  assert.equal((await fetch(app.base + '/api/email/verify?token=' + second, { redirect: 'manual' })).headers.get('location'), '/?email=verified');
  assert.equal((await a('/api/me')).body.user.email, 'new@example.com');
  assert.equal((await a('/api/me')).body.user.emailVerified, true);
});

test('resend is limited to 3 per hour and each send rotates the token', async t => {
  const app = await start(); t.after(app.close);
  const a = app.client();
  await a('/api/register', 'POST', { ...L, username: 'ada', email: 'ada@example.com' });
  assert.equal((await app.client()('/api/email/verify/resend', 'POST', {})).status, 401);
  for (let i = 0; i < 3; i++) {
    const r = await a('/api/email/verify/resend', 'POST', {});
    assert.equal(r.status, 200, 'resend ' + i);
    assert.equal(r.body.sent, true);
    assert.equal(r.body.user.emailVerified, false);
  }
  const blocked = await a('/api/email/verify/resend', 'POST', {});
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many verification emails/);
  assert.equal(app.outbox.length, 4); // sign-up plus 3 resends; the 429 did not send
  const oldest = tokenOf(app.outbox[0]);
  const newest = tokenOf(app.outbox[3]);
  assert.equal((await fetch(app.base + '/api/email/verify?token=' + oldest, { redirect: 'manual' })).headers.get('location'), '/?email=invalid');
  assert.equal((await fetch(app.base + '/api/email/verify?token=' + newest, { redirect: 'manual' })).headers.get('location'), '/?email=verified');
  assert.equal((await a('/api/state')).status, 200);
});

test('a mail provider failure does not block sign-up or sign-in', async t => {
  const app = await start({ configured: true, provider: 'resend', send: async () => { throw new Error('resend 500'); } });
  t.after(app.close);
  const a = app.client();
  const reg = await a('/api/register', 'POST', { ...L, username: 'ada', email: 'ada@example.com' });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.verificationSent, false);
  assert.equal(reg.body.user.emailVerified, false);
  assert.equal((await a('/api/login', 'POST', { username: 'ada', password: L.password })).status, 200);
  assert.equal((await a('/api/state')).status, 200);
});

test('request logs redact the verification token', () => {
  const log = reqlog.createLogger({ stdout: false, dir: null });
  try { assert.equal(log.redactQuery('?token=' + 'a'.repeat(40)), '?token=[redacted]'); }
  finally { log.close(); }
});

test('no provider logs a masked recipient and never the message body', async () => {
  const lines = [];
  const m = mailer.create({ env: {}, log: s => lines.push(s) });
  assert.equal(m.configured, false);
  assert.equal(m.provider, 'log');
  const r = await m.send({ to: 'ada@example.com', subject: 'Verify your StudyHertz email', text: 'token SECRETTOKENVALUE', html: '<a>SECRETTOKENVALUE</a>' });
  assert.equal(r.sent, false);
  const text = lines.join('\n');
  assert.match(text, /not sent/);
  assert.match(text, /a\*\*\*@example.com/);
  assert.doesNotMatch(text, /SECRETTOKENVALUE|ada@example.com/);
  const warned = [];
  const missing = mailer.create({ env: { RESEND_API_KEY: 're_test' }, log: s => warned.push(s), fetch: async () => { throw new Error('should not be called'); } });
  assert.equal(missing.configured, false);
  assert.equal((await missing.send({ to: 'a@b.co', subject: 'S', text: 'BODY', html: 'BODY' })).sent, false);
  assert.match(warned.join('\n'), /MAIL_FROM/);
  assert.doesNotMatch(warned.join('\n'), /BODY/);
});

test('Resend is preferred over SMTP and Postmark sends text plus html', async t => {
  const calls = [];
  const fetch = async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body), headers: opt.headers }); return { ok: true, status: 200, json: async () => ({ id: 're_1', MessageID: 'pm_1', ErrorCode: 0 }) }; };
  const resend = mailer.create({ env: { RESEND_API_KEY: 're_test', SMTP_HOST: '127.0.0.1', POSTMARK_SERVER_TOKEN: 'pm_ignored', MAIL_FROM: 'StudyHertz <verify@studyhertz.com>', MAIL_REPLY_TO: 'support@studyhertz.com' }, fetch, log: () => {} });
  assert.equal(resend.provider, 'resend');
  const sent = await resend.send({ to: 'ada@example.com', subject: 'Verify', text: 'plain', html: '<b>html</b>' });
  assert.equal(sent.provider, 'resend');
  assert.equal(sent.id, 're_1');
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].headers.Authorization, 'Bearer re_test');
  assert.deepEqual(calls[0].body.to, ['ada@example.com']);
  assert.equal(calls[0].body.text, 'plain');
  assert.equal(calls[0].body.html, '<b>html</b>');
  assert.equal(calls[0].body.reply_to, 'support@studyhertz.com');
  calls.length = 0;
  const postmark = mailer.create({ env: { POSTMARK_SERVER_TOKEN: 'pm_test', MAIL_FROM: 'verify@studyhertz.com' }, fetch, log: () => {} });
  assert.equal(postmark.provider, 'postmark');
  const pm = await postmark.send({ to: 'ada@example.com', subject: 'Verify', text: 'plain', html: '<b>html</b>' });
  assert.equal(pm.provider, 'postmark');
  assert.equal(calls[0].url, 'https://api.postmarkapp.com/email');
  assert.equal(calls[0].headers['X-Postmark-Server-Token'], 'pm_test');
  assert.equal(calls[0].body.TextBody, 'plain');
  assert.equal(calls[0].body.HtmlBody, '<b>html</b>');
  t.after(() => {});
});

test('SMTP sends a multipart message with the plain-text and HTML parts', async t => {
  const smtp = await fakeSmtp(); t.after(smtp.close);
  const m = mailer.create({ env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'mailer', SMTP_PASS: 'secret', MAIL_FROM: 'StudyHertz <verify@studyhertz.com>' }, log: () => {} });
  assert.equal(m.provider, 'smtp');
  const text = 'PLAIN-LINK-TOKEN-xyz';
  const html = '<p style="color:#4c6ef5">HTML-LINK-TOKEN-xyz</p>';
  const r = await m.send({ to: 'ada@example.com', subject: 'Verify your StudyHertz email', text, html });
  assert.equal(r.sent, true);
  assert.equal(r.provider, 'smtp');
  assert.equal(smtp.received.length, 1);
  const raw = smtp.received[0];
  assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /text\/plain/);
  assert.match(raw, /text\/html/);
  assert.ok(raw.includes(Buffer.from(text).toString('base64')));
  assert.ok(raw.includes(Buffer.from(html).toString('base64')));
  assert.doesNotMatch(raw, /secret/);
});
