'use strict';
// Single registry of public, indexable routes. sitemap.xml, robots.txt and IndexNow are all derived from it.
// lastmod = date the route's source files last changed: a content hash per route is tracked in <DATA_DIR>/sitemap-state.json
// (survives deploys; Render builds have no git history). lib/sitemap-seed.json carries git commit dates for the current hashes.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const core = require('../public/i18n.js');
const SITE = 'https://studyhertz.com', PUBLIC = path.join(__dirname, '..', 'public');
const langPath = l => l === 'en' ? '/' : '/' + core.PATHS[l] + '/';
const ROUTES = [
  ...core.LANGS.map(l => ({ path: langPath(l), files: ['index.html', ...(l === 'en' ? [] : ['i18n/' + l.toLowerCase() + '.json'])], priority: l === 'en' ? '1.0' : '0.9', changefreq: 'weekly', lang: l })),
  { path: '/pricing', files: ['index.html'], priority: '0.8', changefreq: 'monthly' },
  { path: '/terms', files: ['terms.html'], priority: '0.3', changefreq: 'yearly' },
  { path: '/privacy', files: ['privacy.html'], priority: '0.3', changefreq: 'yearly' },
  { path: '/affiliates', files: ['affiliates.html'], priority: '0.4', changefreq: 'monthly' },
];
const LANG_ROUTES = ROUTES.filter(r => r.lang);
const urls = (routes = ROUTES) => routes.map(r => SITE + r.path);
function hashRoute(r, dir = PUBLIC) { const h = crypto.createHash('sha256');
  for (const f of r.files) h.update(f + '\0').update(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')).update('\0');
  return h.digest('hex').slice(0, 16); }
let SEED = {}; try { SEED = require('./sitemap-seed.json'); } catch { /* none */ }
const today = () => new Date().toISOString().slice(0, 10);
// Returns { lastmod: {path: date}, changed: [paths whose hash changed since the stored state] } and persists the state.
function computeState({ dir = null, now = today, seed = SEED, pub = PUBLIC } = {}) {
  const file = dir ? path.join(dir, 'sitemap-state.json') : null; let prev = {};
  if (file) try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const next = {}, changed = [];
  for (const r of ROUTES) { const hash = hashRoute(r, pub), p = prev[r.path], s = seed[r.path];
    if (p && p.hash === hash) next[r.path] = p;
    else { next[r.path] = { hash, lastmod: s && s.hash === hash ? s.lastmod : now() }; changed.push(r.path); } }
  if (file && JSON.stringify(prev) !== JSON.stringify(next)) { try { fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 1)); fs.renameSync(file + '.tmp', file); } catch { /* read-only */ } }
  return { lastmod: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v.lastmod])), changed };
}
const alternates = () => LANG_ROUTES.map(r => `    <xhtml:link rel="alternate" hreflang="${r.lang}" href="${SITE}${r.path}"/>\n`).join('') + `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>\n`;
function sitemap(lastmod) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    ROUTES.map(r => `  <url>\n    <loc>${SITE}${r.path}</loc>\n` + (r.lang ? alternates() : '') + (lastmod[r.path] ? `    <lastmod>${lastmod[r.path]}</lastmod>\n` : '') +
      `    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>\n`).join('') + '</urlset>\n';
}
const robots = () => 'User-agent: *\n' + [...new Set(ROUTES.map(r => r.lang ? '/' : r.path))].map(p => 'Allow: ' + p + '\n').join('') +
  'Allow: /api/public-config\nAllow: /api/me\nDisallow: /api/\nDisallow: /terms/v\n\nSitemap: ' + SITE + '/sitemap.xml\n';
module.exports = { SITE, ROUTES, urls, hashRoute, computeState, sitemap, robots };
