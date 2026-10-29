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
  var LANDING = window.SH_LANDING || location.href, AKEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'], attr = {};
  function sget(st, k) { try { return JSON.parse(st.getItem(k) || 'null'); } catch (e) { return null; } }
  function sput(st, k, v) { try { st.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  try { var lq = new URL(LANDING).searchParams, got = {}, any = false; AKEYS.forEach(function (k) { var v = lq.get(k); if (v && v.indexOf('@') < 0) { got[k] = v.slice(0, 100); any = true; } });
    if (any) { sput(sessionStorage, 'shAttr', got); if (!sget(localStorage, 'shFirstTouch')) sput(localStorage, 'shFirstTouch', { ...got, ts: new Date().toISOString().slice(0, 10) }); }
    attr = sget(sessionStorage, 'shAttr') || {}; } catch (e) { attr = {}; }
  if (attr.utm_source || attr.utm_medium || attr.utm_campaign) gtag('set', { campaign_source: attr.utm_source, campaign_medium: attr.utm_medium, campaign_name: attr.utm_campaign, campaign_term: attr.utm_term, campaign_content: attr.utm_content });
  var first = sget(localStorage, 'shFirstTouch') || {};
  // drop anything that could be personal: non-primitive values, strings with '@', overly long text
  function clean(p) { var o = {}; if (!p || typeof p !== 'object') return o; Object.keys(p).forEach(function (k) { var v = p[k];
    if (typeof v === 'number' && isFinite(v)) o[k] = v; else if (typeof v === 'boolean') o[k] = v; else if (typeof v === 'string' && v.indexOf('@') < 0 && v.length <= 120) o[k] = v; }); return o; }
  var cfgP = null; function cfg() { return cfgP || (cfgP = fetch('/api/public-config').then(function (r) { return r.json(); }).catch(function () { return {}; })); }
  var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ADS_ID; (document.head || document.documentElement).appendChild(s);
  gtag('js', new Date()); gtag('config', ADS_ID);
  // GA4: page_views are sent manually (landing below, SPA routes from app.js), so the config sends none
  cfg().then(function (c) { if (c && c.gaId) { gtag('config', c.gaId, { send_page_view: false }); gtag('event', 'page_view', { send_to: c.gaId, page_location: LANDING, page_path: location.pathname, page_title: document.title }); } });
  function track(name, params) { try { if (typeof name !== 'string' || !/^[a-z_]{1,40}$/.test(name)) return;
      var p = clean(params); var CMAP = { utm_source: 'campaign_source', utm_medium: 'campaign_medium', utm_campaign: 'campaign_name', utm_term: 'campaign_term', utm_content: 'campaign_content' }; Object.keys(CMAP).forEach(function (k) { if (attr[k]) p[CMAP[k]] = attr[k]; }); if (first.utm_source) p.first_source = first.utm_source; if (first.utm_campaign) p.first_campaign = first.utm_campaign;
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
    signup: function () {
      cfg().then(function (c) { if (c && c.signupLabel) gtag('event', 'conversion', { send_to: ADS_ID + '/' + c.signupLabel }); });
    }
  };
  try { (window.SHQ || []).splice(0).forEach(function (e) { track(e[0], e[1]); }); } catch (e) { /* ignore */ }
  function init() { var c = get(); if (c !== 'granted' && c !== 'denied') banner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('[data-cookie-settings]'); if (t) { e.preventDefault(); window.SHConsent.open(); } });
})();
