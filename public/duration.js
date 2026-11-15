// Hour + minute duration fields. Shared by the browser (window.Dur) and tests (require).
// Stored durations stay whole minutes (goals, pomodoro, subject goals, plans) or whole seconds
// (session breakSec and countdown targetSec = minutes * 60). A value that used to be shown as
// 2.5 hours is 150 minutes and comes back as 2h 30m.
(function (root) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Minutes from a fractional hour (2.5, "2,5", "2h 30m", "2:30", "90m"). null when it isn't a duration.
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

  // { h, m } from a stored minute count. null/'' stays blank so "same as weekday" can stay empty.
  function splitMin(total) {
    if (total == null || total === '') return { h: '', m: '' };
    const n = Math.round(Number(total));
    if (!Number.isFinite(n) || n < 0) return { h: '', m: '' };
    return { h: Math.floor(n / 60), m: n % 60 };
  }

  function capTotal(total, opt) {
    total = Math.max(0, Math.round(total));
    if (!opt.clock) return total;
    const maxH = opt.maxHour != null ? opt.maxHour : 23;
    let h = Math.floor(total / 60), m = total % 60;
    if (h > maxH) h = maxH;
    if (m > 59) m = 59;
    return h * 60 + m;
  }

  // Minutes from the two fields. Both empty + blank => null (weekend "same"). Otherwise empty means 0.
  // Minutes past 59 carry into hours. A decimal in the hour field ("2.5") is 2h 30m.
  function join(hRaw, mRaw, opt = {}) {
    const hs = String(hRaw ?? '').trim(), ms = String(mRaw ?? '').trim();
    if (hs === '' && ms === '') return opt.blank ? null : 0;
    if (/[.,]/.test(hs)) {
      const base = fromHours(hs.replace(',', '.'));
      const extra = ms === '' ? 0 : Math.round(Number(ms.replace(',', '.')));
      if (base == null || !Number.isFinite(extra)) return opt.blank ? null : 0;
      return capTotal(base + Math.max(0, extra), opt);
    }
    let h = hs === '' ? 0 : Number(hs), m = ms === '' ? 0 : Number(ms);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return opt.blank ? null : 0;
    if (h < 0) h = 0;
    if (m < 0) m = 0;
    h = Math.trunc(h);
    m = Math.round(m);
    if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
    return capTotal(h * 60 + m, opt);
  }

  function short(min) {
    min = Math.max(0, Math.round(+min || 0));
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + 'm';
    if (!m) return h + 'h';
    return h + 'h ' + m + 'm';
  }

  // Quick-duration list: bare numbers stay minutes; "1:30" and "1h 30m" are exact.
  function parseList(text) {
    return String(text || '').split(/[,]+/).map(s => s.trim()).filter(Boolean).map(token => {
      if (/[hms:]/i.test(token)) return fromHours(token);
      const n = Number(token);
      return Number.isFinite(n) ? Math.round(n) : NaN;
    }).filter(n => Number.isFinite(n) && n > 0);
  }

  function fields(o = {}) {
    const id = String(o.id || 'hm').replace(/[^\w:-]/g, '') || 'hm';
    const label = o.label || 'Duration';
    const blankish = o.minutes == null || o.minutes === '' || (o.emptyZero && !Math.round(+o.minutes || 0));
    const p = blankish ? { h: '', m: '' } : splitMin(o.minutes);
    const hv = p.h === '' ? '' : String(p.h), mv = p.m === '' ? '' : String(p.m);
    const chg = o.chg ? ' data-chg="' + esc(o.chg) + '"' : '';
    const cls = 'hm' + (o.cls ? ' ' + String(o.cls).replace(/[^\w -]/g, '') : '');
    const extra = (o.blank ? ' data-blank="1"' : '') + (o.clock ? ' data-clock="1"' : '') + (o.maxHour != null ? ' data-max-hour="' + (+o.maxHour) + '"' : '');
    const maxH = o.maxHour != null ? ' max="' + (+o.maxHour) + '"' : '';
    return '<div class="' + cls + '" id="' + id + '" data-hm="' + id + '"' + extra + ' role="group" aria-label="' + esc(label) + '">' +
      '<div class="hm-u"><label for="' + id + 'h">h</label><input type="number" inputmode="numeric" id="' + id + 'h" data-part="h" min="0"' + maxH + ' step="any" value="' + hv + '"' + chg + ' autocomplete="off" aria-label="' + esc(label) + ' hours"></div>' +
      '<div class="hm-u"><label for="' + id + 'm">m</label><input type="number" inputmode="numeric" id="' + id + 'm" data-part="m" min="0" max="59" step="5" value="' + mv + '"' + chg + ' autocomplete="off" aria-label="' + esc(label) + ' minutes"></div></div>';
  }

  function boxOf(el) {
    if (!el) return null;
    if (el.classList && el.classList.contains('hm')) return el;
    return el.closest ? el.closest('.hm') : null;
  }
  function optsOf(box) {
    return { blank: box.dataset.blank === '1', clock: box.dataset.clock === '1', maxHour: box.dataset.maxHour != null && box.dataset.maxHour !== '' ? +box.dataset.maxHour : null };
  }
  function syncStep(input) {
    if (!input) return;
    const v = input.value.trim();
    input.step = (v === '' || (Number.isFinite(+v) && +v % 5 === 0)) ? '5' : 'any';
  }
  function mirror(box, total) {
    const id = box.dataset.hm, form = box.closest && box.closest('form');
    const hid = id && form && form.querySelector('input[type="hidden"][name="' + id + '"]');
    if (hid) hid.value = total == null || total === '' ? '' : String(total);
  }
  function normalize(el) {
    const box = boxOf(el); if (!box) return null;
    const hIn = box.querySelector('[data-part=h]'), mIn = box.querySelector('[data-part=m]'), opt = optsOf(box);
    if (!opt.clock && hIn.value.trim() === '' && mIn.value.trim() === '') { mirror(box, ''); return null; }
    const total = join(hIn.value, mIn.value, opt);
    if (total == null) { hIn.value = ''; mIn.value = ''; mirror(box, ''); return null; }
    const p = splitMin(total);
    hIn.value = String(p.h); mIn.value = String(p.m); mIn.dataset.last = mIn.value; syncStep(mIn); mirror(box, total);
    return total;
  }
  function read(el) {
    const box = boxOf(el); if (!box) return null;
    return join(box.querySelector('[data-part=h]').value, box.querySelector('[data-part=m]').value, optsOf(box));
  }
  function readClock(el) { const total = read(el) || 0; return { hour: Math.floor(total / 60), minute: total % 60 }; }
  function write(el, minutes) {
    const box = boxOf(el); if (!box) return;
    const hIn = box.querySelector('[data-part=h]'), mIn = box.querySelector('[data-part=m]');
    if (minutes == null || minutes === '') { hIn.value = ''; mIn.value = ''; mIn.dataset.last = ''; syncStep(mIn); mirror(box, ''); return; }
    const p = splitMin(minutes);
    hIn.value = String(p.h); mIn.value = String(p.m); mIn.dataset.last = mIn.value; syncStep(mIn); mirror(box, Math.round(Number(minutes)));
  }
  function bind(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.hm').forEach(box => {
      if (box.dataset.bound) return; box.dataset.bound = '1';
      const mIn = box.querySelector('[data-part=m]'); if (mIn) { mIn.dataset.last = mIn.value; syncStep(mIn); }
      box.addEventListener('keydown', e => {
        const t = e.target; if (!t.matches || !t.matches('[data-part=m]')) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? 1 : -1, cur = t.value.trim() === '' ? 0 : +t.value, base = Number.isFinite(cur) ? cur : 0;
        t.dataset.nudged = '1'; t.value = String(Math.max(0, base + dir * 5));
        t.dispatchEvent(new Event('input', { bubbles: true }));
      });
      box.addEventListener('input', e => {
        const t = e.target; if (!t.matches || !t.matches('[data-part=m]')) return;
        if (t.dataset.nudged) { delete t.dataset.nudged; normalize(box); return; }
        const raw = t.value.trim();
        if (raw !== '' && Number(raw) >= 60) { normalize(box); return; }
        if (!e.inputType && t.getAttribute('step') === 'any') {
          const prev = t.dataset.last == null || t.dataset.last === '' ? 0 : +t.dataset.last, cur = raw === '' ? prev : +raw;
          if (Number.isFinite(prev) && Number.isFinite(cur) && Math.abs(cur - prev) === 1) t.value = String(Math.max(0, prev + (cur >= prev ? 5 : -5)));
        }
        t.dataset.last = t.value; syncStep(t);
        if (+t.value >= 60) normalize(box);
      });
      box.addEventListener('blur', e => { if (e.target.matches && e.target.matches('input')) normalize(box); }, true);
    });
  }

  const api = { fromHours, splitMin, join, short, parseList, fields, read, readClock, write, normalize, bind };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Dur = api;
})(typeof self !== 'undefined' ? self : this);
