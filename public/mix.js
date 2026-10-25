// Study-mix wallpaper: pure helpers shared by the browser (window.StudyMix) and tests (require).
(function (root) {
  'use strict';
  const MODES = ['auto', 'subject', 'accent', 'static'], WINDOWS = ['day', 'week', 'month', 'all'], MAX = 5;
  const secs = s => Math.max(0, (new Date(s.end) - new Date(s.start)) / 1000 - (+s.breakSec || 0));
  // Start of the current day/week(Mon)/month (or the epoch for 'all'), honouring the "day starts at hour" setting.
  function windowStart(win, now = new Date(), h = 0) { if (win === 'all') return new Date(0); const d = new Date(+now - h * 3600e3); d.setHours(0, 0, 0, 0);
    if (win === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); else if (win === 'month') d.setDate(1);
    return new Date(+d + h * 3600e3); }
  // Share of study time per subject in the window. At most MAX parts; the rest is folded into the biggest.
  function studyMix(sessions, { win = 'week', now = new Date(), h = 0, max = MAX } = {}) {
    const from = +windowStart(win, now, h), to = +now, by = {};
    for (const s of sessions || []) { const t = +new Date(s.start); if (!(t >= from && t <= to)) continue; const v = secs(s); if (v > 0) by[s.subject] = (by[s.subject] || 0) + v; }
    const list = Object.entries(by).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), total = list.reduce((t, x) => t + x[1], 0);
    let others = 0; if (list.length > max) { others = list.slice(max).reduce((t, x) => t + x[1], 0); list.length = max; list[0] = [list[0][0], list[0][1] + others]; }
    return { win, total, others, parts: list.map(([subject, sec]) => ({ subject, sec, share: total ? sec / total : 0 })) };
  }
  const SPOTS = [[16, 10], [86, 24], [26, 86], [82, 84], [54, 48]];
  // Blob layout: one soft radial blob per part, sized by share. A single colour gets a tinted 3-blob default.
  function blobs(parts, colorOf) {
    if (!parts.length) return [];
    if (parts.length === 1) { const c = colorOf(parts[0].subject);
      return [{ color: c, x: 16, y: 10, size: 64 }, { color: `color-mix(in oklab, ${c} 55%, #ffffff)`, x: 86, y: 30, size: 52 }, { color: `color-mix(in oklab, ${c} 60%, #7f8aa3)`, x: 40, y: 92, size: 56 }]; }
    return parts.map((p, i) => ({ color: colorOf(p.subject), x: SPOTS[i][0], y: SPOTS[i][1], size: Math.round(34 + p.share * 52) }));
  }
  function cleanBackground(j = {}, old = {}) { const out = { mode: old.mode || 'auto', window: old.window || 'week', motion: old.motion !== false };
    if (j.mode !== undefined) { if (!MODES.includes(j.mode)) throw new Error('background.mode must be one of ' + MODES.join(', ')); out.mode = j.mode; }
    if (j.window !== undefined) { if (!WINDOWS.includes(j.window)) throw new Error('background.window must be one of ' + WINDOWS.join(', ')); out.window = j.window; }
    if (j.motion !== undefined) { if (typeof j.motion !== 'boolean') throw new Error('background.motion must be true or false'); out.motion = j.motion; }
    return out; }
  const api = { MODES, WINDOWS, MAX, windowStart, studyMix, blobs, cleanBackground };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.StudyMix = api;
})(typeof self !== 'undefined' ? self : this);
