'use strict';
// IndexNow (Bing, Yandex, Seznam...): the key is public by design; it is served at /<KEY>.txt.
const fs = require('fs'), path = require('path');
const KEY = '2542e5787800600d9b546bc6c44a928f', HOST = 'studyhertz.com', SITE = 'https://' + HOST;
const KEY_PATH = '/' + KEY + '.txt', URLS = ['/', '/pricing', '/terms', '/privacy'].map(u => SITE + u);
async function submit(urls = URLS, fetchFn = globalThis.fetch) {
  const r = await fetchFn('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: SITE + KEY_PATH, urlList: urls }) });
  return r.status;
}
// Once per deployed commit in production; deduped with a marker file next to the data. Logs only the status code.
async function onDeploy({ env = process.env, dir = env.DATA_DIR || '/var/data', fetchFn = globalThis.fetch, log = console.log } = {}) {
  const commit = env.RENDER_GIT_COMMIT; if (env.NODE_ENV !== 'production' && !env.RENDER) return 'skip';
  if (!commit || !fs.existsSync(dir)) return 'skip';
  const marker = path.join(dir, '.indexnow-commit'); let last = ''; try { last = fs.readFileSync(marker, 'utf8').trim(); } catch {}
  if (last === commit) return 'dup';
  try { const s = await submit(URLS, fetchFn); log('IndexNow submit: ' + s); if (s === 200 || s === 202) fs.writeFileSync(marker, commit); return s; }
  catch (e) { log('IndexNow submit failed'); return 'error'; }
}
module.exports = { KEY, KEY_PATH, URLS, submit, onDeploy };
