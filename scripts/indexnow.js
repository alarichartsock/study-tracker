'use strict';
// Usage: npm run indexnow  -> POSTs the sitemap URLs to IndexNow and prints the HTTP status (200/202 = accepted).
require('../lib/indexnow').submit().then(s => { console.log('IndexNow:', s); process.exitCode = s === 200 || s === 202 ? 0 : 1; }, e => { console.error('IndexNow failed:', e.message); process.exitCode = 1; });
