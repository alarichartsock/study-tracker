// Trophy popup reopen regression (Playwright/Chromium): open a trophy, close it (Close button, Esc, backdrop click), then click another
// trophy card after 0/50/150/300ms; the second popup must open every time. Run: node e2e/trophy-reopen.mjs
import { createRequire } from 'node:module'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const require = createRequire(import.meta.url); const { createApp } = require('../server.js');
const pw = await import(process.env.PW || 'playwright');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-tr-')); const server = createApp({ dataFile: path.join(dir, 'data.json'), reportsDir: path.join(dir, 'r'), minSessionSec: 0 });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = 'http://127.0.0.1:' + server.address().port; let cookie = '';
const api = async (p, m = 'GET', b) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r.json().catch(() => null); };
await api('/api/register', 'POST', { agree: true, birthYear: 1990, username: 'truser', email: 'tr@example.com', password: 'local-only-pass-1' });
await api('/api/sessions', 'POST', { subject: 'CARS', start: new Date(Date.now() - 7200e3).toISOString(), end: new Date(Date.now() - 3600e3).toISOString() });
const b = await pw.chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } }); await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: BASE }]);
await ctx.addInitScript(() => { localStorage.theme = 'light'; localStorage.view = 'trophy'; localStorage.achCat = 'launch'; });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto(BASE + '/'); await p.waitForSelector('#achGrid .trophy');
await p.evaluate(() => { document.querySelector('dialog[open]')?.close(); [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Decline')?.click(); });
await p.waitForTimeout(1800);
const cards = await p.$$('#achGrid .trophy'); const fails = []; let n = 0;
const title = () => p.evaluate(() => document.querySelector('#dlg[open] h3')?.firstChild?.textContent || null);
for (const tgt of (process.env.TGT || 'title,art,artdrag').split(',')) for (const how of ['close', 'esc', 'backdrop']) for (const ms of [0, 50, 150, 300]) {
  const A = cards[n % cards.length], B = cards[(n + 1) % cards.length]; n++;
  await B.scrollIntoViewIfNeeded(); await A.scrollIntoViewIfNeeded(); const tA = await A.$eval('b', e => e.textContent), tB = await B.$eval('b', e => e.textContent);
  await (await A.$('b')).click(); await p.waitForTimeout(250); if (await title() !== tA) { fails.push(how + ' ' + ms + ': first open failed'); await p.keyboard.press('Escape'); continue; }
  if (how === 'close') await p.click('#dlg button[value=cancel]'); else if (how === 'esc') await p.keyboard.press('Escape'); else await p.mouse.click(8, 400);
  if (ms) await p.waitForTimeout(ms);
  const bb = await (await B.$(tgt === 'title' ? 'b' : '.t-ic')).boundingBox(), cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2; if (tgt === 'artdrag') { await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 6, cy + 1, { steps: 2 }); await p.mouse.up(); } else await p.mouse.click(cx, cy); await p.waitForTimeout(250);
  const got = await title(); const dial = tgt === 'artdrag' && await B.evaluate(e => e.dataset.id === 'tinker' && e.classList.contains('on')); if (dial) { if (got) fails.push('dial drag opened the popup'); } else if (got !== tB) { const at = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.tagName + '.' + e.className + ' in ' + (e.closest('.trophy')?.dataset.id || '-')) + ' sy=' + scrollY; }, [bb.x + bb.width / 2, bb.y + bb.height / 2]); fails.push(tgt + ' ' + how + ' +' + ms + 'ms: expected "' + tB + '", got ' + JSON.stringify(got) + ' at ' + at); }
  await p.evaluate(() => document.querySelector('#dlg')?.open && document.querySelector('#dlg').close()); await p.waitForTimeout(100); }
console.log(JSON.stringify({ checks: n, fails, errs }, null, 1)); await b.close(); server.close(); process.exitCode = fails.length || errs.length ? 1 : 0; process.exit();
