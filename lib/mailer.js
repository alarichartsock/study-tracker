'use strict';
// Pluggable outbound mail. One provider, chosen from the environment:
//   1. Resend   RESEND_API_KEY
//   2. Postmark POSTMARK_SERVER_TOKEN
//   3. SMTP     SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE)
//   4. log      no-op when nothing above is set, or MAIL_FROM is missing
// The body (which may contain a verification link) is never written to the log.
const crypto = require('crypto'), net = require('net'), tls = require('tls');

const strip = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
function parseFrom(raw) {
  const s = strip(raw);
  const angled = /^(.*?)\s*<([^<>\s@]+@[^<>\s@]+)>$/.exec(s);
  if (angled) return { name: angled[1].replace(/^"|"$/g, '').trim(), email: angled[2], header: s };
  if (/^[^<>\s@]+@[^<>\s@]+$/.test(s)) return { name: '', email: s, header: s };
  return null;
}
function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!d) return '(invalid)';
  return (u ? u.slice(0, 1) + '***' : '***') + '@' + d;
}
function detect(env) {
  const from = parseFrom(env.MAIL_FROM || '');
  const replyTo = strip(env.MAIL_REPLY_TO || '');
  if (strip(env.RESEND_API_KEY)) return { id: 'resend', from, replyTo, key: strip(env.RESEND_API_KEY) };
  if (strip(env.POSTMARK_SERVER_TOKEN)) return { id: 'postmark', from, replyTo, key: strip(env.POSTMARK_SERVER_TOKEN) };
  if (strip(env.SMTP_HOST)) {
    const secure = /^(1|true|yes)$/i.test(String(env.SMTP_SECURE || '')) || String(env.SMTP_PORT || '') === '465';
    return { id: 'smtp', from, replyTo, host: strip(env.SMTP_HOST), port: Number(env.SMTP_PORT) || (secure ? 465 : 587), secure, user: String(env.SMTP_USER || ''), pass: String(env.SMTP_PASS || '') };
  }
  return { id: 'log', from, replyTo };
}

async function readJson(res) { try { return await res.json(); } catch { return {}; } }

function buildRaw({ from, to, subject, text, html, replyTo }) {
  const boundary = 'sh_' + crypto.randomBytes(12).toString('hex');
  const b64 = s => Buffer.from(String(s), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const headers = [
    'From: ' + strip(from), 'To: ' + strip(to), 'Subject: ' + strip(subject),
    'Date: ' + new Date().toUTCString(), 'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@studyhertz.com>',
    'MIME-Version: 1.0', 'Auto-Submitted: auto-generated',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
  ];
  if (replyTo) headers.push('Reply-To: ' + strip(replyTo));
  const body = [
    '--' + boundary, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    '--' + boundary, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html),
    '--' + boundary + '--', '',
  ].join('\r\n');
  return (headers.join('\r\n') + '\r\n\r\n' + body).split('\r\n').map(l => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
}

function smtpSend({ host, port, secure, user, pass, from, to, raw, timeout = 20000, ca, rejectUnauthorized = true }) {
  return new Promise((resolve, reject) => {
    let sock, buf = '', batch = [], stage = 'greeting', upgraded = false, settled = false;
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), timeout);
    const fail = e => { if (settled) return; settled = true; clearTimeout(timer); try { sock && sock.destroy(); } catch { /* already closed */ } reject(e); };
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); try { sock.write('QUIT\r\n'); sock.end(); } catch { /* ignore */ } resolve(); };
    const write = s => sock.write(s + '\r\n');
    const addr = s => { const m = /<([^<>\s]+)>/.exec(s); return (m ? m[1] : s).trim(); };
    function attach(s) {
      sock = s; sock.setEncoding('utf8'); sock.on('error', fail); sock.on('data', onData);
    }
    function onData(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        batch.push(line);
        if (line.length >= 4 && line[3] === '-') continue;
        const code = Number(line.slice(0, 3)), lines = batch; batch = [];
        if (!Number.isInteger(code)) continue;
        try { step(code, lines); } catch (e) { return fail(e); }
      }
    }
    function step(code, lines) {
      if (stage === 'greeting') {
        if (code !== 220) throw new Error('SMTP greeting ' + code);
        stage = 'ehlo'; return write('EHLO studyhertz.com');
      }
      if (stage === 'ehlo') {
        if (code !== 250) throw new Error('SMTP EHLO ' + code);
        if (!secure && !upgraded && lines.some(l => /STARTTLS/i.test(l))) { stage = 'tls'; return write('STARTTLS'); }
        return auth();
      }
      if (stage === 'tls') {
        if (code !== 220) throw new Error('SMTP STARTTLS ' + code);
        const plain = sock; plain.removeAllListeners('data'); plain.removeAllListeners('error');
        upgraded = true; buf = ''; batch = []; stage = 'ehlo';
        const next = tls.connect({ socket: plain, servername: host, ...(ca ? { ca } : {}), rejectUnauthorized });
        attach(next);
        next.once('secureConnect', () => { if (!settled) write('EHLO studyhertz.com'); });
        return;
      }
      if (stage === 'auth') {
        if (code !== 235) throw new Error('SMTP auth ' + code);
        stage = 'mail'; return write('MAIL FROM:<' + addr(from) + '>');
      }
      if (stage === 'mail') {
        if (code !== 250) throw new Error('SMTP MAIL FROM ' + code);
        stage = 'rcpt'; return write('RCPT TO:<' + addr(to) + '>');
      }
      if (stage === 'rcpt') {
        if (code !== 250 && code !== 251) throw new Error('SMTP RCPT TO ' + code);
        stage = 'data'; return write('DATA');
      }
      if (stage === 'data') {
        if (code !== 354) throw new Error('SMTP DATA ' + code);
        stage = 'sent'; return sock.write(raw + '\r\n.\r\n');
      }
      if (stage === 'sent') {
        if (code !== 250) throw new Error('SMTP send ' + code);
        stage = 'quit'; return finish();
      }
    }
    function auth() {
      if (!user) { stage = 'mail'; return write('MAIL FROM:<' + addr(from) + '>'); }
      stage = 'auth';
      return write('AUTH PLAIN ' + Buffer.from('\0' + user + '\0' + pass).toString('base64'));
    }
    attach(secure ? tls.connect({ host, port, servername: host, ...(ca ? { ca } : {}), rejectUnauthorized }) : net.connect({ host, port }));
  });
}

