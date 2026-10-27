// Responsive / mobile UI checks (Playwright, Chromium + WebKit). Not part of `npm test`; run with `npm run test:ui`.
// Playwright is installed on demand (npm i --no-save playwright) so the app itself stays dependency-free.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const require = createRequire(import.meta.url);
const { createApp } = require('../server.js');
const pw = await import('playwright');

const OUT = process.env.UI_SHOTS || path.resolve('ui-shots'); fs.mkdirSync(OUT, { recursive: true });
const BROWSERS = (process.env.UI_BROWSERS || 'chromium,webkit').split(',');
const WIDTHS = (process.env.UI_WIDTHS || '320,375,390,414,768,1024,1280,1440').split(',').map(Number);
const SHOT_W = process.env.UI_SHOT_WIDTHS ? process.env.UI_SHOT_WIDTHS.split(',').map(Number) : null, DPR = +process.env.UI_DPR || 0;
const VIEWS = ['timer', 'dash', 'sess', 'cal', 'stats', 'mcat', 'plan', 'trophy', 'data', 'set'];

// ---- server on a temp data dir with a seeded, fake test user ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-ui-'));
const server = createApp({ dataFile: path.join(dir, 'data.json'), reportsDir: path.join(dir, 'reports'), minSessionSec: 0 });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
let cookie = '';
const api = async (p, method = 'GET', body) => { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r.json().catch(() => null); };
await api('/api/register', 'POST', { username: 'uitest', password: 'ui-test-pass-123' });
await api('/api/settings', 'POST', { goals: { dailyMin: 120, weeklyMin: 900 } });
const subjects = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'], acts = ['Lecture', 'Flashcards', 'Practice questions', 'Review', 'Reading with a rather long activity name'];
const now = new Date();
for (let d = 0; d < 45; d++) for (let k = 0; k < 1 + (d % 3); k++) {
  const st = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, 7 + k * 4 + (d % 5), 0), mins = 30 + ((d * 37 + k * 11) % 150);
  await api('/api/sessions', 'POST', { subject: subjects[(d + k) % 4], activity: acts[(d * 2 + k) % acts.length], note: d % 4 ? '' : 'Sample note', start: st.toISOString(), end: new Date(+st + mins * 6e4).toISOString(), breakSec: d % 6 ? 0 : 300, focus: 1 + (d % 5), progress: 1 + ((d + 2) % 5) });
}
await api('/api/exams', 'POST', { name: 'Practice exam 1', date: new Date(+now + 9 * 864e5).toISOString().slice(0, 10), subject: 'CARS' });
for (const [i, x] of [[124, 123, 125, 126], [125, 125, 126, 127], [127, 124, 128, 128], [128, 127, 129, 130]].entries()) await api('/api/practice', 'POST', { date: new Date(+now - (40 - i * 10) * 864e5).toISOString().slice(0, 10), source: ['AAMC Sample', 'Blueprint 2 with a long provider name', 'AAMC FL1', 'AAMC FL2'][i], cp: x[0], cars: x[1], bb: x[2], ps: x[3], notes: i === 1 ? 'Ran out of time on CARS' : '' });
await api('/api/practice-goal', 'POST', { goal: 515 });
await api('/api/tasks', 'POST', { title: 'Review amino acids', priority: 'high' });
for (let i = 0; i < 24; i++) await api('/api/tasks', 'POST', { title: (i % 5 ? 'Practice set ' + i : 'A very long to-do title that should be truncated cleanly instead of wrapping ' + i), due: i % 4 === 3 ? '' : new Date(+now + (i % 9 - 3) * 864e5).toISOString().slice(0, 10), subject: i % 3 ? subjects[i % 4] : '', priority: i % 7 ? 'normal' : 'high' });
const sid = cookie.split('=')[1];

