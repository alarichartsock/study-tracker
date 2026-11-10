# Email verification

Sign-up and an email change send one verification message. The link is single-use, expires after 24 hours, and only a SHA-256 of the token is stored (`user.emailVerify.hash`). Opening the link sets `emailVerified` and returns the person to `/?email=verified`.

Unverified accounts can sign in and use the app. Nothing is gated on `emailVerified` yet; `/api/me` already returns it (`user.emailVerified`) for a later check. Accounts that already exist are not blocked. They see a banner with a resend button and are not emailed until they resend or change the address. An address that Google, Apple, GitHub, or Microsoft has already verified is stored as verified and is not sent a second link.

Resend is `POST /api/email/verify/resend` (signed in). It allows 3 messages per account per hour. Changing the address, or sending again, replaces the previous token.

## Turning it on

The server sends nothing until both a provider and `MAIL_FROM` are set. With neither, sign-up still works and the server logs that a message was skipped. The log line masks the recipient and does not include the link. Set `MAIL_LOG_LINKS=1` only on a private machine if you need the link printed.

Pick one provider. If more than one is set, the first match wins: Resend, then Postmark, then SMTP.

### Resend (fits Render: outbound HTTPS, no mail port)

1. Add the domain `studyhertz.com` in Resend and copy the DNS records it shows. They are usually:
   - DKIM: three CNAME records on a host such as `resend._domainkey.studyhertz.com` (use the exact hosts Resend displays).
   - SPF: a TXT record on the sending host (often `send.studyhertz.com`) that includes Resend's SPF, merged with any SPF TXT you already publish. A domain may have only one SPF TXT.
   - Optional DMARC, if you do not already have one: TXT on `_dmarc.studyhertz.com` with `v=DMARC1; p=none; rua=mailto:support@studyhertz.com`.
2. Wait until Resend marks the domain verified.
3. On the Render service, set:
   - `RESEND_API_KEY` — the API key (secret).
   - `MAIL_FROM` — `StudyHertz <verify@studyhertz.com>` (the address must be on the verified domain).
   - `MAIL_REPLY_TO` — `support@studyhertz.com` (optional).
   - `PUBLIC_BASE_URL` — `https://studyhertz.com` (optional; `OAUTH_BASE_URL` is used when this is unset).

### Postmark

Same DNS idea: add the domain in Postmark, publish the DKIM CNAME and SPF TXT it shows, then set `POSTMARK_SERVER_TOKEN` and `MAIL_FROM`. Leave `RESEND_API_KEY` unset so Postmark is selected.

### SMTP

Set `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`. Port 587 uses STARTTLS when the server advertises it. `SMTP_SECURE=1` (or port 465) uses implicit TLS. Publish that host's SPF and DKIM, not a generic record. Render allows outbound 587 and 465; do not use port 25.

Restart the service after changing any of these. No secret belongs in the repo or in `render.yaml`.
