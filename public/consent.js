// Cookie consent + Google Ads (AW-18541546430). Nothing is requested from Google unless the user clicks Accept.
// Choice is stored in localStorage.adsConsent ('granted' | 'denied'). Change it any time via "Cookie settings".
(function () {
  'use strict';
  var ADS_ID = 'AW-18541546430', KEY = 'adsConsent', loaded = false;
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* ignore */ } }
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  function load() {
    if (loaded) return; loaded = true; window.gtag = gtag;
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ADS_ID; document.head.appendChild(s);
    gtag('js', new Date()); gtag('config', ADS_ID);
  }
  function banner() {
    if (document.getElementById('consent')) return;
    var b = document.createElement('div'); b.id = 'consent'; b.className = 'consent glass'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Cookie consent');
    b.innerHTML = '<p>We use Google Ads cookies to measure our ads. They load only if you accept. <a href="/privacy">Privacy</a></p>' +
      '<div class="consent-btns"><button type="button" class="btn ghost" data-consent="denied">Decline</button><button type="button" class="btn primary" data-consent="granted">Accept</button></div>';
    b.addEventListener('click', function (e) { var v = e.target && e.target.getAttribute && e.target.getAttribute('data-consent'); if (!v) return; choose(v); });
    document.body.appendChild(b);
  }
  function choose(v) {
    var prev = get(); set(v); var b = document.getElementById('consent'); if (b) b.remove();
    if (v === 'granted') load();
    else if (loaded || prev === 'granted') { gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }); location.reload(); }
  }
  window.SHConsent = {
    state: get,
    open: function () { var b = document.getElementById('consent'); if (b) b.remove(); banner(); },
    choose: choose,
    // sign-up conversion: only with consent and a configured label
    signup: function () {
      if (get() !== 'granted') return;
      fetch('/api/public-config').then(function (r) { return r.json(); }).then(function (c) {
        if (c && c.signupLabel) { load(); gtag('event', 'conversion', { send_to: ADS_ID + '/' + c.signupLabel }); }
      }).catch(function () {});
    }
  };
  // Global Privacy Control is honored as an opt-out of ad sharing: no banner, no Google requests
  function init() { var c = get(); if (navigator.globalPrivacyControl === true && c !== 'granted') return; if (c === 'granted') load(); else if (c !== 'denied') banner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('[data-cookie-settings]'); if (t) { e.preventDefault(); window.SHConsent.open(); } });
})();
