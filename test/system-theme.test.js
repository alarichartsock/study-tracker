const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const pub = f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const inline = html => html.match(/<script>([^<]*SHTheme[^<]*)<\/script>/)[1];
// run the early theme script with a fake OS preference and storage; returns the page state and a way to flip the OS setting
function boot(html, stored, osLight) {
  const ls = stored === undefined ? {} : { theme: stored }, meta = { content: '' }, ls_ = [], d = { dataset: {}, classList: { add() {} } };
  const q = { matches: osLight, addEventListener: (e, f) => ls_.push(f) };
  const w = { localStorage: ls, matchMedia: () => q, addEventListener() {}, document: { documentElement: d, querySelector: () => meta } };
  w.window = w; vm.runInNewContext(inline(html), w);
  return { d, meta, w, ls, flip: light => { q.matches = light; ls_.forEach(f => f()); } };
}
test('System theme: default for new users, follows the OS live, keeps saved choices, sets theme-color', () => {
  for (const f of ['index.html', 'affiliates.html', 'privacy.html', 'terms.html', 'terms-v1.0.html']) {
    const html = pub(f);
    const a = boot(html, undefined, true); assert.equal(a.d.dataset.theme, 'light', f); assert.equal(a.d.dataset.themePref, 'system'); assert.equal(a.meta.content, '#eef1f8');
    a.flip(false); assert.equal(a.d.dataset.theme, 'dark', f); assert.equal(a.meta.content, '#0b0d18');
    const b = boot(html, 'light', false); assert.equal(b.d.dataset.theme, 'light'); b.flip(false); assert.equal(b.d.dataset.theme, 'light', 'saved choice ignores OS');
    const c = boot(html, 'dark', true); assert.equal(c.d.dataset.theme, 'dark');
    c.w.SHTheme.set('system'); assert.equal(c.ls.theme, 'system'); assert.equal(c.d.dataset.theme, 'light');
  }
  const app = pub('app.js'); assert.match(app, /data-t="system"/); assert.match(app, /SHTheme\.set\(b\.dataset\.t\)/);
});
