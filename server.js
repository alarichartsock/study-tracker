'use strict';
// StudyHertz - zero-dependency Node server
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const auth = require('./lib/auth'), csv = require('./lib/csv'), stats = require('./lib/stats'), analytics = require('./lib/analytics');
const reports = require('./lib/reports'), achN = require('./lib/achnotify'), TSpec = require('./public/trophy-spec.js');
const mix = require('./public/mix.js');
const MCAT = require('./public/mcat.js');
const { Store, PALETTE } = require('./lib/store');
const oauthLib = require('./lib/oauth');
const billing = require('./lib/billing');

// Google Ads sign-up conversion label (empty = no conversion event). Env var or oauth.config.json-style ads.config.json.
const ADS_SIGNUP_LABEL = String(process.env.CONVERSION_LABEL_SIGNUP || (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'ads.config.json'), 'utf8')).CONVERSION_LABEL_SIGNUP || ''; } catch { return ''; } })()).replace(/[^A-Za-z0-9_-]/g, '');
// Google Analytics 4 measurement ID (empty = GA off). Loaded client-side only after cookie consent.
// GA4 Measurement Protocol API secret (GA Admin > Data streams > Measurement Protocol API secrets). Empty = no server-side purchase events.
const GA_API_SECRET = String(process.env.GA_API_SECRET || '').trim();
const GA_ID = /^G-[A-Z0-9]{4,20}$/.test(String(process.env.GA_MEASUREMENT_ID || '').trim()) ? String(process.env.GA_MEASUREMENT_ID).trim() : '';
// Terms/Privacy versions. Bump terms to require every user to re-accept on next visit.
const LEGAL = { terms: '1.1', privacy: '1.1', effective: '2026-10-27',
  checkbox: 'I agree to the Terms of Service and acknowledge the Privacy Policy.',
  summary: 'We updated our Terms of Service (v1.1) and Privacy Policy (v1.1) for paid plans: new accounts get a 30-day free trial, then StudyHertz costs US$4.99/month or US$39/year. The new section covers automatic renewal, how to cancel, refunds, and what happens if you don\'t subscribe (your account becomes read-only; your data is never deleted). Stripe now processes payments. Accounts created before October 28, 2026 keep free access.' };
// Neutral birth-year gate: only years that guarantee age 13+ pass (COPPA). The birth year itself is not stored.
const ageOk = by => { const y = Number(by), now = new Date().getUTCFullYear(); return Number.isInteger(y) && y >= 1900 && y <= now && now - y >= 14; };
const AGE_BLOCK = "Sorry, we can't create an account for you right now.";
const SESSION_DAYS = 30, PUBLIC = path.join(__dirname, 'public');
const DAY = 864e5;
const INDEXNOW = require('./lib/indexnow');
const STATIC = { '/': 'index.html', '/BingSiteAuth.xml': 'BingSiteAuth.xml', '/index.html': 'index.html', '/app.js': 'app.js', '/mix.js': 'mix.js', '/mcat.js': 'mcat.js', '/trophy-spec.js': 'trophy-spec.js', '/trophy3d.js': 'trophy3d.js', '/trophy3d-hq.js': 'trophy3d-hq.js', '/trophy-tier.js': 'trophy-tier.js',
  '/vendor/three/three.module.min.js': 'vendor/three/three.module.min.js', '/vendor/three/three.core.min.js': 'vendor/three/three.core.min.js', '/vendor/three/LICENSE': 'vendor/three/LICENSE', '/style.css': 'style.css', '/favicon.svg': 'favicon.svg',
  '/manifest.webmanifest': 'manifest.webmanifest', '/sw.js': 'sw.js', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/apple-touch-icon.png': 'apple-touch-icon.png', '/favicon.ico': 'favicon.ico', '/favicon-32.png': 'favicon-32.png', '/terms': 'terms.html', '/terms.html': 'terms.html', '/terms/v1.0': 'terms-v1.0.html', '/terms/v1.1': 'terms.html', '/consent.js': 'consent.js', '/privacy': 'privacy.html', '/privacy.html': 'privacy.html', '/pricing': 'index.html', '/og-image.png': 'og-image.png' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '': 'text/plain; charset=utf-8' };
// ---- SEO: per-page head for /pricing (same SPA shell), robots.txt, sitemap.xml
const SITE = 'https://studyhertz.com';
const PRICING_DESC = 'StudyHertz pricing: every account starts with a 30-day free trial, no card required. Then US$4.99 per month or US$39 per year. Cancel anytime.';
const pricingHead = html => html.replace(/<title>[^<]*<\/title>/, '<title>Pricing: 30-Day Free Trial, then $4.99/month | StudyHertz</title>')
  .replace(/(<meta name="description" content=")[^"]*/, '$1' + PRICING_DESC).replace(/(<link rel="canonical" href=")[^"]*/, '$1' + SITE + '/pricing')
  .replace(/(<meta property="og:url" content=")[^"]*/, '$1' + SITE + '/pricing').replace(/(<meta property="og:title" content=")[^"]*/, '$1StudyHertz Pricing')
  .replace(/(<meta property="og:description" content=")[^"]*/, '$1' + PRICING_DESC).replace(/(<meta name="twitter:title" content=")[^"]*/, '$1StudyHertz Pricing').replace(/(<meta name="twitter:description" content=")[^"]*/, '$1' + PRICING_DESC);
// Real 404 page for unknown non-API paths (status 404, noindex)
const NOT_FOUND_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found | StudyHertz</title><link rel="stylesheet" href="/style.css"></head><body><main style="max-width:560px;margin:15vh auto;padding:20px;text-align:center"><h1>Page not found</h1><p class="muted">That page does not exist.</p><p><a class="btn primary" href="/">Go to StudyHertz</a></p></main></body></html>\n';
const ROBOTS = 'User-agent: *\nAllow: /\nAllow: /pricing\nAllow: /terms\nAllow: /privacy\nAllow: /api/public-config\nAllow: /api/me\nDisallow: /api/\nDisallow: /terms/v\n\nSitemap: ' + SITE + '/sitemap.xml\n';
const SITEMAP = (lastmod) => '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  [['/', '1.0', 'weekly'], ['/pricing', '0.8', 'monthly'], ['/terms', '0.3', 'yearly'], ['/privacy', '0.3', 'yearly']].map(([u, pr, cf]) => `  <url><loc>${SITE}${u}</loc><lastmod>${lastmod}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>\n`).join('') + '</urlset>\n';
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const isDateKey = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const numIn = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`value must be between ${lo} and ${hi}`); return n; };
const COLOR = /^#[0-9a-fA-F]{6}$/;

