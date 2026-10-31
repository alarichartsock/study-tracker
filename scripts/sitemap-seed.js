'use strict';
// Usage: npm run sitemap:seed -> writes lib/sitemap-seed.json: per route, the content hash and the last git commit date of its files.
// Optional: the server tracks changes itself; the seed just gives first-run/rebuilt-disk lastmods real git dates.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const { ROUTES, hashRoute } = require('../lib/seo');
const out = {};
for (const r of ROUTES) { const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...r.files.map(f => 'public/' + f)], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
  if (d) out[r.path] = { hash: hashRoute(r), lastmod: d }; }
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'sitemap-seed.json'), JSON.stringify(out, null, 1) + '\n'); console.log(out);
