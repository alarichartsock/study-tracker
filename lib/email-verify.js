'use strict';
// Single-use email verification tokens. Only the SHA-256 of the token is stored.
const crypto = require('crypto');
const TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
function timingEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
// Replace any outstanding token. The raw token is returned once and never stored.
function issue(user, now = Date.now(), ttl = TTL_MS) {
  const token = crypto.randomBytes(32).toString('base64url');
  user.emailVerify = { hash: hashToken(token), email: String(user.email || '').toLowerCase(), exp: now + ttl };
  return token;
}
// Consume a token for one user. Expired and spent tokens are deleted so they cannot be reused.
function consume(user, token, now = Date.now()) {
  const rec = user && user.emailVerify;
  if (!rec || !rec.hash || !TOKEN_RE.test(String(token || ''))) return { ok: false, reason: 'invalid' };
  if (!timingEqual(hashToken(token), rec.hash)) return { ok: false, reason: 'invalid' };
  delete user.emailVerify;
  if (!user.email || String(user.email).toLowerCase() !== String(rec.email || '').toLowerCase()) return { ok: false, reason: 'invalid' };
  if (!(rec.exp > now)) return { ok: false, reason: 'expired' };
  user.emailVerified = true;
  user.emailVerifiedAt = new Date(now).toISOString();
  return { ok: true };
}
function findUser(users, token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const hash = hashToken(token);
  return (users || []).find(u => u.emailVerify && timingEqual(u.emailVerify.hash, hash)) || null;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function message({ to, url, username, logoUrl }) {
  const email = String(to || '').trim(), name = String(username || '').replace(/[\r\n]/g, '').slice(0, 32);
  const hello = name ? 'Hi ' + name + ',' : 'Hi,';
  const logo = String(logoUrl || 'https://studyhertz.com/icon-192.png');
  const subject = 'Verify your StudyHertz email';
  const text = [
    'Verify your StudyHertz email',
    '',
    hello,
    '',
    'Confirm ' + email + ' so we know this address is yours. You can keep using StudyHertz either way.',
    'This link works once and expires in 24 hours.',
    '',
    'Verify email:',
    url,
    '',
    "If you didn't create a StudyHertz account or change this email, you can ignore this message.",
    '',
    'StudyHertz',
    'https://studyhertz.com',
  ].join('\n');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f8;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Confirm your email for StudyHertz. This link works once and expires in 24 hours.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f8;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e6ee;">
<tr><td style="height:6px;line-height:6px;font-size:0;background-color:#6c8cff;background-image:linear-gradient(90deg,#6c8cff,#22c3a6);border-radius:16px 16px 0 0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;vertical-align:middle;"><img src="${esc(logo)}" width="40" height="40" alt="StudyHertz" style="display:block;border:0;border-radius:10px;width:40px;height:40px;"></td>
<td style="vertical-align:middle;font-size:18px;font-weight:700;color:#1b2030;">StudyHertz</td>
</tr></table></td></tr>
<tr><td style="padding:8px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b2030;font-size:15px;line-height:1.5;">
<h1 style="margin:12px 0 8px;font-size:22px;line-height:1.3;color:#1b2030;">Verify your email</h1>
<p style="margin:0 0 12px;">${esc(hello)}</p>
<p style="margin:0 0 20px;">Confirm <b>${esc(email)}</b> so we know this address is yours. You can keep using StudyHertz either way. This link works once and expires in 24 hours.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#4c6ef5;">
<a href="${esc(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">Verify email</a>
</td></tr></table>
<p style="margin:20px 0 0;color:#6b7385;font-size:13px;">Or paste this link into your browser:<br><a href="${esc(url)}" style="color:#4c6ef5;word-break:break-all;">${esc(url)}</a></p>
<p style="margin:16px 0 0;color:#6b7385;font-size:13px;">If you didn't create a StudyHertz account or change this email, you can ignore this message.</p>
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #e2e6ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7385;font-size:12px;">
StudyHertz · <a href="https://studyhertz.com" style="color:#4c6ef5;text-decoration:none;">studyhertz.com</a>
</td></tr></table></td></tr></table></body></html>`;
  return { to: email, subject, text, html };
}

module.exports = { TTL_MS, TOKEN_RE, hashToken, issue, consume, findUser, message };
