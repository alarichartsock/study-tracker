# MCAT Tracker

A personal, self-hosted study-time tracker for MCAT prep, modeled on Athenify.
Zero runtime dependencies: plain Node.js, vanilla JS/CSS, data in a local JSON file.

## Features
- **Accounts**: register / login / logout. Passwords hashed with `crypto.scrypt` + per-user salt; sessions via HttpOnly, SameSite=Lax cookies (tokens stored only as SHA-256). Login rate limiting (per user and per IP).
- **Admin**: the first registered user is admin. Open registration is turned off automatically once the admin exists; the admin can re-enable it in Settings.
- **Per-user data**: sessions, subjects, daily goal and Busy Bar settings are isolated per account.
- **Timer**: big central timer with a goal-progress ring, subject chips (Chem/Phys, CARS, Bio/Biochem, Psych/Soc + custom), optional note, start / pause / resume / stop. A running timer survives server restarts.
- **Dashboard**: today / week / month totals, current & best streak, daily-goal ring, per-subject stacked chart (last 14 days), monthly subject breakdown, GitHub-style heatmap of the last year.
- **History**: filter by subject, date range and text; add / edit / delete sessions.
- **Import / export**: CSV import designed for Athenify exports (auto-detects date, start, end, duration, subject/category, note columns; manual column mapping; `,` `;` or tab separated; `dd.mm.yyyy`, `mm/dd/yyyy`, ISO dates; `1:30`, `1h 30m`, `90 min`, minutes or hours durations). CSV export of all sessions.
- **Busy Bar** (optional): set the device IP + API token in Settings. Starting/pausing the timer draws a status on the bar (`POST /api/display/draw`, `X-API-Token` header); stopping clears it. Failures are silent.
- Dark / light theme, responsive for phones.

## Requirements
Node.js 20+ (developed on Node 24). No `npm install` needed.

## Run
```sh
npm start            # http://localhost:3000 (binds 0.0.0.0)
PORT=4000 npm start  # custom port; HOST env var overrides bind address
```
Open the app and create the first account; it becomes the admin.
Data lives in `data.json` next to `server.js` (git-ignored). Back it up to keep your history.
A v1 single-user `data.json` is migrated automatically to the first registered user (a `data.v1-backup.json` copy is kept).

## Test
```sh
npm test   # node:test, no dependencies
```
Covers password hashing, login/session/rate limiting, CSV parsing & column mapping, stats (totals, streaks, goals) and the HTTP API (each test starts a server on a random port with a temp data file).

## Hosting on Windows (always-on box)
- `start.cmd` runs the server and appends output to `server.log`; `start-hidden.vbs` launches it without a console window.
- A Scheduled Task (`MCAT Tracker`) runs `wscript start-hidden.vbs` at logon of the hosting account. Restart: stop the `node.exe` running `server.js`, then `Start-ScheduledTask 'MCAT Tracker'`.
- Allow inbound TCP 3000 on the Private profile (and for the Tailscale range `100.64.0.0/10`) in Windows Firewall.

### Access from anywhere with Tailscale
Install [Tailscale](https://tailscale.com) on the host and your phone/laptop and sign in with the same account (free Personal plan). Then open `http://<host-tailscale-ip>:3000` from any of your devices. Nothing is exposed to the public internet and no router port-forwarding is needed. Don't expose port 3000 directly to the internet: it is plain HTTP.

## Layout
```
server.js          HTTP server + API (createApp() for tests)
lib/auth.js        scrypt hashing, tokens, cookies, rate limiter
lib/csv.js         CSV parsing, Athenify import mapping, export
lib/stats.js       totals, streaks, per-subject / per-day aggregates
lib/store.js       JSON file store, per-user data, v1 migration
public/            single-page UI (index.html, app.js, style.css)
test/              node:test suites
```

## License
Proprietary. Copyright (c) 2026 Alaric Hartsock. All rights reserved. See [LICENSE](LICENSE).
