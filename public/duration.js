// Duration values for StudyHertz. The visible control is html-duration-picker (one field).
// Stored goals stay whole minutes. 2.5 hours is 150 minutes and loads as 02:30.
(function (root) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fromHours(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 60) : null;
    const s = String(v).trim().toLowerCase().replace(/,/g, '.');
    if (!s) return null;
    let m = /^(\d+(?:\.\d+)?)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(s);
    if (m) return Math.round(+m[1] * 60) + (+m[2] || 0);
    m = /^(\d+)\s*m(?:in(?:utes?)?)?$/.exec(s);
    if (m) return +m[1];
    m = /^(\d+):(\d{1,2})$/.exec(s);
    if (m) return (+m[1]) * 60 + Math.min(59, +m[2]);
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 60);
  }

  function splitMin(total) {
    if (total == null || total === '') return { h: '', m: '' };
    const n = Math.round(Number(total));
    if (!Number.isFinite(n) || n < 0) return { h: '', m: '' };
    return { h: Math.floor(n / 60), m: n % 60 };
  }

  function join(hRaw, mRaw, opt = {}) {
    const hs = String(hRaw ?? '').trim(), ms = String(mRaw ?? '').trim();
    if (hs === '' && ms === '') return opt.blank ? null : 0;
    if (/[.,]/.test(hs)) {
      const base = fromHours(hs.replace(',', '.'));
      const extra = ms === '' ? 0 : Math.round(Number(ms.replace(',', '.')));
      if (base == null || !Number.isFinite(extra)) return opt.blank ? null : 0;
      return Math.max(0, base + Math.max(0, extra));
    }
    let h = hs === '' ? 0 : Number(hs), m = ms === '' ? 0 : Number(ms);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return opt.blank ? null : 0;
    if (h < 0) h = 0;
    if (m < 0) m = 0;
    h = Math.trunc(h);
    m = Math.round(m);
    if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
    let total = h * 60 + m;
    if (opt.clock) {
      const maxH = opt.maxHour != null ? opt.maxHour : 23;
      if (h > maxH) { h = maxH; total = h * 60 + Math.min(m, 59); }
    }
    return total;
  }

  function short(min) {
    min = Math.max(0, Math.round(+min || 0));
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + 'm';
    if (!m) return h + 'h';
    return h + 'h ' + m + 'm';
  }

  function parseList(text) {
    return String(text || '').split(/[,]+/).map(s => s.trim()).filter(Boolean).map(token => {
      if (/[hms:]/i.test(token)) return fromHours(token);
      const n = Number(token);
      return Number.isFinite(n) ? Math.round(n) : NaN;
    }).filter(n => Number.isFinite(n) && n > 0);
  }

  // "H:MM" for the picker. Hours are not capped at two digits (a term goal can be 700:00).
  function fmt(min) {
    const n = Math.max(0, Math.round(Number(min) || 0));
    const h = Math.floor(n / 60);
    return String(h).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }
  function parseField(value) {
    const v = String(value ?? '').trim();
    if (!v) return null;
    if (!/^\d{1,9}:\d{1,2}$/.test(v)) return fromHours(v);
    const [h, m] = v.split(':').map(Number);
    if (m > 59) return null;
    return h * 60 + m;
  }

  function fields(o = {}) {
    const id = String(o.id || 'dur').replace(/[^\w:-]/g, '') || 'dur';
    const label = o.label || 'Duration';
    const empty = o.blank && (o.minutes == null || o.minutes === '' || (o.emptyZero && !Math.round(+o.minutes || 0)));
    const val = empty ? '' : fmt(o.minutes || 0);
    const max = fmt(o.maxMin != null ? o.maxMin : 24 * 60);
    const min = fmt(o.minMin || 0);
    const attrs = ['type="text"', 'class="html-duration-picker' + (o.cls ? ' ' + String(o.cls).replace(/[^\w -]/g, '') : '') + '"',
      'id="' + id + '"', 'data-hm="' + id + '"', 'data-hide-seconds', 'data-duration-max="' + max + '"', 'data-duration-min="' + min + '"',
      'inputmode="numeric"', 'autocomplete="off"', 'aria-label="' + esc(label) + '"', 'value="' + esc(val) + '"'];
    if (!empty) attrs.push('data-duration="' + esc(val) + '"');
    if (o.blank) attrs.push('data-allow-blank', 'placeholder="' + esc(o.placeholder || 'same') + '"');
    if (o.chg) attrs.push('data-chg="' + esc(o.chg) + '"');
    if (o.name) attrs.push('name="' + esc(o.name) + '"');
    return '<input ' + attrs.join(' ') + '>';
  }

  function inputOf(el) {
    if (!el) return null;
    if (el.matches && el.matches('input[data-hm]')) return el;
    return el.querySelector ? el.querySelector('input[data-hm]') : null;
  }
  function read(el) {
    const input = inputOf(el);
    if (!input) return null;
    const v = input.value.trim();
    if (!v) return input.hasAttribute('data-allow-blank') ? null : 0;
    const n = parseField(v);
    return n == null ? (input.hasAttribute('data-allow-blank') ? null : 0) : n;
  }
  function readClock(el) { const total = read(el) || 0; return { hour: Math.floor(total / 60), minute: total % 60 }; }
  function write(el, minutes) {
    const input = inputOf(el);
    if (!input) return;
    if (minutes == null || minutes === '') { input.value = ''; return; }
    input.value = fmt(minutes);
  }
  function bind() { if (root.HtmlDurationPicker) root.HtmlDurationPicker.refresh(); }

  const api = { fromHours, splitMin, join, short, parseList, fmt, parseField, fields, read, readClock, write, bind };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Dur = api;
})(typeof self !== 'undefined' ? self : this);
