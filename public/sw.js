// Offline-friendly app shell. API calls always go to the network (never cached).
// HTML, app.js and styles are fetched with cache:'reload' so a CDN/HTTP cache cannot
// satisfy them with a stale copy while online. Offline falls back to this cache.
const CACHE = 'studyhertz-shell-v176';
const SHELL = ['/', '/app.js', '/mix.js', '/mcat.js', '/templates.js', '/tz.js', '/practice.js', '/trophy-spec.js', '/trophy-tier.js', '/trophy-art.js', '/color-clamp.js', '/style.css', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png', '/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png', '/consent.js', '/i18n.js', '/privacy', '/terms'];
function staleShellCaches(keys, current) { return keys.filter(k => k.startsWith('studyhertz-shell-') && k !== current); }
function shouldHandleFetch(request, url) {
  if (!request || request.method !== 'GET' || !url || url.origin !== location.origin) return false;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/accent-icon/')) return false;
  return true;
}
// Document navigations and the JS/CSS shell must not be served from the HTTP cache.
function wantsFresh(url, request) {
  if (request && request.mode === 'navigate') return true;
  const p = url.pathname;
  if (p === '/' || p === '/index.html' || p === '/app.js' || p === '/style.css') return true;
  return (p.endsWith('.js') || p.endsWith('.css')) && SHELL.indexOf(p) !== -1;
}
// Copying a navigation Request with RequestInit throws in Chromium. Fall back to the URL.
function freshRequest(request) {
  try { if (typeof Request !== 'undefined' && request instanceof Request) return new Request(request, { cache: 'reload' }); } catch { /* navigate */ }
  return new Request(request.url, { cache: 'reload', credentials: 'same-origin' });
}
async function installShell() {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map(async url => {
    const res = await fetch(new Request(new URL(url, location.origin), { cache: 'reload' }));
    if (!res.ok) throw new Error('shell ' + url);
    await cache.put(url, res);
  }));
  await self.skipWaiting();
}
async function activateShell() {
  const keys = await caches.keys();
  await Promise.all(staleShellCaches(keys, CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
}
function fetchShell(request) {
  const url = new URL(request.url);
  const fresh = wantsFresh(url, request);
  let pendingPut = Promise.resolve();
  return fetch(fresh ? freshRequest(request) : request).then(r => {
    if (r && r.ok) { const copy = r.clone(); pendingPut = caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {}); }
    return r;
  }).catch(() => caches.match(request).then(hit => hit || caches.match('/'))).finally(() => pendingPut);
}
self.addEventListener('install', e => e.waitUntil(installShell()));
self.addEventListener('activate', e => e.waitUntil(activateShell()));
self.addEventListener('fetch', e => {
  let url; try { url = new URL(e.request.url); } catch { return; }
  if (!shouldHandleFetch(e.request, url)) return;
  const p = fetchShell(e.request);
  e.respondWith(p);
  e.waitUntil(p.then(() => {}).catch(() => {}));
});
self.addEventListener('notificationclick', e => { e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/'; e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow(url))); });
self.SHSW = { CACHE, SHELL, staleShellCaches, wantsFresh, shouldHandleFetch, freshRequest };
