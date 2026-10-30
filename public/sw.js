// Offline-friendly app shell. API calls always go to the network (never cached).
const CACHE = 'studyhertz-shell-v83';
const SHELL = ['/', '/app.js', '/mix.js', '/mcat.js', '/trophy-spec.js', '/trophy3d.js', '/trophy3d-hq.js', '/trophy-tier.js', '/vendor/three/three.module.min.js', '/vendor/three/three.core.min.js', '/style.css', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png', '/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png', '/consent.js', '/i18n.js', '/privacy', '/terms'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // network first, fall back to cache when offline
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
self.addEventListener('notificationclick', e => { e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/'; e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow(url))); });
