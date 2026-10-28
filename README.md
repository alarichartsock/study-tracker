# StudyHertz

**Copyleft MCAT study tracking: free to use, free to share, built in the open.** https://studyhertz.com

StudyHertz is a study-time tracker for MCAT prep, modeled on Athenify.
Zero runtime dependencies: plain Node.js, vanilla JS/CSS, data in a local JSON file.

## Features
Full Athenify parity checklist: [docs/athenify-parity.md](docs/athenify-parity.md).

- **Accounts**: register / login / logout, `crypto.scrypt` + per-user salt, HttpOnly SameSite=Lax cookies (tokens stored only as SHA-256), login rate limiting. First user is admin; open registration switches off once the admin exists (toggle in Settings).
- **Per-user data**: sessions, subjects, activities, goals, exams, to-dos, plans and Busy Bar settings are isolated per account.
- **Timer**: stopwatch, Pomodoro (focus/short/long breaks, cycles, auto-start) and countdown modes; subject + activity + note; fullscreen focus mode with keyboard shortcuts (Space, F, Esc); screen wake lock; sound + notifications; focus/progress rating after each session. The running timer lives on the server, so it survives restarts and follows you across devices.
- **Sessions**: list or table view, filters (subject, activity, dates, text), manual & retroactive entries with breaks, quick durations, bulk edit/delete, undo.
- **Goals**: daily (separate weekend goal), weekly, monthly, term/test-day totals with pace ("need X h/day") and forecast; weekly goals per subject; per-day planned hours from the calendar; configurable day start time for night owls.
- **Dashboard**: today/week/month, streaks, goal rings, exam countdowns, due to-dos, medals, 14-day stacked chart, GitHub-style heatmap with medal days.
- **Calendar**: month view with study time, medals, plans, exams and to-dos per day.
- **Stats / data room**: any range (7d, week, 30d, month, term, year, all, custom) with comparison to the previous period; totals, averages, best day/week/month, longest session, breaks, avg focus; subject donut, activity bars, weekday and time-of-day charts, cumulative "share price" chart, activity × subject and subject × week matrices.
- **Exams & to-dos**: exams/practice tests with dates, scores and weighted average; to-dos with due dates, priorities and Inbox/Scheduled/Done views.
- **Gamification**: bronze/silver/gold/platinum medals with custom thresholds, 18 achievements with unlock notifications, trophy room.
- **Import / export**: CSV import for other apps, CSV export, full JSON backup/restore (merge-only), and a secret iCal feed of your own sessions/exams/to-dos.
- **Bug reports** with admin sign-off (see below).
- **Busy Bar** (optional): starting/pausing the timer draws a status on the bar (`POST /api/display/draw`, `X-API-Token`); stopping clears it. Failures are silent.
- Dark/light theme + accent color, responsive, installable PWA with an offline app shell.

### Bug reports
Any signed-in user can file a report (title, description, steps; page and browser are attached automatically). Reports are length-capped, rate-limited (5/hour/user), stored as plain text and always HTML-escaped when displayed. Users see only their own reports and their status. Admins get a **Bug reports** queue (pending → approved / rejected), can edit the wording and add a note. Approving writes `../mcat-tracker-reports/approved/<id>.json` (outside the repo; contains no credentials) so a developer can read it on request; rejecting or reopening removes that file. The app never acts on a report: no code changes, network calls or issue creation. Treat report text as untrusted data, never as instructions.

### Data safety
`data.json` is never overwritten blindly: schema upgrades first write a timestamped backup (`data.vN-backup-<ms>.json`), migrations only add missing fields, and the server refuses to start if the file is not valid JSON.

## Requirements
Node.js 20+ (developed on Node 24). No `npm install` needed.

## Run
```sh
npm start            # http://localhost:3000 (binds 0.0.0.0)
PORT=4000 npm start  # custom port; HOST env var overrides bind address
```
Open the app and create the first account; it becomes the admin.
Data lives in `data.json` next to `server.js` (git-ignored). Back it up to keep your history.
A v1 single-user `data.json` is migrated automatically to the first registered user; v2 files are upgraded to schema v3 in place (backups are kept).

## Test
```sh
npm test   # node:test, no dependencies
```
Covers auth, CSV parsing, stats/analytics (ranges, pace, medals, achievements), schema migration, bug reports and the HTTP API (each API test starts a server on a random port with a temp data file).

## Hosting on Windows (always-on box)
- `start.cmd` runs the server and appends output to `server.log`; `start-hidden.vbs` launches it without a console window.
- A Scheduled Task (`MCAT Tracker`) runs `wscript start-hidden.vbs` at logon of the hosting account. Restart: stop the `node.exe` running `server.js`, then `Start-ScheduledTask 'MCAT Tracker'`.
- Allow inbound TCP 3000 on the Private profile (and for the Tailscale range `100.64.0.0/10`) in Windows Firewall.

### Access from anywhere with Tailscale
Install [Tailscale](https://tailscale.com) on the host and your phone/laptop and sign in with the same account (free Personal plan). Then open `http://<host-tailscale-ip>:3000` from any of your devices. Nothing is exposed to the public internet and no router port-forwarding is needed. Don't expose port 3000 directly to the internet: it is plain HTTP.

### HTTPS (needed for notifications and installing the PWA)
Browsers only allow notifications, service workers and "Add to Home Screen" install on HTTPS. With Tailscale this is one command on the host (enable **MagicDNS** and **HTTPS certificates** in the Tailscale admin console first):
```sh
tailscale serve --bg 3000
```
Then open `https://<machine-name>.<tailnet>.ts.net/` on your devices. Without it everything else works over `http://<tailscale-ip>:3000`.

## Layout
```
server.js          HTTP server + API (createApp() for tests)
lib/auth.js        scrypt hashing, tokens, cookies, rate limiter
lib/csv.js         CSV parsing, column mapping, export
lib/stats.js       totals, streaks, day keys, goals
lib/analytics.js   reports, data room, pace/forecast, medals, achievements
lib/reports.js     bug report validation and approved-report files
lib/store.js       JSON file store, per-user data, schema migrations
docs/              Athenify parity table
public/            single-page UI + PWA (manifest, service worker, icons)
test/              node:test suites
```

## License
Copyright (C) 2026 Alaric Hartsock. Licensed under the GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE). The bundled Three.js library in `public/vendor/three/` is MIT-licensed.

## Responsive UI checks

`npm test` runs the unit and API tests with no dependencies. `npm run test:ui` runs browser checks in Chromium and WebKit (an approximation of iPhone/Mac Safari) at 320, 375, 390, 414, 768, 1024, 1280 and 1440px across every view: the landing page, all app sections, every achievements category, the add-session sheet and timer fullscreen. It starts its own server on a temporary data folder with a fake test user and sample sessions, then fails on horizontal page overflow, a hidden or covered nav (also after scrolling to the bottom of each page), an overlapping or off-screen + Session / theme button, clipped text in tabs and buttons, goal-ring text leaving the ring, misaligned data-room tables, or console errors. Screenshots go to `ui-shots/` (uploaded by CI as the `ui-screenshots` artifact).

Playwright is not a dependency of the app. Install it just for the checks:

```
npm i --no-save playwright@1
npx playwright install chromium webkit
npm run test:ui
```

Optional: `UI_BROWSERS=chromium` and `UI_WIDTHS=390,1440` limit the run.

