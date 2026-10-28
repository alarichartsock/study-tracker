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
  var cfgP = null; function cfg() { return cfgP || (cfgP = fetch('/api/public-config').then(function (r) { return r.json(); }).catch(function () { return {}; })); }
  var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ADS_ID; (document.head || document.documentElement).appendChild(s);
  gtag('js', new Date()); gtag('config', ADS_ID);
  cfg().then(function (c) { if (c && c.gaId) gtag('config', c.gaId); });

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
    // conversions: consent mode decides whether they carry cookies or go out as cookieless pings
    purchase: function (p) {
      if (!p || !p.label) return;
      gtag('event', 'conversion', { send_to: ADS_ID + '/' + p.label, value: p.value, currency: p.currency || 'USD', transaction_id: p.txn });
    },
    signup: function () {
      cfg().then(function (c) { if (c && c.signupLabel) gtag('event', 'conversion', { send_to: ADS_ID + '/' + c.signupLabel }); });
    }
  };
  function init() { var c = get(); if (c !== 'granted' && c !== 'denied') banner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('[data-cookie-settings]'); if (t) { e.preventDefault(); window.SHConsent.open(); } });
})();
