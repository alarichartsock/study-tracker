# Athenify feature parity

Research date: 2026-10-22. Sources: [athenify.io](https://athenify.io/), [athenify.io/features](https://athenify.io/features) (full feature table),
[athenify.io/changelog](https://athenify.io/changelog), [athenify.io/pricing](https://athenify.io/pricing), [athenify.io/study-time-tracking](https://athenify.io/study-time-tracking).
Athenify does **not** list friends, leaderboards, projects/tags or subject hierarchies, so those were not added (verified, not assumed).

Legend: ✅ already implemented before this phase · 🆕 added in this phase · ⚠️ partial · ❌ skipped (reason given)

## Study tracking
| Athenify feature | Status | Notes |
|---|---|---|
| Session logging (subject, activity, duration, notes) | 🆕 | Activities ("study types") added; notes existed |
| Quick entry | 🆕 | Quick-duration buttons ("ending now") in the add dialog; configurable standard durations |
| Break tracking | 🆕 | `breakSec` per session, excluded from study time; Pomodoro breaks |
| Focus & progress scoring | 🆕 | 1–5 stars after each session and in the editor; average focus in stats |
| Grid & table view | 🆕 | Sessions list ↔ table toggle |
| Filter & sort | 🆕 | Subject, activity, date range, text search |
| SmartTimer suggestions | 🆕 | Suggested countdown length = median of recent sessions for the subject |
| Manual / retroactive entries, edit | ✅ / 🆕 | Existed; now also from the calendar day view |
| Bulk edit | 🆕 | Multi-select → change subject/activity or delete |
| Undo delete | 🆕 | Undo toast after single or bulk delete |

## Timer
| Feature | Status | Notes |
|---|---|---|
| Stopwatch mode | ✅ | |
| Pomodoro with cycles, long breaks | 🆕 | Focus/short/long/cycles configurable, optional auto-start |
| Countdown | 🆕 | Target length, auto-stops and saves |
| Fullscreen focus timer | 🆕 | Fullscreen view, keyboard shortcuts (Space, F, Esc) |
| Keep screen awake | 🆕 | Screen Wake Lock API while timing/fullscreen (browser support varies) |
| Floating desktop (picture-in-picture) timer | ❌ | Document PiP is Chromium-only and experimental; the tab title shows the running timer instead |
| Sound effects & notifications | 🆕 | WebAudio beep + Notification API (needs HTTPS, see README) |
| Auto-save sessions | ✅ | Running timer persists server-side across restarts/devices |
| Timer synced across devices | ✅ | Timer state lives on the server |

## Subjects & courses
| Feature | Status | Notes |
|---|---|---|
| Unlimited subjects with custom colors | 🆕 | Colors now editable; rename (renames past sessions) |
| Credit tracking | ⚠️ | Stored per subject via API; MCAT has no credits, so the UI uses exam weights instead |
| Deadlines per subject | 🆕 | Exams can be linked to a subject |
| Progress toward goals | 🆕 | Weekly per-subject goal bars |
| Import across semesters | ❌ | Single-term model (see Semesters) |

## Planning & goals
| Feature | Status | Notes |
|---|---|---|
| Daily goal | ✅ | |
| Weekend goals | 🆕 | Separate weekend daily goal |
| Weekly & monthly goals | 🆕 | With pace ("need X/day") and forecast |
| Semester (term) goals | 🆕 | Term name/start/end + total goal |
| Per-subject goals | 🆕 | Weekly goal per subject |
| Progress vs goal charts | 🆕 | Goal rings, goal line on 14-day chart |
| Calendar: plan goals per day | 🆕 | Month calendar; planned hours override that day's goal |
| Pace indicator | 🆕 | Hours/day needed for week/month/term |
| Magic forecast (AI) | ⚠️ | Linear projection of current pace, no AI |

## Exams & tasks
| Feature | Status | Notes |
|---|---|---|
| Exam tracking + countdown | 🆕 | Exams with date, subject, notes; dashboard countdown; shown in calendar |
| Grade tracking | 🆕 | Score per exam (e.g. AAMC FL scaled score) |
| Weighted averages | 🆕 | Weighted average of graded exams |
| Multiple grading systems (6+ countries) | ❌ | Not relevant to MCAT scoring |
| To-do list with due dates & priorities | 🆕 | Athenify marks this "soon" |
| Inbox / Scheduled / Done views | 🆕 | |

## Analytics & statistics
| Feature | Status | Notes |
|---|---|---|
| Dashboard | ✅ / 🆕 | Extended: goals, exams, due to-dos, medals, subject goals |
| Customizable dashboard tiles | ❌ | Fixed layout for now (low value for a single user) |
| Duration charts (weekly/monthly) | ✅ / 🆕 | 14-day stacked chart; per-week matrix totals; best week/month |
| Subject breakdown donut | 🆕 | |
| Spider chart | ❌ | Same information as the donut/bars |
| Time-of-day & weekday analysis | 🆕 | |
| Data room: activity × subject, subject × week | 🆕 | Weekly matrix as subjects × weeks table |
| Key metrics (total, count, averages) | 🆕 | Plus active days, longest session, breaks, comparison to previous period |
| Calendar heatmap with medal colors | ✅ / 🆕 | Medal dots added |
| Stock chart ("share price") | 🆕 | Cumulative study-time line |
| Term review (best day/week/month, longest streak) | 🆕 | Stats → Term range |

## Gamification
| Feature | Status | Notes |
|---|---|---|
| Streaks (current & longest) | ✅ | |
| Medals (bronze/silver/gold/platinum) + custom thresholds | 🆕 | |
| Repeatable badges (20+) | ⚠️ | Medal counts serve as repeatable awards |
| One-time achievements + trophy room | 🆕 | 18 MCAT-flavoured achievements (Athenify has 47) |
| Unlock notifications | 🆕 | Notification/toast when a new achievement is earned |

## Semesters, customization, platform
| Feature | Status | Notes |
|---|---|---|
| Multiple semesters with separate data | ❌ | One MCAT prep "term" with dates; ranges cover reviews of past periods |
| 5 languages | ❌ | English only (single user) |
| Date & time formats | ⚠️ | Uses the browser locale |
| Color schemes / dark mode | ✅ / 🆕 | Dark/light + custom accent color |
| Standard durations | 🆕 | Quick durations setting |
| Day start time | 🆕 | 0–6 am; late-night study counts for the previous day |
| Layout preferences | ❌ | Not needed |
| Real-time cloud sync | ✅ | Self-hosted server is the single source of truth; reachable via Tailscale |
| Web / iOS / Android apps | ⚠️ | Installable PWA with offline shell (requires HTTPS); no native apps |
| GDPR / EU hosting | ❌ | N/A — self-hosted on your own machine |
| Data export | ✅ / 🆕 | CSV + full JSON backup/restore |
| Reminders | 🆕 | Daily "haven't studied yet" reminder while the app is open/installed |

## Beyond Athenify (this app only)
- Busy Bar status display; multi-user accounts with admin; bug reports with admin sign-off.
- Not added because Athenify doesn't have them: friends/leaderboards, tags/projects, subject hierarchy.
