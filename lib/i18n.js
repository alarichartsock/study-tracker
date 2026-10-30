// Server side of i18n: localized landing pages (/es/, /zh-cn/, ...) rendered from index.html + catalogs.
const fs = require('fs'), path = require('path');
const core = require('../public/i18n.js');
const DIR = path.join(__dirname, '..', 'public', 'i18n');
const DICTS = {}, T = {};
for (const l of core.LANGS) if (l !== 'en') { DICTS[l] = JSON.parse(fs.readFileSync(path.join(DIR, l.toLowerCase() + '.json'), 'utf8')); T[l] = core.compile(DICTS[l]); }
const ROUTES = Object.fromEntries(Object.entries(core.PATHS).map(([l, p]) => ['/' + p + '/', l])); // '/es/' -> 'es'
const urlFor = (site, l) => site + (l === 'en' ? '/' : '/' + core.PATHS[l] + '/');
const OG = { en: 'en_US', es: 'es_ES', 'zh-CN': 'zh_CN', ko: 'ko_KR', hi: 'hi_IN', vi: 'vi_VN', fr: 'fr_FR' };
const hreflang = site => core.LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${urlFor(site, l)}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${site}/">`;
const dec = s => s.replace(/&(amp|lt|gt|quot|#39|nbsp|#(\d+)|#x([0-9a-f]+));/gi, (m, n, d, h) => d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0' })[n.toLowerCase()]);
const encT = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encA = s => encT(s).replace(/"/g, '&quot;');
function localize(html, lang, site) {
  const t = T[lang]; if (!t) return html;
  const tr = s => { const o = t(s); return o == null ? null : o; };
  const ATTR = /(\s(?:alt|aria-label|placeholder|title|data-tip)=")([^"]*)"/g;
  const META = /^<meta\s+(?:name|property)="(description|og:title|og:description|og:image:alt|twitter:title|twitter:description|twitter:image:alt)"/;
  const out = html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>|<[^>]+>)/).map(seg => {
    if (!seg) return seg;
    if (seg.startsWith('<script')) {
      if (!seg.includes('application/ld+json')) return seg;
      const m = /^(<script[^>]*>)([\s\S]*)(<\/script>)$/.exec(seg); let j; try { j = JSON.parse(m[2]); } catch { return seg; }
      const walk = o => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (typeof o[k] === 'string' && ['name', 'text', 'description'].includes(k)) { const v = tr(o[k]); if (v) o[k] = v; } else walk(o[k]); } };
      walk(j); if (j['@type'] === 'FAQPage' || j['@graph']) j.inLanguage = lang; return m[1] + JSON.stringify(j) + m[3];
    }
    if (seg.startsWith('<style')) return seg;
    if (seg.startsWith('<title>')) { const v = tr(dec(seg.slice(7, -8))); return v ? '<title>' + encT(v) + '</title>' : seg; }
    if (seg[0] === '<') {
      let s = seg.replace(ATTR, (m, a, v) => { const o = tr(dec(v)); return o ? a + encA(o) + '"' : m; });
      if (META.test(s)) s = s.replace(/(\scontent=")([^"]*)"/, (m, a, v) => { const o = tr(dec(v)); return o ? a + encA(o) + '"' : m; });
      return s;
    }
    if (!/\S/.test(seg)) return seg;
    const v = tr(dec(seg)); if (!v) return seg;
    return seg.match(/^\s*/)[0] + encT(v) + seg.match(/\s*$/)[0];
  }).join('');
  const u = urlFor(site, lang);
  return out.replace(/<html lang="en"/, `<html lang="${lang}"`)
    .replace(/(<link rel="canonical" href=")[^"]*/, '$1' + u).replace(/(<meta property="og:url" content=")[^"]*/, '$1' + u)
    .replace(/(<meta property="og:locale" content=")[^"]*/, '$1' + OG[lang])
    .replace("history.replaceState(null,'','/pricing');", '');
}
// hreflang alternates + og:locale on every landing variant
const withAlternates = (html, site) => html.replace('<link rel="canonical"', hreflang(site) + '<link rel="canonical"')
  .replace('<meta property="og:type"', html.includes('og:locale') ? '<meta property="og:type"' : '<meta property="og:locale" content="en_US"><meta property="og:type"');
module.exports = { ...core, ROUTES, DICTS, T, localize, withAlternates, urlFor, hreflang };
