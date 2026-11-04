// Template-driven practice-exam scoring for non-MCAT tests (MCAT keeps public/mcat.js unchanged). Shared by the
// browser (window.PRACTICE) and the server/tests (require). Records live in userData.practice with exam: <templateId>.
// Scales verified Nov 2026 against official sources (see SOURCES).
(function (root) {
  'use strict';
  const r10 = v => Math.round(v / 10) * 10, avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const halfUp = v => Math.floor(v + 0.5);
  // section: [key, short label, long label, min, max, step, required]
  const SPECS = {
    lsat: { sections: [['lr', 'LR', 'Logical Reasoning (raw correct, both sections)', 0, 60, 1, false], ['rc', 'RC', 'Reading Comprehension (raw correct)', 0, 30, 1, false]],
      total: { label: 'Scaled score', min: 120, max: 180, step: 1, entered: true }, note: 'LR and RC raw scores feed the 120\u2013180 scaled score; Argumentative Writing is unscored.' },
    gre: { sections: [['v', 'Verbal', 'Verbal Reasoning', 130, 170, 1, true], ['q', 'Quant', 'Quantitative Reasoning', 130, 170, 1, true], ['awa', 'AWA', 'Analytical Writing', 0, 6, 0.5, false]],
      total: { label: 'Total (V + Q)', min: 260, max: 340, step: 1, of: ['v', 'q'], calc: 'sum' }, note: 'Total is Verbal + Quant (260\u2013340). Analytical Writing (0\u20136) is reported separately.' },
    gmat: { sections: [['q', 'Quant', 'Quantitative Reasoning', 60, 90, 1, true], ['v', 'Verbal', 'Verbal Reasoning', 60, 90, 1, true], ['di', 'DI', 'Data Insights', 60, 90, 1, true]],
      total: { label: 'Total score', min: 205, max: 805, step: 10, entered: true, endsIn5: true }, note: 'Sections 60\u201390 are equally weighted; enter the 205\u2013805 total from your score report (it always ends in 5).' },
    sat: { sections: [['rw', 'R&W', 'Reading and Writing', 200, 800, 10, true], ['m', 'Math', 'Math', 200, 800, 10, true]],
      total: { label: 'Total', min: 400, max: 1600, step: 10, of: ['rw', 'm'], calc: 'sum' }, note: 'Total is Reading and Writing + Math (400\u20131600).' },
    act: { sections: [['e', 'English', 'English', 1, 36, 1, true], ['m', 'Math', 'Math', 1, 36, 1, true], ['r', 'Reading', 'Reading', 1, 36, 1, true], ['s', 'Science', 'Science (optional)', 1, 36, 1, false]],
      total: { label: 'Composite', min: 1, max: 36, step: 1, of: ['e', 'm', 'r'], calc: 'avgHalfUp' }, extra: [['STEM', ['m', 's'], 'avgHalfUp']],
      note: 'Composite is the rounded average of English, Math and Reading (enhanced ACT; Science is optional and only feeds the STEM score).' },
    usmle1: { sections: [['pct', '% correct', 'Equated percent correct', 0, 100, 1, true], ['three', '3-digit', '3-digit equivalent (if shown)', 1, 300, 1, false], ['pp', 'Pass prob.', 'Probability of passing %', 0, 100, 1, false]],
      total: { label: 'Percent correct', min: 0, max: 100, step: 1, of: ['pct'], calc: 'first', unit: '%' }, pass: { key: 'three', at: 196 },
      note: 'Step 1 is pass/fail. Practice tests report percent correct; the passing standard is 196 on the 3-digit scale.' },
    dat: { sections: [['bio', 'Bio', 'Biology', 200, 600, 10, true], ['gc', 'GC', 'General Chemistry', 200, 600, 10, true], ['oc', 'OC', 'Organic Chemistry', 200, 600, 10, true], ['pat', 'PAT', 'Perceptual Ability', 200, 600, 10, true], ['rc', 'RC', 'Reading Comprehension', 200, 600, 10, true], ['qr', 'QR', 'Quantitative Reasoning', 200, 600, 10, true]],
      total: { label: 'Academic Average', min: 200, max: 600, step: 10, of: ['bio', 'gc', 'oc', 'rc', 'qr'], calc: 'avgR10' }, extra: [['Total Science', ['bio', 'gc', 'oc'], 'avgR10']],
      note: 'DAT scale 200\u2013600 (since March 1, 2025). AA = rounded mean of Bio, GC, OC, RC, QR (PAT excluded); Total Science = Bio, GC, OC.' }
  };
  const SOURCES = {
    lsat: 'https://www.lsac.org/lsat/lsat-scoring', gre: 'https://www.ets.org/gre/test-takers/general-test/scores/understand-scores.html',
    gmat: 'https://www.mba.com/exams/gmat-exam/scores', sat: 'https://satsuite.collegeboard.org/scores/what-scores-mean/understanding-scores',
    act: 'https://www.act.org/content/act/en/products-and-services/the-act/scores/understanding-your-scores.html',
    usmle1: 'https://www.usmle.org/scores-transcripts/examination-results-and-scoring', dat: 'https://www.ada.org/education/testing/exams/dental-admission-test-dat/dat-scores'
  };
  const CALC = { sum: xs => xs.reduce((a, b) => a + b, 0), avgHalfUp: xs => halfUp(avg(xs)), avgR10: xs => r10(avg(xs)), first: xs => xs[0] };
  // Custom template: user-defined sections [{ k, l, min, max }], total = sum of sections.
  function customSpec(defs) { const sections = (Array.isArray(defs) ? defs : []).map(d => [d.k, d.l, d.l, d.min, d.max, 1, true]);
    return { sections, total: { label: 'Total', min: sections.reduce((a, s) => a + s[3], 0), max: sections.reduce((a, s) => a + s[4], 0), step: 1, of: sections.map(s => s[0]), calc: 'sum' }, note: 'Total is the sum of your sections.' }; }
  function cleanCustomSections(list) { const out = [], seen = new Set();
    for (const d of Array.isArray(list) ? list.slice(0, 10) : []) { const l = String(d && d.l || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!l) continue;
      const min = Number(d.min), max = Number(d.max); if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 100000 || max <= min) throw new Error(l + ': min and max must be whole numbers with max > min');
      let k = 's' + (out.length + 1); while (seen.has(k)) k += 'x'; seen.add(k); out.push({ k, l, min, max }); }
    return out; }
  const spec = (id, custom) => id === 'custom' ? customSpec(custom) : SPECS[id] || null;
  const ok = (v, lo, hi, st) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi && Math.abs(Math.round((v - lo) / st) * st - (v - lo)) < 1e-9;
  const calc = (how, keys, x) => { const vs = keys.map(k => x[k]); return vs.some(v => v == null) ? null : CALC[how](vs); };
  function totalOf(sp, x) { return sp.total.entered ? x.total : calc(sp.total.calc, sp.total.of, x); }
  function clean(id, j, old = {}, custom) {
    const sp = spec(id, custom); if (!sp || !sp.sections.length) throw new Error('No practice-exam sections for this template'); j = j || {};
    const date = j.date ?? old.date; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || isNaN(new Date(date + 'T00:00:00Z'))) throw new Error('date required (YYYY-MM-DD)');
    const out = { exam: id, date, source: String(j.source ?? old.source ?? '').trim().slice(0, 80) || 'Practice exam', notes: String(j.notes ?? old.notes ?? '').trim().slice(0, 1000) };
    for (const [k, l, , lo, hi, st, req] of sp.sections) { const raw = j[k] !== undefined ? j[k] : old[k]; const v = raw === '' || raw == null ? null : Number(raw);
      if (v == null) { if (req) throw new Error(l + ' score is required'); out[k] = null; continue; }
      if (!ok(v, lo, hi, st)) throw new Error(`${l} must be from ${lo} to ${hi}${st !== 1 ? ' in steps of ' + st : ''}`); out[k] = v; }
    if (sp.total.entered) { const raw = j.total !== undefined ? j.total : old.total, v = raw === '' || raw == null ? NaN : Number(raw), t = sp.total;
      if (!ok(v, t.min, t.max, t.endsIn5 ? 10 : t.step)) throw new Error(`${t.label} must be from ${t.min} to ${t.max}${t.endsIn5 ? ' and end in 5' : ''}`); out.total = v; }
    else out.total = totalOf(sp, out);
    for (const [name, keys, how] of sp.extra || []) out[name === 'STEM' ? 'stem' : 'ts'] = calc(how, keys, out);
    return out; }
  const cleanGoal = (id, g, custom) => { if (g === null || g === '' || g === undefined) return null; const sp = spec(id, custom), n = Number(g); if (!sp || !(n >= sp.total.min && n <= sp.total.max)) throw new Error(`goal must be from ${sp ? sp.total.min : 0} to ${sp ? sp.total.max : 0}`); return n; };
  function summary(list, id) {
    const xs = (list || []).filter(x => x.exam === id && x.total != null).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    if (!xs.length) return { n: 0, exams: [] };
    const first = xs[0], last = xs[xs.length - 1], prev = xs.length > 1 ? xs[xs.length - 2] : null;
    const best = xs.reduce((b, x) => x.total > b.total || (x.total === b.total && x.date > b.date) ? x : b, first);
    const d = (a, b, k) => b && a[k] != null && b[k] != null ? +(a[k] - b[k]).toFixed(1) : null;
    const keys = ['total', ...Object.keys(last).filter(k => !['id', 'exam', 'date', 'source', 'notes', 'total'].includes(k))];
    return { n: xs.length, exams: xs, first, last, prev, best, change: Object.fromEntries(keys.map(k => [k, { prev: d(last, prev, k), first: xs.length > 1 ? d(last, first, k) : null }])) }; }
  const api = { SPECS, SOURCES, spec, customSpec, cleanCustomSections, clean, cleanGoal, summary, totalOf };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PRACTICE = api;
})(typeof self !== 'undefined' ? self : this);
