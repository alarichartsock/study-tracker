// Trophy 3D model specs: pure, deterministic per achievement. Shared by the browser (window.TrophySpec) and tests.
(function (root) {
  'use strict';
  const TIERS = ['bronze', 'silver', 'gold', 'platinum'];
  const METAL = { bronze: '#c27c45', silver: '#c9cfd8', gold: '#f2c14e', platinum: '#d9f0f4' };
  const BASES = { launch: 'rocket', time: 'hourglass', streaks: 'flame', intensity: 'bolt', focus: 'crystal', goals: 'target', medals: 'medal', explore: 'globe', mine: 'cup' };
  const ACCENTS = ['#ff6b6b', '#4dabf7', '#51cf66', '#cc5de8', '#ff922b', '#22b8cf', '#f06595', '#94d82d', '#845ef7', '#fcc419', '#20c997', '#5c7cfa'];
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  // Tier from rank of the target among achievements sharing category + unit (global) or ladder position (personal).
  function tiers(list) {
    const out = {}, groups = {};
    for (const a of list) (groups[(a.cat || a.kind || 'x') + '|' + (a.unit || '') + '|' + (a.key || '')] ||= []).push(a);
    for (const g of Object.values(groups)) { g.sort((a, b) => a.target - b.target); g.forEach((a, i) => { const r = g.length > 1 ? i / (g.length - 1) : 0; out[a.id] = TIERS[Math.min(3, Math.floor(r * 3.999))]; }); }
    return out;
  }
  function spec(a, tier, subjectColor) {
    const h = hash(a.id), cat = a.cat || 'mine', base = BASES[cat] || 'cup';
    return { id: a.id, base, tier: tier || 'bronze', metal: METAL[tier || 'bronze'], accent: a.kind === 'subject' && subjectColor ? subjectColor : ACCENTS[h % ACCENTS.length],
      variant: (h >>> 4) % 4, detail: 2 + ((h >>> 8) % 4), twist: ((h >>> 12) % 360), plinth: (h >>> 20) % 3, stars: TIERS.indexOf(tier || 'bronze') + 1, unit: a.unit || 'n', earned: !!a.earned };
  }
  const signature = s => [s.base, s.tier, s.accent, s.variant, s.detail, s.plinth, s.unit].join('/');
  const api = { TIERS, METAL, BASES, tiers, spec, signature, hash };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TrophySpec = api;
})(typeof self !== 'undefined' ? self : this);
