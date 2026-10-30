// Google consent mode (ADVANCED): the Google tag (Ads AW-18541546430 + optional GA4) loads on every page,
// with every consent type denied by default. Until someone clicks Accept, Google receives only cookieless
// measurement pings (no cookies are read or written). Accept updates consent to granted; Decline keeps it denied.
// The choice is stored in localStorage.adsConsent ('granted' | 'denied') and re-applied on later visits.
// Global Privacy Control is honored: with GPC on, advertising consent stays denied even after Accept.
(function () {
  'use strict';
  var ADS_ID = 'AW-18541546430', KEY = 'adsConsent';
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* ignore */ } }
  var gpc = navigator.globalPrivacyControl === true;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  var DENIED = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
  function granted() { return gpc ? { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' } : { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' }; }
  // 1) defaults BEFORE any config
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500 });
  gtag('set', 'ads_data_redaction', true);
  // 2) re-apply a stored choice
  if (get() === 'granted') gtag('consent', 'update', granted());
  // 3) one shared loader, then config for Ads and (if configured) GA4
  // attribution: UTM + gclid from the original landing URL (app.js records it before replaceState strips the query)
  var LANDING = window.SH_LANDING || location.href, AKEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'], attr = {};
  function sget(st, k) { try { return JSON.parse(st.getItem(k) || 'null'); } catch (e) { return null; } }
  function sput(st, k, v) { try { st.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  try { var lq = new URL(LANDING).searchParams, got = {}, any = false; AKEYS.forEach(function (k) { var v = lq.get(k); if (v && v.indexOf('@') < 0) { got[k] = v.slice(0, 100); any = true; } });
    if (any) { sput(sessionStorage, 'shAttr', got); if (!sget(localStorage, 'shFirstTouch')) sput(localStorage, 'shFirstTouch', { ...got, ts: new Date().toISOString().slice(0, 10) }); }
    attr = sget(sessionStorage, 'shAttr') || {}; } catch (e) { attr = {}; }
  if (attr.utm_source || attr.utm_medium || attr.utm_campaign) gtag('set', { campaign_source: attr.utm_source, campaign_medium: attr.utm_medium, campaign_name: attr.utm_campaign, campaign_term: attr.utm_term, campaign_content: attr.utm_content });
  var first = sget(localStorage, 'shFirstTouch') || {};
  function firstParams(p) { if (first.utm_source) p.first_source = first.utm_source; if (first.utm_medium) p.first_medium = first.utm_medium; if (first.utm_campaign) p.first_campaign = first.utm_campaign; if (first.gclid) p.first_click = 'gclid'; else if (first.fbclid) p.first_click = 'fbclid'; return p; }
  var GA = function (fn) { cfg().then(function (c) { try { if (c && c.gaId && typeof window.gtag === 'function') fn(c.gaId); } catch (e) { /* ignore */ } }); };
  var PLAN = { monthly: ['Monthly', 4.99], yearly: ['Yearly', 39], lifetime: ['Lifetime', 100] };
  function planItem(plan, i) { var x = PLAN[plan] || PLAN.monthly; return { item_id: 'studyhertz_' + (PLAN[plan] ? plan : 'monthly'), item_name: 'StudyHertz ' + x[0], item_category: 'subscription', item_list_id: 'pricing', item_list_name: 'Pricing', price: x[1], quantity: 1, index: i || 0 }; }
  // drop anything that could be personal: non-primitive values, strings with '@', overly long text
  function clean(p) { var o = {}; if (!p || typeof p !== 'object') return o; Object.keys(p).forEach(function (k) { var v = p[k];
    if (typeof v === 'number' && isFinite(v)) o[k] = v; else if (typeof v === 'boolean') o[k] = v; else if (typeof v === 'string' && v.indexOf('@') < 0 && v.length <= 120) o[k] = v; }); return o; }
  var seen = {}, cfgP = null; function cfg() { return cfgP || (cfgP = fetch('/api/public-config').then(function (r) { return r.json(); }).catch(function () { return {}; })); }
  var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ADS_ID; (document.head || document.documentElement).appendChild(s);
  gtag('js', new Date()); gtag('config', ADS_ID);
  // GA4: page_views are sent manually (landing below, SPA routes from app.js), so the config sends none
  cfg().then(function (c) { if (c && c.gaId) { gtag('config', c.gaId, { send_page_view: false }); gtag('event', 'page_view', { send_to: c.gaId, page_location: LANDING, page_path: location.pathname, page_title: document.title }); } });
  function track(name, params) { try { if (typeof name !== 'string' || !/^[a-z_]{1,40}$/.test(name)) return;
      var p = clean(params); var CMAP = { utm_source: 'campaign_source', utm_medium: 'campaign_medium', utm_campaign: 'campaign_name', utm_term: 'campaign_term', utm_content: 'campaign_content' }; Object.keys(CMAP).forEach(function (k) { if (attr[k]) p[CMAP[k]] = attr[k]; }); firstParams(p);
      p = clean(p); cfg().then(function (c) { try { if (c && c.gaId && typeof window.gtag === 'function') { p.send_to = c.gaId; window.gtag('event', name, p); } } catch (e) { /* ignore */ } }); } catch (e) { /* never throw */ } }

  function banner() {
    if (document.getElementById('consent')) return;
    var b = document.createElement('div'); b.id = 'consent'; b.className = 'consent glass'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Cookie consent');
    b.innerHTML = '<p>We use Google Analytics and Google Ads cookies to understand how StudyHertz is used and to measure our ads. Cookies are set only if you accept. <a href="/privacy">Privacy</a></p>' +
      '<div class="consent-btns"><button type="button" class="btn ghost" data-consent="denied">Decline</button><button type="button" class="btn primary" data-consent="granted">Accept</button></div>';
    b.addEventListener('click', function (e) { var v = e.target && e.target.getAttribute && e.target.getAttribute('data-consent'); if (!v) return; choose(v); });
    document.body.appendChild(b);
  }
  function choose(v) {
    set(v); var b = document.getElementById('consent'); if (b) b.remove();
    gtag('consent', 'update', v === 'granted' ? granted() : DENIED);
  }
  window.SHConsent = {
    state: get,
    open: function () { var b = document.getElementById('consent'); if (b) b.remove(); banner(); },
    choose: choose,
    track: track,
    // conversions: consent mode decides whether they carry cookies or go out as cookieless pings
    purchase: function (p) {
      if (!p || !p.label) return;
      gtag('event', 'conversion', { send_to: ADS_ID + '/' + p.label, value: p.value, currency: p.currency || 'USD', transaction_id: p.txn });
    },
    // GA4 ecommerce events (begin_checkout, purchase) with an items array (track() strips non-primitive params)
    ecommerce: function (name, p) {
      if (name !== 'begin_checkout' && name !== 'purchase') return; p = p || {}; var plan = p.plan === 'yearly' || p.plan === 'lifetime' ? p.plan : 'monthly', value = Number(p.value) || 0;
      var ev = { currency: p.currency || 'USD', value: value, items: [{ item_id: 'studyhertz_' + plan, item_name: 'StudyHertz ' + (plan === 'yearly' ? 'Yearly' : plan === 'lifetime' ? 'Lifetime' : 'Monthly'), item_category: 'subscription', price: value, quantity: 1 }] };
      firstParams(ev);
      if (name === 'purchase') { if (!p.txn || !/^[A-Za-z0-9_]{1,200}$/.test(p.txn)) return; ev.transaction_id = p.txn; }
      cfg().then(function (c) { try { if (c && c.gaId) { ev.send_to = c.gaId; gtag('event', name, ev); } } catch (e) { /* ignore */ } });
    },
    // GA client id, only after analytics consent (used for the server-side purchase event)
    clientId: function () {
      return cfg().then(function (c) { if (!c || !c.gaId || get() !== 'granted') return null;
        return new Promise(function (res) { var done = false; setTimeout(function () { if (!done) { done = true; res(null); } }, 800);
          try { gtag('get', c.gaId, 'client_id', function (id) { if (!done) { done = true; res(id || null); } }); } catch (e) { res(null); } }); }).catch(function () { return null; });
    },
    // GA4 view_item_list (once per page + list) and select_item (plan click), with items arrays
    viewList: function (list, plans) { var key = 'v_' + list; if (seen[key]) return; seen[key] = 1; var ev = firstParams({ item_list_id: list, item_list_name: list === 'paywall' ? 'Paywall' : 'Pricing', items: (plans || ['monthly', 'yearly', 'lifetime']).map(planItem) });
      GA(function (id) { ev.send_to = id; gtag('event', 'view_item_list', ev); }); },
    selectItem: function (plan, list) { var ev = firstParams({ item_list_id: list || 'pricing', item_list_name: list === 'paywall' ? 'Paywall' : 'Pricing', items: [planItem(plan)] }); GA(function (id) { ev.send_to = id; gtag('event', 'select_item', ev); }); },
    // signed-in identity: opaque internal id (never username/email) + user properties
    identify: function (uid, props) { if (!uid || seen.idf === uid) return; seen.idf = uid; var up = {}; Object.keys(props || {}).forEach(function (k) { if (typeof props[k] === 'string' && props[k].length <= 36 && props[k].indexOf('@') < 0) up[k] = props[k]; });
      GA(function (id) { gtag('config', id, { user_id: 'u' + String(uid), send_page_view: false }); gtag('set', 'user_properties', up); }); },
    firstTouch: function () { return first && Object.keys(first).length ? first : null; },
    signup: function () {
      cfg().then(function (c) { if (c && c.signupLabel) gtag('event', 'conversion', { send_to: ADS_ID + '/' + c.signupLabel }); });
    }
  };
  try { (window.SHQ || []).splice(0).forEach(function (e) { track(e[0], e[1]); }); } catch (e) { /* ignore */ }
  function init() { var c = get(); if (c !== 'granted' && c !== 'denied') banner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('[data-cookie-settings]'); if (t) { e.preventDefault(); window.SHConsent.open(); } });
})();