function create({ env = {}, fetch: fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  const provider = detect(env);
  const configured = provider.id !== 'log' && !!provider.from;
  if (provider.id !== 'log' && !provider.from) log('mailer: ' + provider.id + ' is set but MAIL_FROM is missing or invalid, so mail will not be sent');
  async function send(msg) {
    const to = strip(msg && msg.to), subject = strip(msg && msg.subject);
    if (!to || !subject) throw new Error('mail missing to or subject');
    if (!configured) {
      log('mailer: not sent (' + (provider.id === 'log' ? 'no provider configured' : 'MAIL_FROM missing') + ') to ' + maskEmail(to) + ' subject "' + subject.slice(0, 80) + '"');
      return { ok: true, sent: false, provider: 'log' };
    }
    if (provider.id === 'resend') {
      const res = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + provider.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: provider.from.header, to: [to], subject, text: msg.text || '', html: msg.html || '', ...(provider.replyTo ? { reply_to: provider.replyTo } : {}) }) });
      if (!res.ok) throw new Error('resend ' + res.status);
      const j = await readJson(res);
      return { ok: true, sent: true, provider: 'resend', id: j.id || null };
    }
    if (provider.id === 'postmark') {
      const res = await fetchImpl('https://api.postmarkapp.com/email', { method: 'POST', headers: { 'X-Postmark-Server-Token': provider.key, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ From: provider.from.header, To: to, Subject: subject, TextBody: msg.text || '', HtmlBody: msg.html || '', MessageStream: 'outbound', ...(provider.replyTo ? { ReplyTo: provider.replyTo } : {}) }) });
      const j = await readJson(res);
      if (!res.ok || j.ErrorCode) throw new Error('postmark ' + (j.ErrorCode || res.status));
      return { ok: true, sent: true, provider: 'postmark', id: j.MessageID || null };
    }
    await smtpSend({ host: provider.host, port: provider.port, secure: provider.secure, user: provider.user, pass: provider.pass, from: provider.from.header, to,
      raw: buildRaw({ from: provider.from.header, to, subject, text: msg.text || '', html: msg.html || '', replyTo: provider.replyTo }) });
    return { ok: true, sent: true, provider: 'smtp', id: null };
  }
  return { configured, provider: configured ? provider.id : 'log', send };
}

module.exports = { create, detect, parseFrom, maskEmail, buildRaw, smtpSend };
