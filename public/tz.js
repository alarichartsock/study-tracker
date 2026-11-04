// Per-user time zone helpers (IANA names via Intl, no dependencies). Shared by the browser (window.TZ) and the
// server/tests (require). Instants stay UTC everywhere; only "which calendar day / hour is this for the user" and
// "which instant is this wall-clock time" go through here.
(function (root) {
  'use strict';
  const DEFAULT = 'America/Los_Angeles';
  const FMT = new Map();
  const fmt = tz => { let f = FMT.get(tz); if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }); FMT.set(tz, f); } return f; };
  function valid(tz) { if (typeof tz !== 'string' || !tz || tz.length > 64) return false; try { fmt(tz); return true; } catch { return false; } }
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const pad = n => String(n).padStart(2, '0');
  // Wall-clock parts of an instant in tz: { y, mo (1-12), d, h, mi, s, wd (0=Sun) }
  function parts(t, tz) { const o = {}; for (const p of fmt(tz).formatToParts(new Date(t))) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WD[o.weekday] }; }
  // Calendar day key (YYYY-MM-DD) of an instant in tz; dayStartHour h counts early-morning time toward the previous day.
  const key = (t, tz, h = 0) => { const p = parts(+new Date(t) - (+h || 0) * 3600e3, tz); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };
  const offsetMin = (t, tz) => { const p = parts(t, tz); return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(+new Date(t) / 1000) * 1000) / 60e3); };
  // Instant for a wall-clock date ("YYYY-MM-DD") and time ("HH:MM[:SS]") in tz. In a DST gap the time is moved
  // forward by the gap; in an overlap the earlier (first) occurrence is used.
  function toUtc(dateKey, time, tz) { const [y, mo, d] = String(dateKey).split('-').map(Number), [hh, mm, ss] = String(time || '00:00').split(':').map(Number);
    const wall = Date.UTC(y, mo - 1, d, hh || 0, mm || 0, ss || 0); if (isNaN(wall)) return new Date(NaN);
    const offs = [...new Set([-1, 0, 1].map(k => offsetMin(wall + k * 864e5, tz)))], same = c => { const p = parts(c, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) === wall; };
    const hits = offs.map(o => wall - o * 60e3).filter(same); if (hits.length) return new Date(Math.min(...hits));
    return new Date(wall - offsetMin(wall - 864e5, tz) * 60e3); }
  const guess = () => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return valid(z) ? z : null; } catch { return null; } };
  const list = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return [DEFAULT, 'UTC']; } };
  const api = { DEFAULT, valid, parts, key, offsetMin, toUtc, guess, list };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TZ = api;
})(typeof self !== 'undefined' ? self : this);
