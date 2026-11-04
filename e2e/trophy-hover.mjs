// Trophy hover flicker regression (Playwright/Chromium). Moves the mouse along the bottom edge, corners and quick in/out passes of
// earned Launch Pad cards and asserts the sheen + hover state fire at most once per hover. Run: node e2e/trophy-hover.mjs
import { createRequire } from 'node:module'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const require = createRequire(import.meta.url); const { createApp } = require('../server.js');
const pw = await import(process.env.PW || 'playwright'); const VIDEO = process.env.VIDEO_OUT || '';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-th-')); const server = createApp({ dataFile: path.join(dir, 'data.json'), reportsDir: path.join(dir, 'r'), minSessionSec: 0 });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = 'http://127.0.0.1:' + server.address().port; let cookie = '';
const api = async (p, m = 'GET', b) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r.json().catch(() => null); };
await api('/api/register', 'POST', { agree: true, birthYear: 1990, username: 'thuser', email: 'th@example.com', password: 'local-only-pass-1' });
const b = await pw.chromium.launch(); const vp = { width: 1100, height: 760 };
const ctx = await b.newContext({ viewport: vp, ...(VIDEO ? { recordVideo: { dir, size: vp } } : {}) }); await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: BASE }]);
await ctx.addInitScript(() => { localStorage.theme = 'light'; localStorage.view = 'trophy'; localStorage.achCat = 'launch'; localStorage.t3dQuality = 'high'; localStorage.seenAch = '[]'; });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto(BASE + '/'); await p.waitForSelector('#achGrid .trophy.t-lp');
await p.evaluate(() => { document.querySelector('dialog[open]')?.close(); [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Decline')?.click();
  document.querySelectorAll('.trophy.t-lp').forEach(c => c.classList.add('on', 't-shown')); const g = document.getElementById('achGrid'); scrollTo({ top: g.getBoundingClientRect().top + scrollY - 70, behavior: 'instant' });
  window.__sh = 0; window.__hov = 0; document.addEventListener('animationstart', e => { if (/sh/i.test(e.animationName)) window.__sh++; }, true);
  window.__log = []; document.querySelectorAll(".trophy.t-lp").forEach(c => { c.addEventListener("pointerenter", e => { e.currentTarget.__n = (e.currentTarget.__n || 0) + 1; window.__log.push("in " + e.clientX + "," + e.clientY + " " + (e.relatedTarget && e.relatedTarget.className)); }); c.addEventListener("pointerleave", e => window.__log.push("out " + e.clientX + "," + e.clientY + " " + (e.relatedTarget && (e.relatedTarget.className.baseVal ?? e.relatedTarget.className)))); }); });
await p.waitForTimeout(1500); const cards = (await p.$$('.trophy.t-lp.on')).slice(0, 3); let fails = 0, total = 0;
for (const c of cards) { const bb = await c.boundingBox(); const r0 = await c.evaluate(el => [window.__sh, el.__n || 0]);
  await p.mouse.move(bb.x + 10, bb.y + bb.height + 7); await p.mouse.move(bb.x + 2, bb.y + bb.height - 2, { steps: 8 });
  await p.mouse.move(bb.x + bb.width - 2, bb.y + bb.height - 2, { steps: 60 });       // bottom edge, 2px inside
  await p.mouse.move(bb.x + bb.width - 2, bb.y + 2, { steps: 30 }); await p.mouse.move(bb.x + 2, bb.y + 2, { steps: 30 }); // corners
  const r1 = await c.evaluate(el => [window.__sh, el.__n || 0]); const sh = r1[0] - r0[0], hv = r1[1] - r0[1]; total++;
  if (sh > 1 || hv !== 1) { fails++; console.log('FAIL edge pass', { sh, hv }); if (process.env.DBG) console.log(await p.evaluate(() => window.__log.splice(0).join('\n'))); }
  await p.mouse.move(bb.x - 40, bb.y - 40, { steps: 4 });
  const r2 = await p.evaluate(() => window.__sh); for (let i = 0; i < 5; i++) { await p.mouse.move(bb.x + 3, bb.y + bb.height / 2, { steps: 2 }); await p.mouse.move(bb.x - 3, bb.y + bb.height / 2, { steps: 2 }); }
  const q = await p.evaluate(() => window.__sh) - r2; total++; if (q > 1) { fails++; console.log('FAIL quick in/out sheen', q); }
  await p.mouse.move(bb.x - 60, bb.y - 60); await p.waitForTimeout(700); }
const v = VIDEO && p.video(); await ctx.close(); if (v) fs.copyFileSync(await v.path(), VIDEO);
console.log(JSON.stringify({ checks: total, fails, errs })); await b.close(); server.close(); process.exitCode = (fails || errs.length ? 1 : 0); process.exit();
