'use strict';
// TikTok Events API (server-side), docs: https://business-api.tiktok.com/portal/docs?id=1771100865818625
// POST https://business-api.tiktok.com/open_api/v1.3/event/track/ with header "Access-Token".
// Off unless TIKTOK_EVENTS_API_TOKEN is set. Never throws; never logs the token.
const crypto = require('node:crypto');
const sha = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const DEFAULT_PIXEL_ID = 'DBKKRPBC77U0QLCJSAV0'; // public StudyHertz pixel (also used by the browser ttq)
const EVENTS = new Set(['CompleteRegistration', 'Subscribe', 'CompletePayment']);

function create(env = process.env, opts = {}) {
  const pid = String(env.TIKTOK_PIXEL_ID || DEFAULT_PIXEL_ID).trim(), token = String(env.TIKTOK_EVENTS_API_TOKEN || '').trim();
  const testCode = String(env.TIKTOK_TEST_EVENT_CODE || '').trim();
  const enabled = !!(pid && token), doFetch = opts.fetch || globalThis.fetch, log = opts.log || (m => console.log(m));
  // ev: { id, event, at (ms), url, ttclid, uid, email, ip, ua, value (major units), currency, plan }
  function build(ev) {
    const user = {};
    if (ev.uid) user.external_id = sha('studyhertz:' + ev.uid);
    if (typeof ev.email === 'string' && ev.email.includes('@')) user.email = sha(ev.email.trim().toLowerCase());
    if (typeof ev.ttclid === 'string' && ev.ttclid) user.ttclid = ev.ttclid.slice(0, 500);
    if (ev.ip) user.ip = String(ev.ip); if (ev.ua) user.user_agent = String(ev.ua).slice(0, 400);
    const e = { event: ev.event, event_time: Math.floor((ev.at || Date.now()) / 1000), event_id: String(ev.id).slice(0, 200), user, page: { url: ev.url } };
    if (typeof ev.value === 'number' && isFinite(ev.value)) e.properties = { value: ev.value, currency: String(ev.currency || 'USD').toUpperCase(), content_type: 'product', contents: [{ content_id: 'studyhertz_' + (ev.plan || 'monthly'), content_name: 'StudyHertz ' + (ev.plan || 'monthly'), price: ev.value, quantity: 1 }] };
    return e;
  }
  async function send(events) {
    events = (events || []).filter(e => e && EVENTS.has(e.event) && e.id && e.url);
    if (!enabled || !events.length) return { sent: false, reason: enabled ? 'no events' : 'not configured' };
    try {
      const body = { event_source: 'web', event_source_id: pid, data: events.map(build) }; if (testCode) body.test_event_code = testCode;
      const r = await doFetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', { method: 'POST',
        headers: { 'Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      let j = null; try { j = await r.json(); } catch { /* ignore */ }
      const ok = r.ok && (!j || j.code === undefined || j.code === 0);
      if (!ok) log('tiktok-ads: HTTP ' + r.status + (j && j.code !== undefined ? ' code ' + j.code + ' ' + String(j.message || '').slice(0, 200) : ''));
      return { sent: ok, status: r.status };
    } catch (e) { log('tiktok-ads: ' + (e && e.name || 'error')); return { sent: false, reason: 'network' }; }
  }
  return { enabled, send, build };
}
module.exports = { create, sha, DEFAULT_PIXEL_ID };
