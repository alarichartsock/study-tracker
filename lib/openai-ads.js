'use strict';
// ChatGPT Ads (OpenAI) Conversions API, server-side only. Docs: https://developers.openai.com/ads/conversions-api
// POST https://bzr.openai.com/v1/events?pid=<PIXEL-ID> with "Authorization: Bearer <Conversions API key>".
// Off unless OPENAI_ADS_PIXEL_ID and OPENAI_CONVERSIONS_API_KEY are both set. Never throws; never logs the key.
const crypto = require('node:crypto');
const sha = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const TYPES = new Set(['registration_completed', 'trial_started', 'subscription_created', 'order_created']);

function create(env = process.env, opts = {}) {
  const pid = String(env.OPENAI_ADS_PIXEL_ID || '').trim(), key = String(env.OPENAI_CONVERSIONS_API_KEY || '').trim();
  const validateOnly = /^(1|true|yes)$/i.test(String(env.OPENAI_ADS_VALIDATE_ONLY || ''));
  const enabled = !!(pid && key), doFetch = opts.fetch || globalThis.fetch, log = opts.log || (m => console.log(m));
  // ev: { id, type, at (ms), url, oppref, uid, amount (minor units), currency, plan }
  function build(ev) {
    const shape = ev.type === 'registration_completed' ? 'customer_action' : ev.type === 'order_created' ? 'contents' : 'plan_enrollment';
    const data = { type: shape };
    if (shape === 'plan_enrollment' && ev.plan) data.plan_id = String(ev.plan).slice(0, 64);
    if (Number.isInteger(ev.amount) && ev.amount >= 0 && ev.currency) { data.amount = ev.amount; data.currency = String(ev.currency).toUpperCase(); }
    const e = { id: String(ev.id).slice(0, 200), type: ev.type, timestamp_ms: Math.round(ev.at || Date.now()), action_source: 'web', source_url: ev.url, data };
    if (typeof ev.oppref === 'string' && ev.oppref) e.oppref = ev.oppref; // passed through unmodified
    if (ev.uid) e.user = { external_ids_sha256: [sha('studyhertz:' + ev.uid)] };
    return e;
  }
  async function send(events) {
    events = (events || []).filter(e => e && TYPES.has(e.type) && e.id && e.url);
    if (!enabled || !events.length) return { sent: false, reason: enabled ? 'no events' : 'not configured' };
    try {
      const r = await doFetch('https://bzr.openai.com/v1/events?pid=' + encodeURIComponent(pid), { method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ validate_only: validateOnly, events: events.map(build) }), signal: AbortSignal.timeout(8000) });
      const ok = r.ok; if (!ok) { let t = ''; try { t = (await r.text()).slice(0, 300); } catch { /* ignore */ } log('openai-ads: HTTP ' + r.status + ' ' + t.replace(/Bearer\s+\S+/g, '')); }
      return { sent: ok, status: r.status };
    } catch (e) { log('openai-ads: ' + (e && e.name || 'error')); return { sent: false, reason: 'network' }; }
  }
  return { enabled, validateOnly, send, build };
}
module.exports = { create, sha };