// ---- checks run inside the page ----
function pageChecks(phone) {
  const vw = document.documentElement.clientWidth, vh = innerHeight, d = document.documentElement, fails = [];
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && cs.display !== 'none'; };
  const inside = (r, slack = 1) => r.left >= -slack && r.top >= -slack && r.right <= vw + slack && r.bottom <= vh + slack;
  if (d.scrollWidth > vw + 1) fails.push('horizontal overflow: scrollWidth ' + d.scrollWidth + ' > ' + vw);
  const app = document.getElementById('app');
  if (app && !app.classList.contains('hid')) {
    const nav = document.getElementById('nav');
    if (!vis(nav)) fails.push('nav not visible');
    else {
      const nr = nav.getBoundingClientRect(); if (!inside(nr)) fails.push('nav outside viewport ' + JSON.stringify([nr.left, nr.top, nr.right, nr.bottom].map(Math.round)));
      if (phone && nr.top < vh / 2) fails.push('phone nav is not at the bottom (top=' + Math.round(nr.top) + ')');
      const btns = [...nav.querySelectorAll('button')]; if (!btns.length) fails.push('nav has no items');
      const scrollable = nav.scrollWidth > nav.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(nav).overflowX);
      for (const b of btns) { if (!vis(b) || !b.querySelector('svg') || !vis(b.querySelector('svg'))) { fails.push('nav item hidden: ' + b.dataset.v); continue; }
        const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(Math.min(vw - 2, Math.max(1, r.left + r.width / 2)), r.top + r.height / 2);
        if (inside(r)) { if (!hit || !hit.closest('#nav')) fails.push('nav item covered: ' + b.dataset.v + ' by ' + (hit && (hit.id || hit.className))); }
        else if (!scrollable) fails.push('nav item outside viewport and nav not scrollable: ' + b.dataset.v); }
    }
    const add = document.getElementById('addBtn'), theme = document.getElementById('themeBtn');
    for (const [n, el] of [['+ Session', add], ['theme', theme]]) { if (!vis(el)) fails.push(n + ' not visible'); else if (!inside(el.getBoundingClientRect())) fails.push(n + ' outside viewport'); }
    if (vis(add) && vis(theme)) { const a = add.getBoundingClientRect(), t = theme.getBoundingClientRect(); if (a.right > t.left + 1 && a.left < t.right - 1 && a.bottom > t.top + 1 && a.top < t.bottom - 1) fails.push('+ Session overlaps theme toggle'); }
  }
  for (const el of document.querySelectorAll('.ach-cats button, .tabs button, .top-r button, .btn, #main .chip')) { if (!vis(el) || getComputedStyle(el).overflow === 'visible' && el.scrollWidth <= el.clientWidth) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') fails.push('clipped text: "' + el.textContent.trim().slice(0, 40) + '" (' + el.scrollWidth + '>' + el.clientWidth + ')'); }
  for (const ring of document.querySelectorAll('.goal-ring')) { const rr = ring.getBoundingClientRect(), cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2, inner = rr.width * 0.38;
    for (const el of ring.querySelectorAll('.ring-center .g-pct, .ring-center .g-sub > span')) { const q = el.getBoundingClientRect(); if (!q.width) continue;
      if (el.scrollWidth > el.clientWidth + 1) fails.push('goal ring text clipped: "' + el.textContent + '"');
      const far = Math.max(...[[q.left, q.top], [q.right, q.top], [q.left, q.bottom], [q.right, q.bottom]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      if (far > inner + 2) fails.push('goal ring text exceeds inner circle: "' + el.textContent + '" (' + Math.round(far) + '>' + Math.round(inner) + ')'); } }
  for (const ax of document.querySelectorAll('.yax, .px-chart:not(.px-spark .px-chart)')) { if (!vis(ax)) continue; const card = ax.closest('.card').getBoundingClientRect(), ls = [...ax.querySelectorAll('.yg i, .px-gl i')].map(i => i.getBoundingClientRect());
    if (ls.length < 3) fails.push('chart y-axis has ' + ls.length + ' tick labels');
    for (const q of ls) if (q.left < card.left - 1 || q.left < -1) fails.push('y-axis label clipped (' + Math.round(q.left) + ')');
    const sorted = ls.slice().sort((a, b) => a.top - b.top); for (let i = 1; i < sorted.length; i++) if (sorted[i].top < sorted[i - 1].bottom - 0.5) fails.push('y-axis labels overlap'); }
  for (const h of document.querySelectorAll('.cum-hit')) { const w = h.closest('.cum-wrap'), svg = w.querySelector('svg'), q = h.getBoundingClientRect(), cy = q.top + q.height / 2, el = cy > 0 && cy < innerHeight ? document.elementFromPoint(q.left + q.width / 2, cy) : null; if (q.width && el && !el.closest('#nav, .topbar, header, .chart-tip') && !el.closest('.cum-hit')) fails.push('share-price hover strips are covered'); if (!h.querySelector('[data-tip]')) fails.push('share-price chart has no tooltips'); void svg; }
  for (const ch of document.querySelectorAll('.px-link, .mix-chip')) { if (!vis(ch)) continue; const r = ch.getBoundingClientRect(), nx = ch.parentElement.querySelector('.card'); if (nx) { const g = nx.getBoundingClientRect().top - r.bottom; if (g < 8) fails.push('Stats chip too close to the card below (' + Math.round(g) + 'px)'); } }
  { const lo = document.getElementById('logoutBtn'); if (lo && vis(lo)) { if (lo.getAttribute('aria-label') !== 'Sign out' || !lo.querySelector('svg')) fails.push('sign-out button lacks icon/label'); const r = lo.getBoundingClientRect(); if (r.right > vw + 1 || r.width < 30) fails.push('sign-out button clipped'); } }
  for (const c of document.querySelectorAll('.todo-card')) { const q = c.getBoundingClientRect(), want = parseFloat(getComputedStyle(c).height), list = c.querySelector('.todo-list'), lb = list.getBoundingClientRect();
    const cap = window.innerWidth <= 600 ? 400 : 360, hiddenN = list.querySelectorAll('.todo-it[hidden]').length; if (c.offsetHeight > cap + 1.5) fails.push('to-do card taller than its cap (' + c.offsetHeight + '>' + cap + ')'); void want;
    const rowH = Math.max(...[...list.querySelectorAll('.todo-it')].filter(i => !i.hidden).map(i => i.offsetHeight), 0); if (hiddenN && c.offsetHeight < cap - rowH - 2) fails.push('to-do card hides items before reaching its cap (' + c.offsetHeight + ')');
    { const kids = [...c.children].filter(k => !k.hidden && k.offsetHeight), last = Math.max(...kids.map(k => k.offsetTop + k.offsetHeight)), padB = parseFloat(getComputedStyle(c).paddingBottom); if (c.clientHeight - padB - last > 28 && c.offsetHeight > parseFloat(getComputedStyle(c).minHeight) + 1) fails.push('to-do card has blank space (' + Math.round(c.clientHeight - padB - last) + 'px)'); }
    if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) fails.push('to-do card content overflows');
    const shown = [...list.querySelectorAll('.todo-it')].filter(i => !i.hidden); for (const i of shown) { if (i.offsetTop + i.offsetHeight > list.clientHeight + 1 || i.offsetLeft + i.offsetWidth > list.clientWidth + 1) fails.push('to-do item spills out of card (' + (i.offsetTop + i.offsetHeight) + '>' + list.clientHeight + ')'); } void lb;
    if (shown.length < 2) fails.push('to-do card shows ' + shown.length + ' items'); const more = c.querySelector('.todo-more'); if (list.querySelectorAll('.todo-it[hidden]').length && (more.hidden || !/more/.test(more.textContent))) fails.push('to-do card hides items without a +N more note');
    if (!more.hidden && more.offsetTop + more.offsetHeight > c.clientHeight + 1) fails.push('to-do +N more clipped'); }
  if (document.querySelector('#nav button.on')?.dataset.v === 'dash' && !document.querySelector('.todo-card')) fails.push('to-do card missing on dashboard');
  for (const c of document.querySelectorAll('.px-home')) { const q = c.getBoundingClientRect(); if (q.right > vw + 1) fails.push('mcat home card overflows'); if (c.scrollWidth > c.clientWidth + 1) fails.push('mcat home card content overflows (' + c.scrollWidth + '>' + c.clientWidth + ')'); }
  if (location.hash !== '#x' && document.querySelector('#nav button.on')?.dataset.v === 'dash' && !document.querySelector('.px-home')) fails.push('mcat home card missing on dashboard');
  for (const c of document.querySelectorAll('.px-chart')) { const q = c.getBoundingClientRect(); if (q.right > vw + 1 || q.width < 100) fails.push('mcat chart overflows/collapsed (' + Math.round(q.width) + ')');
    for (const d of c.querySelectorAll('.px-dot')) { const r = d.getBoundingClientRect(); if (r.right > vw + 1 || r.left < -1) fails.push('mcat chart point off screen'); } }
  for (const el of document.querySelectorAll('.px-sec b, .px-sec span, .px-secs')) if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') fails.push('mcat section tile clipped');
  for (const bt of document.querySelectorAll('.bg-mode, .bg-win')) { const q = bt.closest('.card').getBoundingClientRect(); if (bt.scrollWidth > bt.clientWidth + 1) fails.push('background tabs overflow'); for (const b of bt.children) { const r = b.getBoundingClientRect(); if (r.right > q.right + 1 || r.right > bt.getBoundingClientRect().right + 1) fails.push('background tab clipped: ' + b.textContent); } }
  for (const rt of document.querySelectorAll('.range-tabs')) { const row = rt.parentElement, rb = row.getBoundingClientRect();
    if (rt.scrollWidth > rt.clientWidth + 1) fails.push('stats range tabs overflow (' + rt.scrollWidth + '>' + rt.clientWidth + ')');
    for (const el of [...rt.children, ...row.children]) { const q = el.getBoundingClientRect(); if (q.width && (q.right > rb.right + 1 || q.left < rb.left - 1 || q.right > vw + 1)) fails.push('stats range control clipped: "' + (el.textContent || el.tagName).trim().slice(0, 20) + '"'); } }
  for (const t of document.querySelectorAll('.tbl.dr')) { const rows = [...t.rows], n = rows[0] ? rows[0].cells.length : 0; if (rows.some(r => r.cells.length !== n)) fails.push('data room: row cell counts differ from header');
    if (t.getBoundingClientRect().right > vw + 1 && !t.closest('.tbl-wrap')) fails.push('data room table overflows page'); }
  return fails;
}

const failures = []; let shots = 0;
const note = (tag, list) => { for (const f of list) failures.push(tag + ': ' + f); };
async function runWidth(browser, bname, w) {
    const t0 = Date.now(), wantShots = !SHOT_W || SHOT_W.includes(w), shotFn = page => async o => { if (wantShots) { await page.screenshot(o); shots++; } };
    const phone = w <= 520, opts = { viewport: { width: w, height: phone ? 844 : 900 }, deviceScaleFactor: DPR || (phone ? 2 : 1), hasTouch: phone, ...(bname === 'firefox' ? {} : { isMobile: phone }), serviceWorkers: 'block' };
    const tag0 = bname + '@' + w;
    // landing (signed out)
    { const ctx = await browser.newContext(opts), page = await ctx.newPage(), errs = []; page.on('pageerror', e => errs.push('pageerror ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
      await page.goto(BASE + '/'); await page.waitForTimeout(700); note(tag0 + ' landing', [...errs, ...await page.evaluate(pageChecks, phone)]);
      await shotFn(page)({ path: path.join(OUT, `${tag0}-landing.png`) }); await ctx.close(); }
    const ctx = await browser.newContext(opts); await ctx.addCookies([{ name: 'sid', value: sid, url: BASE }]);
    const page = await ctx.newPage(), errs = []; page.on('pageerror', e => errs.push('pageerror ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
    await page.goto(BASE + '/'); await page.waitForTimeout(800); await page.evaluate(() => document.querySelector('dialog[open]')?.close());
    const check = async (tag, shot = true) => { await page.waitForTimeout(250); note(tag0 + ' ' + tag, [...errs.splice(0), ...await page.evaluate(pageChecks, phone)]);
      if (shot) { await shotFn(page)({ path: path.join(OUT, `${tag0}-${tag}.png`) }); }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(200);
      note(tag0 + ' ' + tag + ' (scrolled to bottom)', await page.evaluate(pageChecks, phone));
      if (shot) { await shotFn(page)({ path: path.join(OUT, `${tag0}-${tag}-bottom.png`) }); }
      await page.evaluate(() => window.scrollTo(0, 0)); };
    for (const v of VIEWS) { await page.evaluate(v => document.querySelector(`#nav button[data-v="${v}"]`).click(), v); await page.waitForTimeout(300); await check(v); }
    // achievements: every category + filters
    await page.evaluate(() => document.querySelector('#nav button[data-v="trophy"]').click()); await page.waitForTimeout(600);
    const cats = await page.evaluate(() => [...document.querySelectorAll('.ach-cats button')].map(b => b.dataset.v));
    for (const c of cats) { await page.evaluate(c => document.querySelector(`.ach-cats button[data-v="${c}"]`).click(), c); await page.waitForTimeout(350); await check('trophy-' + c, c === 'focus' || c === 'mine'); }
    // 3D trophies: thumbnails render non-blank pixels; the viewer opens a live non-blank canvas
    { await page.evaluate(() => { document.querySelector('.ach-cats button[data-v="all"]').click(); }); await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector('.ach-filter button[data-v="all"]').click()); await page.waitForTimeout(500);
      await page.locator('.trophy .t-ic[data-spec]').first().scrollIntoViewIfNeeded(); await page.waitForFunction(() => document.querySelector('canvas.t3d') || window.__t3dFallback, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      note(tag0 + ' trophy 3d', await page.evaluate(() => { const f = [], cs = [...document.querySelectorAll('canvas.t3d')]; if (window.__t3dFallback) f.push('WebGL unavailable: fell back to icons'); if (!cs.length) f.push('no 3D thumbnails rendered');
        for (const c of cs.slice(0, 3)) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; if (n < c.width * c.height * 0.05) f.push('3D thumbnail looks blank (' + n + ' px)'); }
        const r = cs[0]?.getBoundingClientRect(); if (r && r.right > document.documentElement.clientWidth + 1) f.push('3D thumbnail overflows'); return f; }));
      const t0b = page.locator('.trophy[data-act=trophyView]').first(); if (phone) await t0b.tap(); else await t0b.click(); await page.waitForTimeout(900);
      note(tag0 + ' trophy viewer', await page.evaluate(() => { const f = [], d = document.querySelector('dialog[open]'), cv = d && d.querySelector('canvas.t3d-live'); if (!d) return ['viewer did not open']; if (!cv) return window.__t3dFallback ? ['viewer fell back to icon'] : ['viewer has no live canvas'];
        const t = document.createElement('canvas'); t.width = 64; t.height = 64; const x = t.getContext('2d'); x.drawImage(cv, 0, 0, 64, 64); const p = x.getImageData(0, 0, 64, 64).data; let n = 0; for (let i = 3; i < p.length; i += 4) if (p[i] > 20) n++; if (n < 150) f.push('viewer canvas looks blank (' + n + ')');
        const vw = document.documentElement.clientWidth; if (d.getBoundingClientRect().right > vw + 1 || cv.getBoundingClientRect().right > vw + 1) f.push('viewer overflows'); return f; }));
      if (w === 390 || w === 1440) await shotFn(page)({ path: path.join(OUT, tag0 + '-trophy-viewer.png') });
      await page.evaluate(() => document.querySelector('dialog[open]')?.close('cancel')); await page.waitForTimeout(300); }
    for (const f of ['earned', 'locked', 'all']) { await page.evaluate(f => document.querySelector(`.ach-filter button[data-v="${f}"]`).click(), f); await page.waitForTimeout(450); await check('trophy-filter-' + f, false); }
    // add-session sheet
    await page.evaluate(() => document.getElementById('addBtn').click()); await page.waitForTimeout(600);
    note(tag0 + ' add-session sheet', await page.evaluate(() => { const dlg = document.querySelector('dialog[open]'), vw = document.documentElement.clientWidth, f = [];
      if (!dlg) return ['sheet did not open']; const r = dlg.getBoundingClientRect(); if (r.left < -1 || r.right > vw + 1) f.push('sheet wider than viewport');
      for (const el of dlg.querySelectorAll('input,select,textarea,button')) { const q = el.getBoundingClientRect(); if (q.width && (q.left < r.left - 1 || q.right > r.right + 1)) f.push('control outside sheet: ' + (el.name || el.textContent.trim().slice(0, 20))); }
      return f; }));
    await shotFn(page)({ path: path.join(OUT, `${tag0}-add-session.png`) });
    await page.evaluate(() => document.querySelector('dialog[open]')?.close()); await page.waitForTimeout(300);
    // timer fullscreen
    await page.evaluate(() => document.querySelector('#nav button[data-v="timer"]').click()); await page.waitForTimeout(500);
    const hasFs = await page.evaluate(() => { const b = document.querySelector('[data-act="fullscreen"]'); if (b) b.click(); return !!b; }); await page.waitForTimeout(600);
    if (!hasFs) note(tag0 + ' timer fullscreen', ['fullscreen button missing']);
    else { note(tag0 + ' timer fullscreen', [...errs.splice(0), ...await page.evaluate(() => { const vw = document.documentElement.clientWidth; return document.documentElement.scrollWidth > vw + 1 ? ['horizontal overflow in fullscreen'] : []; })]);
      await shotFn(page)({ path: path.join(OUT, `${tag0}-timer-fullscreen.png`) }); await page.keyboard.press('Escape'); }
    // calendar: add a to-do from a day sheet, see it on the day, check it off
    { await page.evaluate(() => document.querySelector('#nav button[data-v="cal"]').click()); await page.waitForTimeout(500);
      const day = page.locator('.cday.today'); if (phone) await day.tap(); else await day.click(); await page.waitForTimeout(400);
      const f = []; const dlg = page.locator('dialog[open]'); if (!(await dlg.count())) f.push('day sheet did not open'); else {
        const t = 'Cal todo ' + w + bname; await dlg.locator('input[name=tdText]').fill(t); await dlg.locator('button[value=addTodo]').click(); await page.waitForTimeout(700);
        const inSheet = await page.evaluate(t => [...document.querySelectorAll('dialog[open] .cal-todos .todo-t')].some(e => e.textContent === t), t); if (!inSheet) f.push('new to-do not shown in day sheet');
        f.push(...await page.evaluate(() => { const d = document.querySelector('dialog[open]'), vw = document.documentElement.clientWidth, o = []; if (d && d.getBoundingClientRect().right > vw + 1) o.push('day sheet overflows'); for (const e of d ? d.querySelectorAll('.cal-add > *') : []) if (e.getBoundingClientRect().right > d.getBoundingClientRect().right + 1) o.push('day sheet control clipped'); return o; }));
        const box = page.locator('dialog[open] .cal-todos label.todo-it', { hasText: t }).locator('input[type=checkbox]'); await box.check(); await page.waitForTimeout(400);
        await page.evaluate(() => document.querySelector('dialog[open]')?.close('cancel')); await page.waitForTimeout(700);
        await page.waitForTimeout(500); const done = await page.evaluate(async t => { const ts = await api('/api/tasks'); return (ts.find(x => x.title === t) || {}).done; }, t); if (!done) f.push('checking the to-do in the sheet did not save');
        await page.evaluate(async t => { const x = (await api('/api/tasks')).find(y => y.title === t); if (x) await api('/api/tasks/' + x.id, 'DELETE'); await refresh(); }, t); }
      await page.waitForTimeout(600);
      const onDay = await page.evaluate(() => { const c = document.querySelector('.cday.today'); return c ? (c.getBoundingClientRect().right <= document.documentElement.clientWidth + 1 ? '' : 'today cell overflows: ' + Math.round(c.getBoundingClientRect().right) + '>' + document.documentElement.clientWidth + ' view=' + view) : 'today cell missing, view=' + view; }); if (onDay) f.push(onDay);
      note(tag0 + ' calendar to-do', f); }
    if (w === 1024 || w === 390) { await page.evaluate(() => document.querySelector('#nav button[data-v="stats"]').click()); await page.waitForTimeout(700);
      const strip = page.locator('.cum-hit i').nth(-3); await strip.scrollIntoViewIfNeeded(); if (phone) await strip.tap(); else await strip.hover(); await page.waitForTimeout(200);
      const tipTxt = await page.evaluate(() => { const t = document.getElementById('chartTip'); return t && t.classList.contains('on') ? t.textContent : ''; });
      if (!/total/.test(tipTxt) || !/\d{4}/.test(tipTxt)) note(tag0 + ' share-price tooltip', ['no tooltip on ' + (phone ? 'tap' : 'hover') + ' (got "' + tipTxt + '")']); }
    if (w === 1024) note(tag0 + ' live wallpaper', await page.evaluate(async () => { const f = [], wait = ms => new Promise(r => setTimeout(r, ms)), sig = () => [...document.querySelectorAll('#wallpaper i.on')].map(i => i.style.getPropertyValue('--c') + '@' + i.style.getPropertyValue('--s')).join('|');
      await refresh(); await wait(50); const a = sig(), now = Date.now();
      const s = await api('/api/sessions', 'POST', { subject: 'Live Mix Test', start: new Date(now - 3 * 3600e3).toISOString(), end: new Date(now - 60e3).toISOString() }); await refresh(); await wait(50); const b = sig(); if (a === b) f.push('wallpaper did not update after adding a session');
      await api('/api/subjects', 'PUT', { name: 'Live Mix Test', color: '#123456' }); await load(); await wait(50); if (!sig().includes('#123456')) f.push('wallpaper did not update after a subject color change');
      const dot = document.querySelector('#wallpaper i.on'); if (dot && !(parseFloat(getComputedStyle(dot).transitionDuration) > 0)) f.push('wallpaper change is not animated');
      await api('/api/sessions/' + s.id, 'DELETE'); await refresh(); await wait(50); if (sig() !== a) f.push('wallpaper did not revert after deleting the session');
      await api('/api/subjects', 'DELETE', { name: 'Live Mix Test' }); await refresh(); return f; }));
    await ctx.close(); console.log(bname + '@' + w + ' done in ' + Math.round((Date.now() - t0) / 1000) + 's');
}
const T = +process.env.UI_TASK_TIMEOUT || 8 * 60e3, CONC = +process.env.UI_CONCURRENCY || 4;
for (const bname of BROWSERS) { const browser = await pw[bname].launch(), queue = [...WIDTHS];
  await Promise.all([...Array(Math.min(CONC, queue.length))].map(async () => { for (let w; (w = queue.shift()) !== undefined;) {
    let timer; try { await Promise.race([runWidth(browser, bname, w), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after ' + T / 1000 + 's')), T); })]); }
    catch (e) { failures.push(bname + '@' + w + ': run error: ' + String(e && e.message || e).split('\n')[0]); } finally { clearTimeout(timer); } } }));
  await browser.close(); }
server.close();
console.log(`${shots} screenshots in ${OUT}`);
if (failures.length) { console.error(failures.length + ' UI check failure(s):\n' + [...new Set(failures)].join('\n')); process.exit(1); }
console.log('All responsive UI checks passed (' + BROWSERS.join(', ') + ' x ' + WIDTHS.join(', ') + ')');
