// StudyHertz i18n: dependency-free. English source strings are the keys; catalogs live in /i18n/<lang>.json.
// Shared by the browser (DOM translator) and the server (localized landing pages).
(function (root) {
  'use strict';
  const LANGS = ['en', 'es', 'zh-CN', 'ko', 'hi', 'vi', 'fr'];
  const NAMES = { en: 'English', es: 'Español', 'zh-CN': '简体中文', ko: '한국어', hi: 'हिन्दी', vi: 'Tiếng Việt', fr: 'Français' };
  const PATHS = { es: 'es', 'zh-CN': 'zh-cn', ko: 'ko', hi: 'hi', vi: 'vi', fr: 'fr' }; // URL prefix per locale (en = "/")
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  // Best supported locale for a list of BCP-47 tags (Accept-Language / navigator.languages order).
  function pick(tags) {
    for (const t0 of tags || []) { const t = String(t0 || '').trim().toLowerCase(); if (!t) continue;
      const hit = LANGS.find(l => l.toLowerCase() === t); if (hit) return hit;
      const base = t.split('-')[0]; if (base === 'zh') return /tw|hk|mo|hant/.test(t) ? null : 'zh-CN';
      const b = LANGS.find(l => l.toLowerCase() === base); if (b) return b; }
    return null;
  }
  const parseAL = h => String(h || '').split(',').map(x => { const [t, q] = x.trim().split(';q='); return [t, q === undefined ? 1 : +q]; }).filter(x => x[0] && x[1] > 0).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  // Compile a catalog: exact keys plus placeholder patterns ("{0} sessions · {1}") matched as regexes.
  function compile(dict) {
    const exact = new Map(), pats = [];
    for (const [k, v] of Object.entries(dict || {})) {
      if (!/\{\d\}/.test(k)) { exact.set(k, v); continue; }
      const lit = k.replace(/\{\d\}/g, ''); if ((lit.match(/\p{L}/gu) || []).length < 3) continue; // too generic to match safely
      const order = []; const src = k.split(/(\{\d\})/).map(p => { const m = /^\{(\d)\}$/.exec(p); if (m) { order.push(+m[1]); return '(.+?)'; } return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('');
      pats.push({ re: new RegExp('^' + src + '$', 'u'), order, v, n: lit.length });
    }
    pats.sort((a, b) => b.n - a.n);
    // fragment keys glued after dynamic text ("42% of goal", "Name, earned")
    const tails = [...exact.keys()].filter(k => /^[%,·]/.test(k) && k.length > 3).sort((a, b) => b.length - a.length);
    const t = (s, depth = 0) => {
      const k = norm(s); if (!k) return s; const e = exact.get(k); if (e !== undefined) return e;
      if (depth > 2) return null;
      for (const p of pats) { const m = p.re.exec(k); if (!m) continue; const vals = {};
        p.order.forEach((idx, i) => { const g = m[i + 1]; const sub = t(g, depth + 1); vals[idx] = sub == null ? g : sub; });
        return p.v.replace(/\{(\d)\}/g, (_, d) => vals[d] ?? ''); }
      if (k.includes(' · ')) { const parts = k.split(' · '), out = parts.map(x => t(x, depth + 1)); if (out.some(x => x != null)) return out.map((x, i) => x == null ? parts[i] : x).join(' · '); }
      for (const tl of tails) if (k.endsWith(tl) && k.length > tl.length) { const head = k.slice(0, -tl.length); return (t(head, depth + 1) ?? head) + exact.get(tl); }
      return null;
    };
    return t;
  }
  const api = { LANGS, NAMES, PATHS, pick, parseAL, compile, norm };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  // ---------------- browser ----------------
  const pathLang = (() => { const seg = location.pathname.split('/')[1] || ''; return Object.keys(PATHS).find(l => PATHS[l] === seg) || null; })();
  let stored = null; try { stored = localStorage.lang || null; } catch { /* private mode */ }
  const lang = pathLang || (LANGS.includes(stored) ? stored : null) || pick(navigator.languages || [navigator.language]) || 'en';
  document.documentElement.lang = lang; document.documentElement.dataset.lang = lang;
  let T = s => null; const done = new WeakMap(); const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
  const skipEl = el => !el || SKIP.has(el.nodeName) || el.closest?.('[data-noi18n],[contenteditable=true]');
  function trText(n) {
    const prev = done.get(n), cur = n.nodeValue; if (prev && prev.out === cur) return;
    const out = T(cur); if (out == null) { done.set(n, { out: cur }); return; }
    const lead = cur.match(/^\s*/)[0], trail = cur.match(/\s*$/)[0], val = lead + out + trail; done.set(n, { out: val }); if (val !== cur) n.nodeValue = val;
  }
  function trAttrs(el) { for (const a of ATTRS) { const v = el.getAttribute(a); if (!v) continue; const key = '__i18n_' + a;
    if (el[key] === v) continue; const out = T(v); const nv = out == null ? v : out; el[key] = nv; if (nv !== v) el.setAttribute(a, nv); } }
  function walk(root) {
    if (root.nodeType === 3) { if (!skipEl(root.parentElement)) trText(root); return; }
    if (root.nodeType !== 1 || skipEl(root)) return;
    trAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && SKIP.has(n.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) { if (/\S/.test(n.nodeValue) && !skipEl(n.parentElement)) trText(n); } else if (!n.closest('[data-noi18n]')) trAttrs(n); }
  }
  let titleSrc = null;
  function trTitle() { const cur = document.title; if (cur === titleSrc) return; const out = T(cur); titleSrc = out == null ? cur : out; if (titleSrc !== cur) document.title = titleSrc; }
  function start(dict) {
    T = compile(dict); walk(document.body); trTitle();
    new MutationObserver(ms => { for (const m of ms) {
      if (m.type === 'characterData') { if (!skipEl(m.target.parentElement)) trText(m.target); }
      else if (m.type === 'attributes') { if (!skipEl(m.target)) trAttrs(m.target); }
      else m.addedNodes.forEach(walk); } trTitle(); })
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    for (const f of ['alert', 'confirm', 'prompt']) { const o = window[f].bind(window); window[f] = (msg, ...r) => o(msg == null ? msg : (T(msg) ?? msg), ...r); }
  }
  const t = s => { const o = T(s); return o == null ? s : o; };
  function setLang(l, opts = {}) {
    if (!LANGS.includes(l)) return; try { localStorage.lang = l; } catch { /* ignore */ }
    if (opts.save) opts.save(l);
    const ld = document.getElementById('landing'), onLanding = !!ld && !ld.classList.contains('hid');
    if (onLanding && (pathLang || l !== 'en' || location.pathname === '/')) location.href = (l === 'en' ? '/' : '/' + PATHS[l] + '/') + location.hash;
    else location.reload();
  }
  const globe = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
  const picker = (id) => `<label class="lang-pick" title="Language">${globe}<select ${id ? `id="${id}" ` : ''}data-noi18n aria-label="${t('Language')}">${LANGS.map(l => `<option value="${l}"${l === lang ? ' selected' : ''}>${NAMES[l]}</option>`).join('')}</select></label>`;
  root.SHI18N = { ...api, lang, pathLang, t, setLang, picker, locale: () => lang, ready: null };
  const saveRemote = l => { const app = document.getElementById('app'); if (app && !app.classList.contains('hid')) return fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ lang: l }), keepalive: true }).catch(() => {}); };
  document.addEventListener('change', e => { const s = e.target; if (s && s.matches && s.matches('.lang-pick select')) setLang(s.value, { save: saveRemote }); });
  const mount = () => { const slot = document.getElementById('langTop'); if (slot && !slot.firstChild) slot.innerHTML = picker(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount) : mount();
  root.SHI18N.ready = lang === 'en' ? Promise.resolve() : (root.SH_I18N_DICT ? Promise.resolve(root.SH_I18N_DICT) : fetch('/i18n/' + lang.toLowerCase() + '.json').then(r => r.json()))
    .then(d => { if (!d) return; const go = () => start(d); document.body ? go() : document.addEventListener('DOMContentLoaded', go); }).catch(() => {});
})(typeof self !== 'undefined' ? self : this);