function createApp(opts = {}) {
  // DATA_DIR (e.g. a mounted disk) holds data.db and approved reports; defaults to the repo folder for local installs.
  const dataDir = opts.dataDir || process.env.DATA_DIR || null; if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(opts.dataFile || path.join(dataDir || __dirname, 'data.json'));
  const fetchImpl = opts.fetch || globalThis.fetch;
  const reportsDir = opts.reportsDir || (dataDir ? path.join(dataDir, 'reports', 'approved') : path.join(__dirname, '..', 'mcat-tracker-reports', 'approved'));
  // behind a reverse proxy (Render, Cloudflare) the socket address is the proxy's; TRUST_PROXY=1 uses the forwarded client IP
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const clientIp = req => (trustProxy && (String(req.headers['cf-connecting-ip'] || '').trim() || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress || '?';
  const secureCookies = opts.secureCookies ?? process.env.NODE_ENV === 'production';
  const minSessionSec = opts.minSessionSec ?? 30;
  const ipLimiter = new auth.RateLimiter(opts.ipMaxAttempts || 20, 15 * 60e3);
  const userLimiter = new auth.RateLimiter(opts.userMaxAttempts || 5, 15 * 60e3);
  const reportLimiter = new auth.RateLimiter(opts.reportMax || 5, 60 * 60e3);
  const regLimiter = new auth.RateLimiter(opts.regMax || 10, 60 * 60e3); // sign-up attempts per IP per hour
  const oauthLimiter = new auth.RateLimiter(opts.oauthMax || 30, 15 * 60e3);
  const oauth = new oauthLib.OAuth(opts.oauth || oauthLib.loadConfig(process.env, path.join(__dirname, 'oauth.config.json')), { fetchFn: opts.fetch || fetch });
  const oauthProviders = () => oauth.enabled().map(id => ({ id, label: oauthLib.PROVIDERS[id].label }));
  // Find or create the account for a verified provider identity. Links to an existing account only by a verified email.
  function oauthAccount(id, ip) {
    const same = i => i.provider === id.provider && i.sub === id.sub;
    let u = store.db.users.find(x => (x.identities || []).some(same)), created = false;
    if (!u && id.email && id.emailVerified) u = store.db.users.find(x => (x.email && x.emailVerified && x.email === id.email) || (x.identities || []).some(i => i.emailVerified && i.email === id.email));
    if (!u && !(ip && ip.create)) { if (store.db.users.length && !store.db.config.openRegistration) throw new Error('Registration is disabled'); return { pending: true }; }
    if (!u) {
      if (store.db.users.length && !store.db.config.openRegistration) throw new Error('Registration is disabled');
      const seed = (id.login || (id.email && !id.privateRelay ? id.email.split('@')[0] : '') || id.name || id.provider).replace(/[^a-zA-Z0-9_.-]+/g, '').slice(0, 24) || id.provider;
      let name = seed.length >= 3 ? seed : seed + '-user', n = 1; while (store.findUser(name)) name = seed.slice(0, 24) + '-' + (++n);
      u = store.addUser({ username: name, salt: null, hash: null }); created = true;
      if (id.email && id.emailVerified) { u.email = id.email; u.emailVerified = true; }
    }
    u.identities ||= []; const ex = u.identities.find(same);
    if (ex) Object.assign(ex, { email: id.email, emailVerified: id.emailVerified, lastLogin: new Date().toISOString() });
    else u.identities.push({ provider: id.provider, sub: id.sub, email: id.email, emailVerified: id.emailVerified, ...(id.privateRelay ? { privateRelay: true } : {}), linked: new Date().toISOString() });
    if (id.name && !u.displayName) u.displayName = String(id.name).slice(0, 80); // Apple sends the name only once: keep the first one we get
    store.save(); return { u, created };
  }
  function recordConsent(u, method, req) {
    store.sql.addConsent({ user_id: u.id, terms_version: LEGAL.terms, privacy_version: LEGAL.privacy, ts: new Date().toISOString(), method, ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 400), checkbox_text: LEGAL.checkbox });
    u.termsVersion = LEGAL.terms; u.privacyVersion = LEGAL.privacy; store.save();
  }
  // ---- billing (Stripe, TEST mode unless STRIPE_ALLOW_LIVE=1). Off entirely unless all keys are set.
  const bcfg = opts.billing ? { ...billing.loadConfig({}), ...opts.billing } : billing.loadConfig();
  if (billing.liveKey(bcfg) && !bcfg.allowLive && !opts.quiet) console.warn('Stripe LIVE key detected: billing stays OFF (test mode only).');
  const stripe = billing.client(bcfg, opts.stripeFetch || globalThis.fetch);
  const bstat = u => billing.status(u, store.sql.subscription(u.id), bcfg);
  // ---- referrals: friend gets +30 trial days at sign-up; referrer gets +30 days when the friend logs a first study session.
  const REF_DAYS = 30, REF_CAP = Number(opts.referralCap || process.env.REFERRAL_CAP || 12), REF_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const refNorm = c => { const s = String(c || '').trim().toUpperCase(); return /^[A-Z0-9]{6,12}$/.test(s) ? s : ''; };
  const refUser = c => { const s = refNorm(c); return s ? store.db.users.find(x => x.refCode === s) : null; };
  function refCodeOf(u) { if (!u.refCode) { let c; do { c = ''; for (const b of crypto.randomBytes(8)) c += REF_ABC[b % 32]; } while (store.db.users.some(x => x.refCode === c)); u.refCode = c; store.save(); } return u.refCode; }
  const emailsOf = u => new Set([u.email, ...(u.identities || []).map(i => i.email)].filter(Boolean).map(e => String(e).toLowerCase()));
  // Called once, right after a NEW account is created. Returns true when the referral was accepted.
  function applyReferral(nu, code) {
    const ref = refUser(code); if (!ref || ref.id === nu.id || nu.referral) return false;
    const a = emailsOf(nu), b = emailsOf(ref); for (const e of a) if (b.has(e)) return false; // same email = self-referral
    if ((nu.identities || []).some(i => (ref.identities || []).some(k => k.provider === i.provider && k.sub === i.sub))) return false; // same OAuth identity
    nu.referral = { by: ref.id, code: ref.refCode, at: new Date().toISOString(), status: 'pending' };
    nu.billing ||= {}; nu.billing.trialBonusDays = (Number(nu.billing.trialBonusDays) || 0) + REF_DAYS; store.save(); return true;
  }
  // Called after the referred user logs a study session; rewards the referrer once.
  function rewardReferral(u) {
    const r = u.referral; if (!r || r.status !== 'pending') return;
    const ref = store.userById(r.by); if (!ref) { r.status = 'void'; return; }
    const credits = ref.referralCredits ||= [];
    if (credits.some(c => c.from === u.id)) { r.status = 'rewarded'; return; }
    if (credits.length >= REF_CAP) { r.status = 'capped'; r.cappedAt = new Date().toISOString(); return; }
    const st = bstat(ref), now = Date.now(), c = { from: u.id, days: REF_DAYS, at: new Date(now).toISOString(), unseen: true };
    if (st.subscribed) c.kind = 'stripe_pending'; // recorded only; applied to the Stripe subscription by an admin step (see docs/referrals.md)
    else if (st.exempt) c.kind = 'exempt'; // admin / comped / early users: nothing to extend
    else { const b = ref.billing ||= {}, prev = Number(b.trialBonusDays) || 0;
      if (st.enabled) { const base = (Date.parse(b.trialStart || ref.created) || now) + bcfg.trialDays * DAY, newEnd = Math.max(Date.parse(st.trialEnds) || now, now) + REF_DAYS * DAY;
        b.trialBonusDays = Math.round((newEnd - base) / DAY); } else b.trialBonusDays = prev + REF_DAYS;
      c.kind = 'trial'; c.addedDays = b.trialBonusDays - prev; }
    credits.push(c); r.status = 'rewarded'; r.rewardedAt = c.at;
  }
  const checkoutLimiter = new auth.RateLimiter(opts.checkoutMax || 20, 60 * 60e3);
  const baseUrl = req => String(opts.baseUrl || process.env.PUBLIC_BASE_URL || process.env.OAUTH_BASE_URL || ('http://' + (req.headers.host || 'localhost'))).replace(/\/$/, '');
  // paths an expired trial may still POST to (read-only otherwise; data is never deleted)
  const READONLY_OK = new Set(['/api/password', '/api/reports', '/api/achievements/seen', '/api/flags', '/api/timer/stop', '/api/timer/discard', '/api/referral/seen']);
  async function ensureCustomer(user) {
    const prev = store.sql.subscription(user.id); if (prev && prev.customer_id) return prev.customer_id;
    const c = await stripe('POST', '/customers', { name: user.username, ...(user.email ? { email: user.email } : {}), metadata: { uid: String(user.id) } }, 'sh-cust-' + user.id + '-' + user.created);
    store.sql.upsertSub({ user_id: user.id, customer_id: c.id, updated: new Date().toISOString() }); return c.id;
  }
  function applySub(uid, sub, extra = {}) {
    const prev = store.sql.subscription(uid) || {};
    store.sql.upsertSub({ user_id: uid, customer_id: (typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id) || prev.customer_id, subscription_id: sub.id, status: sub.status,
      plan: billing.planOf(sub, bcfg), price_id: (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id) || null, current_period_end: billing.periodEnd(sub),
      cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0, payment_failed: extra.payment_failed !== undefined ? extra.payment_failed : sub.status === 'active' ? 0 : prev.payment_failed || 0, updated: new Date().toISOString() });
  }
  // Account deletion: cancel any live Stripe subscription first (immediately, no refund). If Stripe fails, nothing is deleted.
  async function deleteAccount(target) {
    const sub = store.sql.subscription(target.id);
    if (sub && sub.subscription_id && !['canceled', 'incomplete_expired'].includes(sub.status)) {
      if (!bcfg.secretKey) throw Object.assign(new Error('billing not configured'), { stripe: true });
      try { await stripe('DELETE', '/subscriptions/' + encodeURIComponent(sub.subscription_id)); }
      catch (e) { if (e.status !== 404) { e.stripe = true; throw e; } } // 404: already gone at Stripe
    }
    store.deleteUser(target.id);
  }
  const deleteFailed = (res, e) => { if (!opts.quiet) console.error('account delete', e.status || '', e.message);
    return send(res, e.stripe ? 502 : 500, { error: e.stripe ? 'We could not cancel the subscription with Stripe, so nothing was deleted. Please try again in a few minutes.' : 'Deleting the account failed, so nothing was deleted. Please try again.' }); };
  const delLimiter = new auth.RateLimiter(5, 15 * 60e3);
  const uidFor = (cid, meta) => { const m = Number(meta && meta.uid); if (m && store.userById(m)) return m; const r = cid && store.sql.subByCustomer(typeof cid === 'string' ? cid : cid.id); return r ? r.user_id : null; };
  // Server-side GA4 purchase via the Measurement Protocol. Only when an API secret is configured AND the browser passed its
  // GA client id at checkout (it does that only after analytics consent was granted). Never throws; returns true when sent.
  const gaItems = c => [{ item_id: 'studyhertz_' + c.plan, item_name: 'StudyHertz ' + ({ yearly: 'Yearly', lifetime: 'Lifetime' }[c.plan] || 'Monthly'), item_category: 'subscription', price: c.value, quantity: 1 }];
  async function gaPurchase(cid, c) {
    const secret = opts.gaApiSecret ?? GA_API_SECRET, gaId = opts.gaId ?? GA_ID;
    if (!secret || !gaId || !/^\d{1,12}\.\d{1,12}$/.test(String(cid || ''))) return false;
    try { const r = await (opts.mpFetch || globalThis.fetch)('https://www.google-analytics.com/mp/collect?measurement_id=' + encodeURIComponent(gaId) + '&api_secret=' + encodeURIComponent(secret), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: String(cid), events: [{ name: 'purchase', params: { transaction_id: c.txn, value: c.value, currency: c.currency, items: gaItems(c), engagement_time_msec: 1 } }] }), signal: AbortSignal.timeout(5000) });
      return r.ok || r.status === 204; } catch { return false; }
  }
  async function handleStripeEvent(ev) {
    const o = (ev.data && ev.data.object) || {};
    if (ev.type === 'checkout.session.completed' && o.mode === 'payment') { // Lifetime: one-time $100 payment
      const meta = o.metadata || {}; if (meta.plan !== 'lifetime' || o.payment_status !== 'paid') return;
      const uid = Number(o.client_reference_id) || uidFor(o.customer, meta); if (!uid || !store.userById(uid)) return;
      const u = store.userById(uid); u.billing ||= {};
      if (!u.billing.lifetime) { u.billing.lifetime = { at: new Date().toISOString(), txn: o.id, amount: (o.amount_total || 0) / 100, currency: String(o.currency || 'usd').toUpperCase() };
        const conv = { value: (o.amount_total || 0) / 100, currency: String(o.currency || 'usd').toUpperCase(), txn: o.id, plan: 'lifetime' };
        if (await gaPurchase(meta.ga_cid, conv)) conv.mp = true; u.billing.conversion = conv; store.save(); }
      // an existing monthly/yearly subscription stops renewing at the end of its paid period (never refunded). A Stripe error
      // makes the webhook fail so Stripe retries; the lifetime grant above is idempotent.
      const sub = store.sql.subscription(uid);
      if (sub && sub.subscription_id && billing.ACTIVE.has(sub.status) && !sub.cancel_at_period_end) applySub(uid, await stripe('POST', '/subscriptions/' + encodeURIComponent(sub.subscription_id), { cancel_at_period_end: true }, 'sh-life-cancel-' + sub.subscription_id));
      return;
    }
    if (ev.type === 'checkout.session.completed') {
      if (o.mode !== 'subscription' || !o.subscription) return;
      const uid = Number(o.client_reference_id) || uidFor(o.customer, o.metadata); if (!uid || !store.userById(uid)) return;
      applySub(uid, await stripe('GET', '/subscriptions/' + (typeof o.subscription === 'string' ? o.subscription : o.subscription.id)), { payment_failed: 0 });
      const u = store.userById(uid), meta = o.metadata || {}, plan = billing.PLANS[meta.plan] ? meta.plan : (store.sql.subscription(uid) || {}).plan || 'monthly';
      const conv = { value: (o.amount_total || 0) / 100, currency: String(o.currency || 'usd').toUpperCase(), txn: o.id, plan };
      if (await gaPurchase(meta.ga_cid, conv)) conv.mp = true; // sent server-side: the browser must not send it again
      u.billing ||= {}; u.billing.conversion = conv; store.save();
    } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
      const uid = uidFor(o.customer, o.metadata); if (uid) applySub(uid, o);
    } else if (ev.type === 'invoice.payment_failed') {
      const uid = uidFor(o.customer, null); if (!uid) return;
      const sid = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      if (sid) applySub(uid, await stripe('GET', '/subscriptions/' + (typeof sid === 'string' ? sid : sid.id)), { payment_failed: 1 });
      else store.sql.upsertSub({ user_id: uid, payment_failed: 1, updated: new Date().toISOString() });
    }
  }
  async function stripeWebhook(req, res) {
    if (!billing.enabled(bcfg)) return send(res, 404, { error: 'not found' });
    const raw = await readBody(req, 1e6);
    if (!billing.verifySignature(raw, req.headers['stripe-signature'], bcfg.webhookSecret)) return send(res, 400, { error: 'invalid signature' });
    let ev; try { ev = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid payload' }); }
    if (ev.livemode && !bcfg.allowLive) return send(res, 200, { ignored: 'livemode' });
    if (!ev.id || !store.sql.eventNew(ev.id, String(ev.type))) return send(res, 200, { duplicate: true });
    try { await handleStripeEvent(ev); } catch (e) { store.sql.eventForget(ev.id); if (!opts.quiet) console.error('stripe webhook', ev.type, e.message); return send(res, 500, { error: 'retry later' }); }
    return send(res, 200, { received: true });
  }
  const pendingSignups = new Map(); // short-lived: social identities waiting for the clickwrap + age gate before an account exists
  async function oauthRoute(req, res, p, step) {
    const ip = clientIp(req), back = (q, cookies = []) => { res.writeHead(302, { Location: '/' + q, 'Set-Cookie': [...cookies, 'oa=; Path=/api/oauth; HttpOnly; Max-Age=0'], 'Cache-Control': 'no-store' }); res.end(); };
    if (oauthLimiter.blocked(ip)) return back('?oauth_error=' + encodeURIComponent('Too many attempts. Try again in 15 minutes.'));
    oauthLimiter.fail(ip);
    if (!oauth.enabled().includes(p)) return back('?oauth_error=' + encodeURIComponent('That sign-in option is not available'));
    if (step === 'start') { const s = oauth.start(p), secure = oauth.cfg.base.startsWith('https:');
      res.writeHead(302, { Location: s.url, 'Set-Cookie': `oa=${s.bind}; Path=/api/oauth; HttpOnly; Max-Age=600; ${secure ? 'SameSite=None; Secure' : 'SameSite=Lax'}`, 'Cache-Control': 'no-store' }); return res.end(); }
    try {
      const params = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      if (req.method === 'POST') Object.assign(params, Object.fromEntries(new URLSearchParams(await readBody(req))));
      const id = await oauth.callback(p, params, auth.parseCookies(req.headers.cookie).oa);
      const r = oauthAccount(id, ip);
      if (r.pending) { for (const [k, v] of pendingSignups) if (Date.now() - v.at > 15 * 60e3) pendingSignups.delete(k);
        const t = auth.newToken(); pendingSignups.set(t, { id, at: Date.now() });
        return back('?complete_signup=1', [`ps=${t}; Path=/api/oauth; HttpOnly; Max-Age=900; SameSite=Lax${secureCookies ? '; Secure' : ''}`]); }
      return back(r.created ? '?welcome=1' : '', [startSession(r.u.id)]);
    } catch (e) { return back('?oauth_error=' + encodeURIComponent(e.message || 'Sign-in failed')); }
  }
  store.db.reports ||= []; store.db.nextReportId ||= 1;
  // one-time: open public self sign-up (admins can still close it in Settings)
  if (!(store.db.config ||= {}).publicRegistration) { store.db.config.openRegistration = true; store.db.config.publicRegistration = { at: new Date().toISOString() }; store.save(); }
  if (!store.db.config.billingGrant) { // one-time: every account that exists before paid plans is comped for life (legacy)
    let n = 0; for (const x of store.db.users) { x.billing ||= {}; if (!x.billing.legacy) { x.billing.legacy = true; n++; } }
    store.db.config.billingGrant = { at: new Date().toISOString(), users: n }; store.save(); }
  if (!(store.db.config ||= {}).readyRoomGrant) { // idempotent: runs once per data file; new users after this must take the tour
    let n = 0; for (const ud of Object.values(store.db.userData || {})) { const fl = ud.flags ||= {}; if (!fl.onboarded) { fl.onboarded = 1; n++; }
      if (Array.isArray(ud.achNotified) && !ud.achNotified.includes('onboard')) ud.achNotified.push('onboard'); } // silent: already "notified"
    store.db.config.readyRoomGrant = { at: new Date().toISOString(), users: n }; store.save(); if (n && !opts.quiet) console.log('Granted Ready Room to ' + n + ' existing user(s)'); }

  async function busy(ud, text) { // Busy Bar HTTP API; never throws
    const { busyIp, busyToken } = ud.settings; if (!busyIp || !fetchImpl) return false;
    const base = 'http://' + busyIp, headers = { 'Content-Type': 'application/json' };
    if (busyToken) headers['X-API-Token'] = busyToken;
    try {
      const signal = AbortSignal.timeout(3000);
      if (text === null) await fetchImpl(base + '/api/display/draw?app_id=mcat', { method: 'DELETE', headers, signal });
      else await fetchImpl(base + '/api/display/draw', { method: 'POST', headers, signal, body: JSON.stringify({
        app_id: 'mcat', elements: [{ id: 't', type: 'text', text, x: 0, y: 0, display: 'front' }] }) });
      return true;
    } catch { return false; }
  }

  const send = (res, code, body, type = 'application/json', extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', ...extra });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readBody = (req, max = 20e6) => new Promise((resolve, reject) => { let b = ''; req.on('data', c => { b += c; if (b.length > max) { reject(new Error('body too large')); req.destroy(); } }); req.on('end', () => resolve(b)); });
  const cookie = (token, maxAge) => `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  function currentUser(req) {
    const t = auth.parseCookies(req.headers.cookie).sid; if (!t) return null;
    const k = auth.tokenKey(t), s = store.db.tokens[k];
    if (!s) return null;
    if (s.exp < Date.now()) { delete store.db.tokens[k]; store.save(); return null; }
    return store.userById(s.uid) || null;
  }
  function startSession(uid) {
    const t = auth.newToken(), now = Date.now();
    for (const [k, v] of Object.entries(store.db.tokens)) if (v.exp < now) delete store.db.tokens[k];
    store.db.tokens[auth.tokenKey(t)] = { uid, exp: now + SESSION_DAYS * 864e5 }; store.save();
    return cookie(t, SESSION_DAYS * 86400);
  }
  const publicUser = u => ({ id: u.id, username: u.username, admin: !!u.admin, hasPassword: !!u.hash, ...(u.displayName ? { displayName: u.displayName } : {}) });
  const maskedState = ud => { const { athenifyFeed, ...rest } = ud; void athenifyFeed; const { feedToken, ...settings } = ud.settings; void feedToken;
    return { ...rest, settings: { ...settings, busyToken: ud.settings.busyToken ? '********' : '' } }; };
  const ensureSubject = (ud, name) => { if (name && !ud.subjects.includes(name)) { ud.subjects.push(name); ud.subjectMeta[name] ||= { color: PALETTE[(ud.subjects.length - 1) % PALETTE.length], weeklyGoalMin: 0, credits: 0 }; } };
  const ensureActivity = (ud, name) => { if (name && !ud.activities.includes(name)) ud.activities.push(name); };
  const cleanSession = j => {
    const st = new Date(j.start), en = new Date(j.end);
    if (isNaN(st) || isNaN(en) || en <= st || en - st > 864e5) throw new Error('invalid start/end');
    const breakSec = Math.round(numIn(j.breakSec || 0, 0, (en - st) / 1000));
    const out = { subject: str(j.subject || 'Other', 60), activity: str(j.activity, 60), note: str(j.note, 1000), start: st.toISOString(), end: en.toISOString(), breakSec };
    for (const k of ['focus', 'progress']) out[k] = j[k] ? Math.round(numIn(j[k], 1, 5)) : null;
    if (j.mode) out.mode = ['stopwatch', 'pomodoro', 'countdown', 'manual'].includes(j.mode) ? j.mode : 'manual';
    return out;
  };
  // Generic per-user collection CRUD (exams, tasks)
  function crud(ud, coll, p, M, j, clean, res) {
    if (p === `/api/${coll}` && M === 'GET') return send(res, 200, ud[coll]);
    if (p === `/api/${coll}` && M === 'POST') { const x = { id: ud.nextId++, created: new Date().toISOString(), ...clean(j, {}) }; ud[coll].push(x); store.save(); return send(res, 200, x); }
    const m = new RegExp(`^/api/${coll}/(\\d+)$`).exec(p); if (!m) return false;
    const i = ud[coll].findIndex(x => x.id === +m[1]); if (i < 0) return send(res, 404, { error: 'not found' });
    if (M === 'DELETE') ud[coll].splice(i, 1); else if (M === 'PUT') Object.assign(ud[coll][i], clean(j, ud[coll][i])); else return send(res, 405, { error: 'method' });
    store.save(); return send(res, 200, M === 'DELETE' ? { ok: true } : ud[coll][i]);
  }
  // Exams are MCAT sittings: one combined score (472-528). Legacy subject/weight fields are no longer written or used,
  // but are left in place on existing records (PUT merges), so no data is lost.
  const cleanExam = (j, old) => { const date = j.date ?? old.date; if (!isDateKey(date)) throw new Error('exam date required (YYYY-MM-DD)');
    let grade = old.grade ?? null; if (j.grade !== undefined) { if (j.grade === '' || j.grade === null) grade = null; else { const g = Number(j.grade); if (!Number.isInteger(g) || g < 472 || g > 528) throw new Error('score must be a whole number from 472 to 528'); grade = g; } }
    return { name: str(j.name ?? old.name, 100) || 'Exam', date, notes: str(j.notes ?? old.notes, 1000), grade }; };
  const cleanTask = (j, old) => { const due = j.due !== undefined ? j.due : old.due; if (due && !isDateKey(due)) throw new Error('due must be YYYY-MM-DD');
    const done = j.done !== undefined ? !!j.done : !!old.done;
    return { title: str(j.title ?? old.title, 200) || 'Task', due: due || '', priority: ['low', 'normal', 'high'].includes(j.priority) ? j.priority : old.priority || 'normal',
      subject: str(j.subject ?? old.subject, 60), done, doneAt: done ? old.doneAt || new Date().toISOString() : null }; };

  // Static assets: ETag + 304, gzip/brotli for text, cache policy by type (HTML/JS/CSS revalidate; images 1 day; vendor immutable).
  const SCACHE = new Map();
  function asset(p) {
    const f = path.join(PUBLIC, STATIC[p]), m = fs.statSync(f).mtimeMs, hit = SCACHE.get(p); if (hit && hit.m === m) return hit;
    let buf = fs.readFileSync(f); if (p === '/pricing') buf = Buffer.from(pricingHead(buf.toString('utf8')));
    const type = MIME[path.extname(f)] || 'application/octet-stream', text = /text|javascript|json|svg|xml|manifest/.test(type) && buf.length > 860;
    const a = { m, buf, type, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 22) + '"',
      br: text ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 10 } }) : null, gz: text ? zlib.gzipSync(buf, { level: 9 }) : null };
    SCACHE.set(p, a); return a;
  }
  function serveStatic(req, res, p) {
    const a = asset(p), ext = path.extname(STATIC[p]);
    const cc = p.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : ['.png', '.svg', '.webp'].includes(ext) ? 'public, max-age=86400' : 'no-cache';
    const hd = { 'Content-Type': a.type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': cc, ETag: a.etag, Vary: 'Accept-Encoding', ...(p === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) };
    if (req.headers['if-none-match'] === a.etag) { res.writeHead(304, hd); return res.end(); }
    const ae = String(req.headers['accept-encoding'] || ''), body = a.br && /\bbr\b/.test(ae) ? (hd['Content-Encoding'] = 'br', a.br) : a.gz && /\bgzip\b/.test(ae) ? (hd['Content-Encoding'] = 'gzip', a.gz) : a.buf;
    hd['Content-Length'] = body.length; res.writeHead(200, hd); res.end(req.method === 'HEAD' ? undefined : body);
  }
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, M = req.method;
    try {
      if ((M === 'GET' || M === 'HEAD') && STATIC[p]) return serveStatic(req, res, p);
      const plain = (code, body, type, cc) => { const b = Buffer.from(body); res.writeHead(code, { 'Content-Type': type, 'Content-Length': b.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cc }); res.end(M === 'HEAD' ? undefined : b); };
      if ((M === 'GET' || M === 'HEAD') && p === INDEXNOW.KEY_PATH) return plain(200, INDEXNOW.KEY, 'text/plain; charset=utf-8', 'public, max-age=86400');
      if ((M === 'GET' || M === 'HEAD') && p === '/robots.txt') return plain(200, ROBOTS, 'text/plain; charset=utf-8', 'public, max-age=3600');
      if ((M === 'GET' || M === 'HEAD') && p === '/sitemap.xml') return plain(200, SITEMAP(LEGAL.effective), 'application/xml; charset=utf-8', 'public, max-age=3600');
      if (p.startsWith('/api/')) res.setHeader('X-Robots-Tag', 'noindex');
      if (!p.startsWith('/api/')) return plain(404, NOT_FOUND_HTML, 'text/html; charset=utf-8', 'no-cache');
      if (p === '/api/stripe/webhook' && M === 'POST') return stripeWebhook(req, res); // raw body: verified before parsing
      const om = /^\/api\/oauth\/([a-z]+)\/(start|callback)$/.exec(p);
      if (om && (M === 'GET' || (M === 'POST' && om[2] === 'callback'))) return oauthRoute(req, res, om[1], om[2]);
      let j = {};
      if (M !== 'GET' && M !== 'HEAD') {
        const raw = await readBody(req);
        if (raw) { if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON required' }); j = JSON.parse(raw); if (!j || typeof j !== 'object') j = {}; }
      }
      const user = currentUser(req);

      // ---- public auth endpoints ----
      if (p === '/api/health') return send(res, 200, { ok: true, users: store.db.users.length > 0 });
      if (p === '/api/public-config') return send(res, 200, { signupLabel: ADS_SIGNUP_LABEL, gaId: opts.gaId ?? GA_ID, billing: billing.enabled(bcfg) ? { trialDays: bcfg.trialDays, plans: billing.plansFor(bcfg) } : null });
      if (p === '/api/me') return send(res, 200, { user: user && publicUser(user), needsSetup: store.db.users.length === 0, registrationOpen: store.db.users.length === 0 || !!store.db.config.openRegistration, oauth: oauthProviders(), ...(user ? { billing: bstat(user) } : {}), ...(user && user.termsVersion !== LEGAL.terms ? { termsRequired: { terms: LEGAL.terms, privacy: LEGAL.privacy, summary: LEGAL.summary, checkbox: LEGAL.checkbox } } : {}) });
      if (p === '/api/referral/check' && M === 'GET') return send(res, 200, { valid: !!refUser(u.searchParams.get('code')), days: REF_DAYS, trialDays: bcfg.trialDays + REF_DAYS });
      if (p === '/api/register' && M === 'POST') {
        if (store.db.users.length && !store.db.config.openRegistration) return send(res, 403, { error: 'Registration is disabled' });
        const rip = clientIp(req); if (regLimiter.blocked(rip)) return send(res, 429, { error: 'Too many sign-up attempts. Try again later.' }); regLimiter.fail(rip);
        if (!auth.validUsername(j.username)) return send(res, 400, { error: 'Username: 3-32 chars, letters/numbers/._-' });
        if (!auth.validPassword(j.password)) return send(res, 400, { error: 'Password must be at least 8 characters' });
        if (j.agree !== true) return send(res, 400, { error: 'Please agree to the Terms of Service and Privacy Policy' });
        if (!ageOk(j.birthYear)) return send(res, 403, { error: AGE_BLOCK });
        if (store.findUser(j.username)) return send(res, 409, { error: 'Username taken' });
        const nu = store.addUser({ username: j.username, ...(await auth.hashPassword(j.password)) });
        recordConsent(nu, 'password', req); const referred = j.ref ? applyReferral(nu, j.ref) : false;
        return send(res, 200, { user: publicUser(nu), onboarding: true, ...(referred ? { referral: true } : {}) }, 'application/json', { 'Set-Cookie': startSession(nu.id) });
      }
      if (p === '/api/oauth/pending' && M === 'GET') { const t = auth.parseCookies(req.headers.cookie).ps, pe = t && pendingSignups.get(t);
        return send(res, 200, pe ? { pending: true, provider: oauthLib.PROVIDERS[pe.id.provider].label } : { pending: false }); }
      if (p === '/api/oauth/complete' && M === 'POST') {
        const t = auth.parseCookies(req.headers.cookie).ps, pe = t && pendingSignups.get(t);
        if (!pe || Date.now() - pe.at > 15 * 60e3) return send(res, 400, { error: 'Sign-in expired, please try again' });
        if (j.agree !== true) return send(res, 400, { error: 'Please agree to the Terms of Service and Privacy Policy' });
        if (!ageOk(j.birthYear)) { pendingSignups.delete(t); return send(res, 403, { error: AGE_BLOCK }, 'application/json', { 'Set-Cookie': 'ps=; Path=/api/oauth; HttpOnly; Max-Age=0' }); }
        const ip = clientIp(req); if (regLimiter.blocked(ip)) return send(res, 429, { error: 'Too many sign-up attempts. Try again later.' }); regLimiter.fail(ip);
        let r; try { r = oauthAccount(pe.id, { create: true }); } catch (e) { return send(res, 403, { error: e.message }); }
        pendingSignups.delete(t); recordConsent(r.u, 'oauth:' + pe.id.provider, req); const referred = r.created && j.ref ? applyReferral(r.u, j.ref) : false;
        return send(res, 200, { user: publicUser(r.u), onboarding: true, ...(referred ? { referral: true } : {}) }, 'application/json', { 'Set-Cookie': [startSession(r.u.id), 'ps=; Path=/api/oauth; HttpOnly; Max-Age=0'] });
      }
      if (p === '/api/login' && M === 'POST') {
        const ip = clientIp(req), uk = 'u:' + String(j.username || '').toLowerCase();
        if (ipLimiter.blocked(ip) || userLimiter.blocked(uk)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
        const found = store.findUser(j.username || '');
        const ok = found && found.hash ? await auth.verifyPassword(j.password || '', found.salt, found.hash) : (await auth.hashPassword('x'), false); // equalize timing
        if (!ok) { ipLimiter.fail(ip); userLimiter.fail(uk); return send(res, 401, { error: 'Invalid username or password' }); }
        userLimiter.reset(uk);
        return send(res, 200, { user: publicUser(found) }, 'application/json', { 'Set-Cookie': startSession(found.id) });
      }
      if (p === '/api/logout' && M === 'POST') {
        const t = auth.parseCookies(req.headers.cookie).sid; if (t) { delete store.db.tokens[auth.tokenKey(t)]; store.save(); }
        return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': cookie('', 0) });
      }
      if (!user) return send(res, 401, { error: 'Not logged in' });
      if (p === '/api/account/delete' && M === 'POST') { // JSON-only body + SameSite=Lax cookie, same CSRF posture as every other POST
        if (user.admin) return send(res, 403, { error: 'The admin account cannot be deleted from Settings.' });
        const conf = String(j.confirm || '').trim();
        if (!(conf === 'DELETE' || (user.email && conf.toLowerCase() === String(user.email).toLowerCase()))) return send(res, 400, { error: 'Type DELETE to confirm.' });
        if (user.hash) { const k = 'del:' + user.id; if (delLimiter.blocked(k)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
          if (!(await auth.verifyPassword(j.password || '', user.salt, user.hash))) { delLimiter.fail(k); return send(res, 403, { error: 'That password is not correct.' }); } }
        try { await deleteAccount(user); } catch (e) { return deleteFailed(res, e); }
        return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': cookie('', 0) });
      }
      if (p === '/api/terms/accept' && M === 'POST') { if (j.agree !== true) return send(res, 400, { error: 'Please check the box to continue' }); recordConsent(user, 'reaccept', req); return send(res, 200, { ok: true }); }
      if (user.termsVersion !== LEGAL.terms) return send(res, 403, { error: 'Please review and accept the updated Terms', termsRequired: true });

      // ---- billing ----
      if (p === '/api/billing' && M === 'GET') { const st = bstat(user), c = user.billing && user.billing.conversion;
        return send(res, 200, { ...st, ...(st.enabled ? { plans: billing.plansFor(bcfg) } : {}), ...(c ? { conversion: { ...(bcfg.purchaseLabel ? { label: bcfg.purchaseLabel } : {}), ...c } } : {}) }); }
      if (p === '/api/billing/conversion-seen' && M === 'POST') { if (user.billing && user.billing.conversion) { delete user.billing.conversion; store.save(); } return send(res, 200, { ok: true }); }
      if ((p === '/api/billing/checkout' || p === '/api/billing/portal') && M === 'POST') {
        if (!billing.enabled(bcfg)) return send(res, 404, { error: 'Billing is not enabled' });
        const ck = 'b:' + user.id; if (checkoutLimiter.blocked(ck)) return send(res, 429, { error: 'Too many attempts. Try again later.' }); checkoutLimiter.fail(ck);
        try {
          if (p === '/api/billing/portal') { const r = store.sql.subscription(user.id); if (!r || !r.customer_id) return send(res, 400, { error: 'No subscription to manage yet' });
            return send(res, 200, { url: (await stripe('POST', '/billing_portal/sessions', { customer: r.customer_id, return_url: baseUrl(req) + '/?billing=portal' })).url }); }
          const plan = ['yearly', 'lifetime'].includes(j.plan) ? j.plan : 'monthly', st0 = bstat(user), gaMeta = /^\d{1,12}\.\d{1,12}$/.test(String(j.gaCid || '')) ? { ga_cid: String(j.gaCid) } : {};
          if (st0.lifetime) return send(res, 409, { error: 'You already have lifetime access.' });
          if (plan === 'lifetime') { if (!bcfg.prices.lifetime) return send(res, 400, { error: 'The lifetime plan is not available.' });
            const customer = await ensureCustomer(user), base = baseUrl(req);
            const cs = await stripe('POST', '/checkout/sessions', { mode: 'payment', customer, client_reference_id: String(user.id), line_items: [{ price: bcfg.prices.lifetime, quantity: 1 }],
              success_url: base + '/?billing=success', cancel_url: base + '/?billing=cancel', metadata: { uid: String(user.id), plan, ...gaMeta }, payment_intent_data: { metadata: { uid: String(user.id), plan } },
              integration_identifier: 'studyhertz-lifetime-qhxmzpta' });
            return send(res, 200, { url: cs.url }); }
          if (st0.subscribed) return send(res, 409, { error: 'You already have a subscription. Use Manage subscription to change it.' });
          const customer = await ensureCustomer(user), base = baseUrl(req);
          const cs = await stripe('POST', '/checkout/sessions', { mode: 'subscription', customer, client_reference_id: String(user.id), line_items: [{ price: bcfg.prices[plan], quantity: 1 }],
            success_url: base + '/?billing=success', cancel_url: base + '/?billing=cancel', metadata: { uid: String(user.id), plan, ...gaMeta }, subscription_data: { metadata: { uid: String(user.id) } },
            integration_identifier: 'studyhertz-subscribe-qhxmzpta' });
          return send(res, 200, { url: cs.url });
        } catch (e) { if (!opts.quiet) console.error('stripe', p, e.status, e.message); return send(res, 502, { error: 'Billing is temporarily unavailable. Please try again.' }); }
      }
      if (M !== 'GET' && !READONLY_OK.has(p) && !p.startsWith('/api/admin/') && !bstat(user).active)
        return send(res, 402, { error: 'Your free trial has ended. Subscribe to keep tracking. Your data is safe and you can still view and export it.', paywall: true });

      // ---- authenticated, per-user data ----
      const ud = store.data(user.id), save = () => store.save(), h = +ud.settings.dayStartHour || 0;
      if (p === '/api/password' && M === 'POST') {
        if (!(await auth.verifyPassword(j.current || '', user.salt, user.hash))) return send(res, 401, { error: 'Current password is wrong' });
        if (!auth.validPassword(j.password)) return send(res, 400, { error: 'Password must be at least 8 characters' });
        Object.assign(user, await auth.hashPassword(j.password));
        for (const [k, v] of Object.entries(store.db.tokens)) if (v.uid === user.id) delete store.db.tokens[k];
        save(); return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': startSession(user.id) });
      }
      if (p === '/api/referral' && M === 'GET') { const code = refCodeOf(user), cr = user.referralCredits || [];
        return send(res, 200, { code, link: baseUrl(req) + '/?ref=' + code, days: REF_DAYS, cap: REF_CAP, credits: cr.length, daysEarned: cr.reduce((a, c) => a + (c.kind === 'trial' ? c.addedDays || 0 : c.days), 0),
          pendingStripe: cr.filter(c => c.kind === 'stripe_pending').length, invited: store.db.users.filter(x => x.referral && x.referral.by === user.id).length, unseen: cr.filter(c => c.unseen).length }); }
      if (p === '/api/referral/seen' && M === 'POST') { for (const c of user.referralCredits || []) delete c.unseen; save(); return send(res, 200, { ok: true }); }
      if (p === '/api/state') return send(res, 200, maskedState(ud));
      if (p === '/api/stats') return send(res, 200, { ...stats.computeStats(ud.sessions, { goals: ud.settings.goals, dayStartHour: h }), goals: analytics.goalProgress(ud),
        suggestion: analytics.suggestDuration(ud.sessions, u.searchParams.get('subject') || undefined) });
      if (p === '/api/report') {
        const from = u.searchParams.get('from') || undefined, to = u.searchParams.get('to') || undefined;
        if ((from && !isDateKey(from)) || (to && !isDateKey(to))) return send(res, 400, { error: 'from/to must be YYYY-MM-DD' });
        const subj = u.searchParams.get('subject'), list = subj ? ud.sessions.filter(s => s.subject === subj) : ud.sessions, o = { h, medals: ud.settings.medals };
        const r = from && to ? analytics.compare(list, from, to, o) : { current: analytics.report(list, { ...o, from, to }) };
        return send(res, 200, { ...r, cumulative: analytics.cumulative(list, h) });
      }
      const achFull = () => { const A = analytics.achievements(ud, h);
        const E = analytics.earnedCounts(store.db.users.map(x => { const d = store.data(x.id); return [d, +d.settings.dayStartHour || 0]; })); // aggregate counts only
        for (const x of A.global) { const n = E.counts[x.id] || 0; x.earnedBy = { count: n, users: E.users, pct: E.users ? Math.round(n / E.users * 100) : 0 }; }
        return A; };
      if (p === '/api/achievements') return send(res, 200, achFull());
      // newly earned since last notification (first call silently records what's already earned)
      if (p === '/api/achievements/new' && M === 'GET') { const A = achFull(), r = achN.pending(ud, A); if (r.init) save();
        const all = [...A.global, ...A.personal], tiers = TSpec.tiers(all), want = new Set(r.ids);
        return send(res, 200, { new: all.filter(a => want.has(a.id)).map(a => ({ ...a, spec: TSpec.spec(a, tiers[a.id], a.kind === 'subject' ? ud.subjectMeta[a.key]?.color : null) })) }); }
      if (p === '/api/achievements/seen' && M === 'POST') { const A = analytics.achievements(ud, h), n = achN.markSeen(ud, A, Array.isArray(j.ids) ? j.ids.slice(0, 500) : []); if (n) save(); return send(res, 200, { ok: true, marked: n }); }
      if (p === '/api/flags' && M === 'POST') { const fl = ud.flags ||= {}, k = String(j.key || '');
        if (k === 'onboarded') fl.onboarded = 1; else if (k.startsWith('view:') && analytics.VIEW_KEYS.includes(k.slice(5))) { fl.views ||= []; if (!fl.views.includes(k.slice(5))) fl.views.push(k.slice(5)); }
        else return send(res, 400, { error: 'unknown flag' });
        save(); return send(res, 200, { ok: true }); }
      if (p === '/api/export.csv') return send(res, 200, csv.sessionsToCSV(ud.sessions), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="mcat-sessions.csv"' });
      if (p === '/api/export.json') { const { active, ...data } = maskedState(ud); void active;
        return send(res, 200, { app: 'mcat-tracker', exported: new Date().toISOString(), user: user.username, data }, 'application/json', { 'Content-Disposition': 'attachment; filename="mcat-tracker-export.json"' }); }
      if (p === '/api/import.json' && M === 'POST') { // merge a JSON export back in (dedupes sessions by start+end+subject)
        const d = (j.data || j); const key = s => `${s.start}|${s.end}|${s.subject}`, have = new Set(ud.sessions.map(key)); let added = 0, skipped = 0;
        for (const s of Array.isArray(d.sessions) ? d.sessions : []) { let c; try { c = cleanSession(s); } catch { skipped++; continue; } if (have.has(key(c))) { skipped++; continue; }
          ensureSubject(ud, c.subject); ensureActivity(ud, c.activity); ud.sessions.push({ id: ud.nextId++, ...c, ...(s.extUid ? { extUid: str(s.extUid, 210) } : {}) }); have.add(key(c)); added++; }
        for (const e of Array.isArray(d.exams) ? d.exams : []) { try { let x; try { x = cleanExam(e, {}); } catch { x = cleanExam({ ...e, grade: null }, {}); } ud.exams.push({ id: ud.nextId++, ...x }); } catch { /* skip */ } }
        for (const t of Array.isArray(d.tasks) ? d.tasks : []) { try { ud.tasks.push({ id: ud.nextId++, ...cleanTask(t, {}) }); } catch { /* skip */ } }
        save(); return send(res, 200, { added, skipped });
      }
      if (p === '/api/import' && M === 'POST') {
        if (typeof j.csv !== 'string') return send(res, 400, { error: 'csv (string) required' });
        const r = csv.csvToSessions(j.csv, j.map);
        for (const s of r.sessions) { ensureSubject(ud, s.subject); ud.sessions.push({ id: ud.nextId++, ...s, source: 'import' }); }
        save(); return send(res, 200, { added: r.sessions.length, skipped: r.skipped, columns: r.columns });
      }
      // ---- timer ----
      if (p === '/api/timer/start' && M === 'POST') {
        if (!ud.active) ud.active = { subject: str(j.subject || ud.subjects[0] || 'Study', 60), activity: str(j.activity, 60), note: str(j.note, 1000), start: new Date().toISOString(), accum: 0, paused: false,
          mode: ['stopwatch', 'pomodoro', 'countdown'].includes(j.mode) ? j.mode : 'stopwatch', targetSec: j.targetSec ? Math.round(numIn(j.targetSec, 60, 86400)) : null, breakSec: 0, pausedAt: null };
        else if (ud.active.paused) { if (ud.active.pausedAt) ud.active.breakSec += 0; ud.active.start = new Date().toISOString(); ud.active.paused = false; ud.active.pausedAt = null; }
        save(); busy(ud, 'Studying ' + ud.active.subject); return send(res, 200, ud.active);
      }
      if (p === '/api/timer/pause' && M === 'POST') {
        if (!ud.active || ud.active.paused) return send(res, 409, { error: 'Timer not running' });
        ud.active.accum += (Date.now() - new Date(ud.active.start)) / 1000; ud.active.paused = true; ud.active.pausedAt = new Date().toISOString(); save(); busy(ud, j.reason === 'break' ? 'Break' : 'Paused'); return send(res, 200, ud.active);
      }
      if (p === '/api/timer/stop' && M === 'POST') {
        const a = ud.active; if (!a) return send(res, 409, { error: 'Timer not running' });
        const secs = a.accum + (a.paused ? 0 : (Date.now() - new Date(a.start)) / 1000);
        if (j.note !== undefined) a.note = str(j.note, 1000); if (j.subject) a.subject = str(j.subject, 60); if (j.activity !== undefined) a.activity = str(j.activity, 60);
        let session = null;
        if (secs >= minSessionSec) { const end = new Date();
          session = { id: ud.nextId++, subject: a.subject, activity: a.activity || '', note: a.note, start: new Date(+end - secs * 1000).toISOString(), end: end.toISOString(), breakSec: 0, mode: a.mode || 'stopwatch',
            focus: j.focus ? Math.round(numIn(j.focus, 1, 5)) : null, progress: j.progress ? Math.round(numIn(j.progress, 1, 5)) : null };
          ud.sessions.push(session); ensureSubject(ud, a.subject); ensureActivity(ud, a.activity); }
        if (session) rewardReferral(user); ud.active = null; save(); busy(ud, null); return send(res, 200, { ok: true, session });
      }
      if (p === '/api/timer/discard' && M === 'POST') { ud.active = null; save(); busy(ud, null); return send(res, 200, { ok: true }); }

      // ---- sessions ----
      if (p === '/api/sessions' && M === 'GET') return send(res, 200, ud.sessions);
      if (p === '/api/sessions' && M === 'POST') { const s = { id: ud.nextId++, mode: 'manual', ...cleanSession(j) }; ud.sessions.push(s); ensureSubject(ud, s.subject); ensureActivity(ud, s.activity); rewardReferral(user); save(); return send(res, 200, s); }
      if (p === '/api/sessions/bulk' && M === 'POST') {
        const ids = new Set((Array.isArray(j.ids) ? j.ids : []).map(Number)), hit = ud.sessions.filter(s => ids.has(s.id));
        if (j.action === 'delete') { ud.sessions = ud.sessions.filter(s => !ids.has(s.id)); save(); return send(res, 200, { deleted: hit.length, removed: hit }); }
        if (j.action === 'update') { const set = {}; if (j.set?.subject) set.subject = str(j.set.subject, 60); if (j.set?.activity !== undefined) set.activity = str(j.set.activity, 60);
          hit.forEach(s => Object.assign(s, set)); ensureSubject(ud, set.subject); ensureActivity(ud, set.activity); save(); return send(res, 200, { updated: hit.length }); }
        if (j.action === 'restore') { let n = 0; for (const s of Array.isArray(j.sessions) ? j.sessions.slice(0, 1000) : []) { try { ud.sessions.push({ id: ud.nextId++, ...cleanSession(s), ...(s.extUid ? { extUid: str(s.extUid, 210) } : {}) }); n++; } catch { /* skip */ } } save(); return send(res, 200, { restored: n }); }
        return send(res, 400, { error: 'action must be delete, update or restore' });
      }
      let m = /^\/api\/sessions\/(\d+)$/.exec(p);
      if (m) {
        const i = ud.sessions.findIndex(s => s.id === +m[1]); if (i < 0) return send(res, 404, { error: 'not found' });
        if (M === 'DELETE') { const [gone] = ud.sessions.splice(i, 1); save(); return send(res, 200, { ok: true, removed: gone }); }
        if (M === 'PUT') { Object.assign(ud.sessions[i], cleanSession({ ...ud.sessions[i], ...j })); ensureSubject(ud, ud.sessions[i].subject); ensureActivity(ud, ud.sessions[i].activity); save(); return send(res, 200, ud.sessions[i]); }
        return send(res, 405, { error: 'method' });
      }
      // ---- subjects & activities ----
      if (p === '/api/subjects' && M === 'POST') { ensureSubject(ud, str(j.name, 60)); save(); return send(res, 200, ud.subjects); }
      if (p === '/api/subjects' && M === 'DELETE') { ud.subjects = ud.subjects.filter(s => s !== j.name); save(); return send(res, 200, ud.subjects); }
      if (p === '/api/subjects' && M === 'PUT') { // update meta and/or rename (renames past sessions too)
        const name = str(j.name, 60); if (!ud.subjects.includes(name)) return send(res, 404, { error: 'unknown subject' });
        const meta = ud.subjectMeta[name] ||= {};
        if (j.color !== undefined) { if (!COLOR.test(j.color)) return send(res, 400, { error: 'color must be #rrggbb' }); meta.color = j.color; }
        if (j.weeklyGoalMin !== undefined) meta.weeklyGoalMin = Math.round(numIn(j.weeklyGoalMin, 0, 10080));
        if (j.credits !== undefined) meta.credits = numIn(j.credits, 0, 100);
        const nn = str(j.rename, 60);
        if (nn && nn !== name) { if (ud.subjects.includes(nn)) return send(res, 409, { error: 'subject exists' });
          ud.subjects[ud.subjects.indexOf(name)] = nn; ud.subjectMeta[nn] = meta; delete ud.subjectMeta[name];
          for (const c of [ud.sessions, ud.exams, ud.tasks]) c.forEach(x => { if (x.subject === name) x.subject = nn; }); if (ud.active?.subject === name) ud.active.subject = nn; }
        if (Array.isArray(j.order)) { const o = j.order.filter(x => ud.subjects.includes(x)); if (o.length === ud.subjects.length) ud.subjects = o; }
        save(); return send(res, 200, { subjects: ud.subjects, subjectMeta: ud.subjectMeta });
      }
      if (p === '/api/activities' && M === 'POST') { ensureActivity(ud, str(j.name, 60)); save(); return send(res, 200, ud.activities); }
      if (p === '/api/activities' && M === 'DELETE') { ud.activities = ud.activities.filter(a => a !== j.name); save(); return send(res, 200, ud.activities); }
      // ---- planning ----
      if (p === '/api/plan' && M === 'POST') { if (!isDateKey(j.date)) return send(res, 400, { error: 'date required' });
        if (j.minutes === null || j.minutes === '') delete ud.plan[j.date]; else ud.plan[j.date] = Math.round(numIn(j.minutes, 0, 1440)); save(); return send(res, 200, ud.plan); }
      const r1 = crud(ud, 'exams', p, M, j, cleanExam, res); if (r1 !== false) return r1;
      // ---- MCAT practice exams ----
      if (p === '/api/practice' || p.startsWith('/api/practice/')) ud.practice ||= [];
      const r3 = p.startsWith('/api/practice') && p !== '/api/practice-goal' ? crud(ud, 'practice', p, M, j, MCAT.cleanPractice, res) : false; if (r3 !== false) return r3;
      if (p === '/api/practice-goal' && M === 'POST') { ud.settings.mcatGoal = MCAT.cleanGoal(j.goal); save(); return send(res, 200, { goal: ud.settings.mcatGoal }); }
      const r2 = crud(ud, 'tasks', p, M, j, cleanTask, res); if (r2 !== false) return r2;
      // ---- settings ----
      if (p === '/api/settings' && M === 'POST') {
        const s = ud.settings; (ud.flags ||= {}).tinker = 1;
        if (j.dailyGoalMin !== undefined) { s.dailyGoalMin = s.goals.dailyMin = Math.round(numIn(j.dailyGoalMin, 0, 1440)); }
        if (j.goals) { const g = j.goals;
          for (const k of ['dailyMin', 'weeklyMin', 'monthlyMin', 'termMin']) if (g[k] !== undefined) s.goals[k] = Math.round(numIn(g[k] || 0, 0, k === 'dailyMin' ? 1440 : 1e6));
          if (g.weekendDailyMin !== undefined) s.goals.weekendDailyMin = g.weekendDailyMin === null || g.weekendDailyMin === '' ? null : Math.round(numIn(g.weekendDailyMin, 0, 1440));
          s.dailyGoalMin = s.goals.dailyMin; }
        if (j.term) { for (const k of ['start', 'end']) if (j.term[k] !== undefined) { if (j.term[k] && !isDateKey(j.term[k])) return send(res, 400, { error: 'term dates must be YYYY-MM-DD' }); s.term[k] = j.term[k] || ''; }
          if (j.term.name !== undefined) s.term.name = str(j.term.name, 60); }
        if (j.medals) for (const k of ['bronze', 'silver', 'gold', 'platinum']) if (j.medals[k] !== undefined) s.medals[k] = Math.round(numIn(j.medals[k], 0, 1440));
        if (j.pomodoro) { const pm = j.pomodoro; for (const [k, lo, hi] of [['focusMin', 1, 240], ['shortMin', 1, 60], ['longMin', 1, 120], ['cycles', 1, 12]]) if (pm[k] !== undefined) s.pomodoro[k] = Math.round(numIn(pm[k], lo, hi));
          if (pm.autoStart !== undefined) s.pomodoro.autoStart = !!pm.autoStart; }
        if (j.dayStartHour !== undefined) s.dayStartHour = Math.round(numIn(j.dayStartHour, 0, 6));
        if (Array.isArray(j.quickDurations)) s.quickDurations = j.quickDurations.slice(0, 6).map(x => Math.round(numIn(x, 1, 600)));
        if (j.accent !== undefined) { if (j.accent && !COLOR.test(j.accent)) return send(res, 400, { error: 'accent must be #rrggbb' }); s.accent = j.accent || ''; }
        if (j.background !== undefined) { if (!j.background || typeof j.background !== 'object' || Array.isArray(j.background)) return send(res, 400, { error: 'background must be an object' });
          try { s.background = mix.cleanBackground(j.background, s.background); } catch (e) { return send(res, 400, { error: e.message }); } }
        if (j.busyIp !== undefined) s.busyIp = String(j.busyIp).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').slice(0, 100);
        if (j.busyToken !== undefined && j.busyToken !== '********') s.busyToken = String(j.busyToken).trim().slice(0, 300);
        save(); return send(res, 200, { ok: true });
      }
      if (p === '/api/busybar/test' && M === 'POST') return send(res, 200, { ok: await busy(ud, 'MCAT tracker test') });

      // ---- bug reports (any user submits; only admins review) ----
      if (p === '/api/reports' && M === 'POST') {
        const rk = 'r:' + user.id; if (reportLimiter.blocked(rk)) return send(res, 429, { error: 'Too many reports. Try again later.' });
        const r = reports.validateReport(j); reportLimiter.fail(rk);
        const rep = { id: store.db.nextReportId++, uid: user.id, username: user.username, ...r, status: 'pending', adminNote: '', created: new Date().toISOString(), reviewedAt: null };
        store.db.reports.push(rep); save(); return send(res, 200, reports.publicView(rep));
      }
      if (p === '/api/reports' && M === 'GET') return send(res, 200, store.db.reports.filter(r => r.uid === user.id).map(reports.publicView));
      if (p.startsWith('/api/admin/')) {
        if (!user.admin) return send(res, 403, { error: 'Admin only' });
        if (p === '/api/admin/config' && M === 'GET') return send(res, 200, store.db.config);
        if (p === '/api/admin/config' && M === 'POST') { if (j.openRegistration !== undefined) store.db.config.openRegistration = !!j.openRegistration; save(); return send(res, 200, store.db.config); }
        if (p === '/api/admin/users' && M === 'GET') return send(res, 200, store.db.users.map(x => { const b = bstat(x); return { ...publicUser(x), created: x.created, billing: b.enabled ? { exempt: b.exempt || null, comp: !!(x.billing && x.billing.comp), subscribed: !!b.subscribed, lifetime: !!b.lifetime, trialDaysLeft: b.trialDaysLeft ?? null, readOnly: !!b.readOnly } : null }; }));
        { const dm = /^\/api\/admin\/users\/(\d+)\/delete$/.exec(p); if (dm && M === 'POST') { const x = store.userById(+dm[1]); if (!x) return send(res, 404, { error: 'not found' });
          if (x.id === user.id || x.admin) return send(res, 403, { error: 'Admin accounts cannot be deleted here.' });
          if (String(j.confirm || '') !== x.username) return send(res, 400, { error: 'Type the username to confirm.' });
          try { await deleteAccount(x); } catch (e) { return deleteFailed(res, e); }
          return send(res, 200, { ok: true }); } }
        { const cm = /^\/api\/admin\/users\/(\d+)\/comp$/.exec(p); if (cm && M === 'POST') { const x = store.userById(+cm[1]); if (!x) return send(res, 404, { error: 'not found' });
          x.billing ||= {}; x.billing.comp = !!j.comp; store.save(); return send(res, 200, { ok: true, comp: x.billing.comp }); } }
        if (p === '/api/admin/stats' && M === 'GET') { // aggregate counts only, no personal data
          const now = Date.now(), DAYMS = 864e5, dk = t => new Date(t).toISOString().slice(0, 10), us = store.db.users, ago = t => (now - (Date.parse(t) || 0)) / DAYMS;
          const days = 90, series = []; for (let i = days - 1; i >= 0; i--) series.push([dk(now - i * DAYMS), 0]);
          const idx = new Map(series.map((x, i) => [x[0], i])); for (const x of us) { const i = idx.get(x.created ? dk(Date.parse(x.created) || 0) : ''); if (i !== undefined) series[i][1]++; }
          const today = dk(now), subs = { trialing: 0, monthly: 0, yearly: 0, lifetime: 0, otherPaid: 0, comped: 0, legacy: 0, admin: 0, expired: 0, billingOff: 0 };
          const act = { d1: 0, d7: 0, d30: 0 }; let sessions = 0, studySec = 0, studied = 0;
          for (const x of us) { const b = bstat(x);
            if (!b.enabled) subs.billingOff++; else if (b.exempt === 'admin') subs.admin++; else if (b.exempt === 'comp') subs.comped++; else if (b.exempt === 'legacy') subs.legacy++;
            else if (b.lifetime) subs.lifetime++; // paid: one-time purchase
            else if (b.subscribed) { const pl = b.subscription && b.subscription.plan; subs[pl === 'yearly' ? 'yearly' : pl === 'monthly' ? 'monthly' : 'otherPaid']++; } else if (b.trial) subs.trialing++; else subs.expired++;
            const ss = (store.db.userData[x.id] && store.db.userData[x.id].sessions) || []; let last = 0;
            for (const s of ss) { const e = Date.parse(s.end || s.start) || 0; if (e > last) last = e; studySec += Math.max(0, ((Date.parse(s.end) || 0) - (Date.parse(s.start) || 0)) / 1000 - (s.breakSec || 0)); }
            sessions += ss.length; if (ss.length) studied++;
            if (last) { const a = (now - last) / DAYMS; if (a <= 1) act.d1++; if (a <= 7) act.d7++; if (a <= 30) act.d30++; } }
          const signedIn = new Set(Object.values(store.db.tokens || {}).filter(t => t.exp > now).map(t => t.uid)).size;
          return send(res, 200, { generated: new Date(now).toISOString(), total: us.length, newToday: us.filter(x => x.created && dk(Date.parse(x.created) || 0) === today).length,
            new7: us.filter(x => ago(x.created) <= 7).length, new30: us.filter(x => ago(x.created) <= 30).length, activeStudy: act, signedIn, studied, sessions, studyHours: Math.round(studySec / 360) / 10,
            baseline: us.filter(x => !x.created || (Date.parse(x.created) || 0) < Date.parse(series[0][0])).length, subscriptions: subs, registrationOpen: !!store.db.config.openRegistration, signups: series });
        }
        if (p === '/api/admin/reports' && M === 'GET') { const st = u.searchParams.get('status'); return send(res, 200, store.db.reports.filter(r => !st || r.status === st)); }
        m = /^\/api\/admin\/reports\/(\d+)$/.exec(p);
        if (m && M === 'PUT') {
          const rep = store.db.reports.find(r => r.id === +m[1]); if (!rep) return send(res, 404, { error: 'not found' });
          if (j.title !== undefined || j.description !== undefined || j.steps !== undefined) Object.assign(rep, reports.validateReport({ ...rep, ...rep.meta, ...j }), { meta: rep.meta });
          if (j.adminNote !== undefined) rep.adminNote = reports.clean(j.adminNote, reports.LIMITS.adminNote);
          if (j.status !== undefined) { if (!reports.STATUSES.includes(j.status)) return send(res, 400, { error: 'bad status' }); rep.status = j.status; rep.reviewedAt = j.status === 'pending' ? null : new Date().toISOString(); }
          if (rep.status === 'approved') reports.writeApproved(reportsDir, rep); else reports.removeApproved(reportsDir, rep.id);
          save(); return send(res, 200, rep);
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 400, { error: String(e.message || e) }); }
  });
  server.store = store;
  return server;
}

module.exports = { createApp };
if (require.main === module) {
  const port = +process.env.PORT || 3000, app = createApp();
  app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(new Date().toISOString(), 'StudyHertz on :' + port));
  setTimeout(() => INDEXNOW.onDeploy().catch(() => {}), 15000).unref();
}
