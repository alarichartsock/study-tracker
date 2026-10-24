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
const VIEWS = ['timer', 'dash', 'sess', 'cal', 'stats', 'plan', 'trophy', 'data', 'set'];

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
await api('/api/tasks', 'POST', { title: 'Review amino acids', priority: 'high' });
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
