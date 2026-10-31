'use strict';
// IndexNow (Bing, Yandex, Seznam...): the key is public by design; it is served at /<KEY>.txt.
const fs = require('fs'), path = require('path');
const KEY = '2542e5787800600d9b546bc6c44a928f', HOST = 'studyhertz.com', SITE = 'https://' + HOST;
const SEO = require('./seo');
const KEY_PATH = '/' + KEY + '.txt', URLS = SEO.urls(); // same registry as sitemap.xml and robots.txt
async function submit(urls = URLS, fetchFn = globalThis.fetch) {
  const r = await fetchFn('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: SITE + KEY_PATH, urlList: urls }) });
  return r.status;
}
// On boot in production: submits only routes whose content hash changed since the last accepted submit
// (tracked in <DATA_DIR>/.indexnow-hashes.json). Logs only the status code and count.
async function onDeploy({ env = process.env, dir = env.DATA_DIR || '/var/data', fetchFn = globalThis.fetch, log = console.log } = {}) {
  if (env.NODE_ENV !== 'production' && !env.RENDER) return 'skip';
  if (!fs.existsSync(dir)) return 'skip';
  const file = path.join(dir, '.indexnow-hashes.json'); let last = {}; try { last = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const cur = Object.fromEntries(SEO.ROUTES.map(r => [r.path, SEO.hashRoute(r)])), changed = SEO.ROUTES.filter(r => last[r.path] !== cur[r.path]);
  if (!changed.length) return 'dup';
  try { const s = await submit(SEO.urls(changed), fetchFn); log('IndexNow submit: ' + s + ' (' + changed.length + ' URLs)'); if (s === 200 || s === 202) fs.writeFileSync(file, JSON.stringify(cur)); return s; }
  catch (e) { log('IndexNow submit failed'); return 'error'; }
}
module.exports = { KEY, KEY_PATH, URLS, submit, onDeploy };
