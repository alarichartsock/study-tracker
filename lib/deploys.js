'use strict';
// Deploy history for the admin charts. Sources, merged by deploy id / commit:
//  1) lib/deploys-seed.json: backfill from the Render API (written once from the deploy list)
//  2) <DATA_DIR>/boots.jsonl: one line per server boot {boot, commit, branch} (RENDER_GIT_COMMIT / RENDER_GIT_BRANCH) - durable on the disk
//  3) optional: Render API (RENDER_API_KEY + RENDER_SERVICE_ID) refreshed at boot into <DATA_DIR>/render-deploys.json
const fs = require('fs'), path = require('path');
let SEED = []; try { SEED = require('./deploys-seed.json'); } catch { /* none */ }
function createDeploys({ dir = null, env = process.env, fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  const bootsF = dir && path.join(dir, 'boots.jsonl'), apiF = dir && path.join(dir, 'render-deploys.json');
  function recordBoot() { if (!bootsF) return null; const b = { boot: new Date(now()).toISOString(), commit: String(env.RENDER_GIT_COMMIT || '').slice(0, 40) || null, branch: String(env.RENDER_GIT_BRANCH || '').slice(0, 60) || null };
    try { fs.appendFileSync(bootsF, JSON.stringify(b) + '\n'); } catch { return null; } return b; }
  function boots() { if (!bootsF) return []; try { return fs.readFileSync(bootsF, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
  async function refreshFromApi() { const key = env.RENDER_API_KEY, sid = env.RENDER_SERVICE_ID; if (!key || !sid || !apiF) return 'skip';
    try { const r = await fetchFn('https://api.render.com/v1/services/' + encodeURIComponent(sid) + '/deploys?limit=100', { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' } });
      if (!r.ok) return r.status; const j = await r.json();
      const out = j.map(x => x.deploy || x).map(d => ({ id: d.id, commit: String(d.commit && d.commit.id || '').slice(0, 7), msg: String(d.commit && d.commit.message || '').split('\n')[0].slice(0, 140), start: d.startedAt || d.createdAt, finish: d.finishedAt || null, status: d.status, trigger: d.trigger }));
      fs.writeFileSync(apiF + '.tmp', JSON.stringify(out)); fs.renameSync(apiF + '.tmp', apiF); return out.length; } catch { return 'error'; } }
  function list() { const by = new Map(); let api = []; if (apiF) try { api = JSON.parse(fs.readFileSync(apiF, 'utf8')); } catch {}
    for (const d of [...SEED, ...api]) if (d && d.id) by.set(d.id, { ...by.get(d.id), ...d });
    const out = [...by.values()].filter(d => d.status !== 'build_failed' && d.status !== 'canceled');
    for (const b of boots()) { const c = (b.commit || '').slice(0, 7), bt = Date.parse(b.boot);
      const d = out.filter(x => x.commit === c && Date.parse(x.start) <= bt + 6e4).sort((a, z) => Date.parse(z.start) - Date.parse(a.start))[0];
      if (d && !d.boot) d.boot = b.boot; else if (!d) out.push({ id: null, commit: c || null, msg: '', start: null, finish: b.boot, boot: b.boot, status: 'boot', branch: b.branch }); }
    for (const d of out) d.t = d.finish || d.boot || d.start; // marker = completion time
    return out.filter(d => d.t).sort((a, z) => String(a.t).localeCompare(String(z.t))); }
  return { recordBoot, boots, refreshFromApi, list };
}
module.exports = { createDeploys };
