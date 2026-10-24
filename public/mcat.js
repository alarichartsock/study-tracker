// MCAT practice-exam helpers shared by the browser (window.MCAT) and the server/tests (require).
// Percentile ranks: AAMC, "Summary of MCAT Total and Section Scores", Percentile Ranks in Effect
// May 1, 2026 - April 30, 2027 (2023-2025 testing years combined, N = 305,494).
// Source: https://students-residents.aamc.org/media/19701/download (via aamc.org/mcat-percentile-ranks).
// AAMC updates these every May 1; refresh the tables then. "<1" is stored as 0 and shown as "<1".
(function (root) {
  'use strict';
  const SOURCE = { name: 'AAMC Summary of MCAT Total and Section Scores', effective: 'May 1, 2026 \u2013 April 30, 2027', url: 'https://students-residents.aamc.org/media/19701/download' };
  const SECTIONS = [['cp', 'C/P', 'Chem/Phys'], ['cars', 'CARS', 'CARS'], ['bb', 'B/B', 'Bio/Biochem'], ['ps', 'P/S', 'Psych/Soc']];
  // Total 472..528
  const TOTAL = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 9, 11, 12, 14, 16, 18, 20, 23, 25, 28, 31, 33, 36, 39, 42, 45, 48, 52, 55, 58, 61, 64, 67, 71, 74, 76, 79, 82, 84, 86, 89, 91, 92, 94, 95, 96, 97, 98, 99, 99, 99, 100, 100, 100, 100];
  // Sections 118..132
  const SECTION = {
    cp: [2, 4, 9, 16, 25, 35, 46, 56, 67, 77, 85, 91, 96, 99, 100],
    cars: [1, 3, 8, 15, 25, 37, 50, 62, 74, 84, 90, 95, 98, 99, 100],
    bb: [1, 4, 8, 15, 23, 32, 43, 53, 64, 75, 84, 90, 96, 98, 100],
    ps: [1, 3, 6, 10, 17, 25, 34, 44, 54, 65, 76, 85, 92, 97, 100]
  };
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const pctTotal = t => isInt(t, 472, 528) ? TOTAL[t - 472] : null;
  const pctSection = (k, s) => SECTION[k] && isInt(s, 118, 132) ? SECTION[k][s - 118] : null;
  const fmtPct = p => p == null ? '\u2013' : p === 0 ? '<1' : String(p);
  const total = x => SECTIONS.reduce((a, [k]) => a + x[k], 0);
  function cleanPractice(j, old = {}) {
    j = j || {};
    const date = j.date ?? old.date; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || isNaN(new Date(date + 'T00:00:00Z'))) throw new Error('date required (YYYY-MM-DD)');
    const out = { date, source: String(j.source ?? old.source ?? '').trim().slice(0, 80) || 'Practice exam', notes: String(j.notes ?? old.notes ?? '').trim().slice(0, 1000) };
    for (const [k, lbl] of SECTIONS) { const v = j[k] !== undefined && j[k] !== '' ? Number(j[k]) : old[k]; if (!isInt(v, 118, 132)) throw new Error(lbl + ' score must be a whole number from 118 to 132'); out[k] = v; }
    out.total = total(out); return out;
  }
  const cleanGoal = g => { if (g === null || g === '' || g === undefined) return null; const n = Number(g); if (!isInt(n, 472, 528)) throw new Error('goal must be a whole number from 472 to 528'); return n; };
  function summary(list) {
    const xs = (list || []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    if (!xs.length) return { n: 0, exams: [] };
    const first = xs[0], last = xs[xs.length - 1], prev = xs.length > 1 ? xs[xs.length - 2] : null;
    const best = xs.reduce((b, x) => x.total > b.total || (x.total === b.total && x.date > b.date) ? x : b, first);
    const d = (a, b, k) => b ? a[k] - b[k] : null;
    const change = k => ({ prev: d(last, prev, k), first: xs.length > 1 ? last[k] - first[k] : null });
    return { n: xs.length, exams: xs, first, last, prev, best, change: Object.fromEntries(['total', ...SECTIONS.map(s => s[0])].map(k => [k, change(k)])) };
  }
  const api = { SOURCE, SECTIONS, TOTAL, SECTION, pctTotal, pctSection, fmtPct, cleanPractice, cleanGoal, summary };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MCAT = api;
})(typeof self !== 'undefined' ? self : this);
