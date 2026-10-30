'use strict';
// StudyHertz affiliate program: applications, attribution (60-day last-click cookie), commissions from Stripe payments,
// 30-day hold, refund reversal, and monthly Stripe Connect (Express) payouts. Zero dependencies (node:sqlite + fetch).
// SAFETY: Connect calls (accounts, links, transfers) only run with a Stripe TEST key unless AFFILIATE_PAYOUTS_LIVE=1.
const crypto = require('crypto');
const DAY = 864e5, COOKIE_DAYS = 60, HOLD_DAYS = 30, MIN_PAYOUT = 2500, DEFAULT_RATE = 20, DEFAULT_MONTHS = 12;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS affiliates (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, code TEXT UNIQUE, name TEXT, email TEXT, website TEXT, audience TEXT,
  status TEXT NOT NULL DEFAULT 'pending', rate REAL NOT NULL DEFAULT ${DEFAULT_RATE}, months INTEGER NOT NULL DEFAULT ${DEFAULT_MONTHS}, ip_hash TEXT,
  connect_account TEXT, connect_mode TEXT, payouts_enabled INTEGER DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, note TEXT, created TEXT, decided TEXT);
CREATE TABLE IF NOT EXISTS aff_clicks (aff_id INTEGER NOT NULL, ip_hash TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (aff_id, ip_hash, day));
CREATE TABLE IF NOT EXISTS aff_referrals (user_id INTEGER PRIMARY KEY, aff_id INTEGER NOT NULL, at TEXT NOT NULL, until TEXT NOT NULL, ip_hash TEXT);
CREATE TABLE IF NOT EXISTS aff_commissions (id INTEGER PRIMARY KEY AUTOINCREMENT, aff_id INTEGER NOT NULL, user_id INTEGER NOT NULL, source TEXT NOT NULL UNIQUE, payment_intent TEXT,
  kind TEXT, amount INTEGER NOT NULL, rate REAL NOT NULL, commission INTEGER NOT NULL, reversed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created TEXT NOT NULL, payable_at TEXT NOT NULL, payout_id INTEGER, livemode INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS aff_comm_aff ON aff_commissions (aff_id, status);
CREATE TABLE IF NOT EXISTS aff_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, aff_id INTEGER NOT NULL, amount INTEGER NOT NULL, netted INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, transfer_id TEXT, mode TEXT, error TEXT, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aff_meta (k TEXT PRIMARY KEY, v TEXT);`;

const testKey = k => /^(sk|rk)_test_/.test(String(k || ''));
const liveKey = k => /^(sk|rk)_live_/.test(String(k || ''));
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i.test(e);
const validCode = c => /^[A-Z0-9]{4,16}$/.test(String(c || ''));

function create(db, opts = {}) {
  db.exec(SCHEMA);
  const now = opts.now || (() => Date.now()), iso = t => new Date(t).toISOString();
  const secret = opts.secret || 'sh-aff', hashIp = ip => crypto.createHmac('sha256', secret).update(String(ip || '')).digest('base64url').slice(0, 22);
  const q = (sql, ...a) => db.prepare(sql).all(...a), one = (sql, ...a) => db.prepare(sql).get(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
  const env = opts.env || process.env;
  const connectKey = () => opts.connectKey !== undefined ? opts.connectKey : (env.AFFILIATE_STRIPE_KEY || '');
  const payoutsLive = () => (opts.payoutsLive !== undefined ? opts.payoutsLive : env.AFFILIATE_PAYOUTS_LIVE === '1');
  // Connect is usable with a test key, or with a live key only when AFFILIATE_PAYOUTS_LIVE=1
  const connectMode = () => { const k = connectKey(); if (testKey(k)) return 'test'; if (liveKey(k) && payoutsLive()) return 'live'; return null; };
  const fetchFn = opts.fetch || globalThis.fetch;
  async function stripe(method, path, params, idem) {
    const mode = connectMode(); if (!mode) throw new Error('Affiliate payouts are not enabled');
    const body = params ? new URLSearchParams(flat(params)).toString() : undefined;
    const r = await fetchFn('https://api.stripe.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + connectKey(), 'Content-Type': 'application/x-www-form-urlencoded', ...(idem ? { 'Idempotency-Key': idem } : {}) }, body });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe request failed'); return j;
  }
  const flat = (o, pre = '', out = {}) => { for (const [k, v] of Object.entries(o)) { if (v == null) continue; const key = pre ? `${pre}[${k}]` : k; if (typeof v === 'object') flat(v, key, out); else out[key] = String(v); } return out; };

  const get = id => one('SELECT * FROM affiliates WHERE id = ?', id) || null;
  const byUser = uid => one('SELECT * FROM affiliates WHERE user_id = ? ORDER BY id DESC LIMIT 1', uid) || null;
  const byCode = code => validCode(String(code || '').toUpperCase()) ? one("SELECT * FROM affiliates WHERE code = ? AND status = 'approved'", String(code).toUpperCase()) || null : null;
  function newCode() { for (;;) { const c = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7); if (c.length === 7 && !one('SELECT 1 FROM affiliates WHERE code = ?', c)) return c; } }

  function apply(user, j, ip) {
    const name = str(j.name, 80), email = str(j.email, 200).toLowerCase(), website = str(j.website, 300), audience = str(j.audience, 1000);
    if (!name || !validEmail(email) || !website || !audience) throw Object.assign(new Error('Please fill in name, a valid email, website/channel and audience'), { status: 400 });
    const ex = byUser(user.id); if (ex && ex.status !== 'rejected') throw Object.assign(new Error(ex.status === 'approved' ? 'You are already an affiliate' : 'Your application is already under review'), { status: 409 });
    const r = run('INSERT INTO affiliates (user_id, name, email, website, audience, status, ip_hash, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', user.id, name, email, website, audience, 'pending', hashIp(ip), iso(now()));
    return get(r.lastInsertRowid);
  }
  function decide(id, j) {
    const a = get(id); if (!a) throw Object.assign(new Error('not found'), { status: 404 });
    if (j.status !== undefined) { if (!['approved', 'rejected', 'suspended', 'pending'].includes(j.status)) throw Object.assign(new Error('bad status'), { status: 400 });
      run('UPDATE affiliates SET status = ?, decided = ?, code = COALESCE(code, ?) WHERE id = ?', j.status, iso(now()), j.status === 'approved' ? newCode() : null, id); }
    if (j.rate !== undefined) { const r = Number(j.rate); if (!(r >= 0 && r <= 90)) throw Object.assign(new Error('rate must be 0-90 %'), { status: 400 }); run('UPDATE affiliates SET rate = ? WHERE id = ?', Math.round(r * 100) / 100, id); }
    if (j.months !== undefined) { const m = Math.round(Number(j.months)); if (!(m >= 1 && m <= 120)) throw Object.assign(new Error('months must be 1-120'), { status: 400 });
      run('UPDATE affiliates SET months = ? WHERE id = ?', m, id); // existing referrals follow the new duration
      for (const r of q('SELECT user_id, at FROM aff_referrals WHERE aff_id = ?', id)) run('UPDATE aff_referrals SET until = ? WHERE user_id = ?', addMonths(r.at, m), r.user_id); }
    if (j.note !== undefined) run('UPDATE affiliates SET note = ? WHERE id = ?', str(j.note, 500), id);
    return get(id);
  }
  const addMonths = (at, m) => { const d = new Date(at); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString(); };

  // ---- tracking ----
  function click(code, ip) {
    const a = byCode(code); if (!a) return null; const day = iso(now()).slice(0, 10), h = hashIp(ip);
    if (run('INSERT OR IGNORE INTO aff_clicks (aff_id, ip_hash, day) VALUES (?, ?, ?)', a.id, h, day).changes) run('UPDATE affiliates SET clicks = clicks + 1 WHERE id = ?', a.id); // one click per IP per day
    return { code: a.code, cookie: `sh_aff=${a.code}.${now()}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}` };
  }
  const parseCookie = v => { const m = /^([A-Z0-9]{4,16})\.(\d{10,14})$/.exec(String(v || '')); return m && now() - Number(m[2]) <= COOKIE_DAYS * DAY && Number(m[2]) <= now() ? { code: m[1], ts: Number(m[2]) } : null; };
  // Called right after a NEW account is created. Returns the affiliate row when attributed (then referral codes are ignored).
  function attribute(user, cookieVal, ip, emails = new Set()) {
    const c = parseCookie(cookieVal); if (!c) return null; const a = byCode(c.code); if (!a) return null;
    if (a.user_id === user.id) return null; // self
    if (emails.has(String(a.email).toLowerCase())) return null; // same email as the affiliate application
    if (opts.emailsOfUser && a.user_id) { const own = opts.emailsOfUser(a.user_id); for (const e of emails) if (own.has(e)) return null; }
    const h = hashIp(ip); if (h === a.ip_hash) return null; // signing up from the affiliate's own network
    const recent = one('SELECT COUNT(*) n FROM aff_referrals WHERE aff_id = ? AND ip_hash = ? AND at > ?', a.id, h, iso(now() - DAY)).n; if (recent >= 3) return null; // burst of accounts from one IP
    if (one('SELECT 1 FROM aff_referrals WHERE user_id = ?', user.id)) return null;
    const at = iso(now()); run('INSERT INTO aff_referrals (user_id, aff_id, at, until, ip_hash) VALUES (?, ?, ?, ?, ?)', user.id, a.id, at, addMonths(at, a.months), h);
    return a;
  }
  const referralOf = uid => one('SELECT r.*, a.code FROM aff_referrals r JOIN affiliates a ON a.id = r.aff_id WHERE r.user_id = ?', uid) || null;

  // ---- commissions ----
  // amount: cents actually paid (after discounts). source: invoice id or checkout session id (unique, so webhook retries never double count)
  function commission({ uid, source, amount, paymentIntent, kind, livemode }) {
    const r = referralOf(uid); if (!r || !source || !(amount > 0)) return null;
    const a = get(r.aff_id); if (!a || a.status !== 'approved' || a.user_id === uid) return null;
    const t = now(); if (t > new Date(r.until).getTime()) return null; // outside the commission window
    const c = Math.floor(amount * a.rate / 100); if (c <= 0) return null;
    const res = run('INSERT OR IGNORE INTO aff_commissions (aff_id, user_id, source, payment_intent, kind, amount, rate, commission, status, created, payable_at, livemode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      a.id, uid, source, paymentIntent || null, kind || 'invoice', amount, a.rate, c, 'pending', iso(t), iso(t + HOLD_DAYS * DAY), livemode ? 1 : 0);
    return res.changes ? one('SELECT * FROM aff_commissions WHERE source = ?', source) : null;
  }
  // refunds reverse proportionally (amountRefunded is cumulative, as on a Stripe charge)
  function refund({ paymentIntent, source, amountRefunded, amountTotal }) {
    const c = (source && one('SELECT * FROM aff_commissions WHERE source = ?', source)) || (paymentIntent && one('SELECT * FROM aff_commissions WHERE payment_intent = ?', paymentIntent)); if (!c) return null;
    const total = amountTotal || c.amount, rev = Math.min(c.commission, Math.ceil(c.commission * Math.min(amountRefunded, total) / total));
    run('UPDATE aff_commissions SET reversed = MAX(reversed, ?), status = CASE WHEN ? >= commission AND status != \'paid\' THEN \'reversed\' ELSE status END WHERE id = ?', rev, rev, c.id);
    return one('SELECT * FROM aff_commissions WHERE id = ?', c.id);
  }
  function mature() { run("UPDATE aff_commissions SET status = 'payable' WHERE status = 'pending' AND payable_at <= ?", iso(now())); }
  function summary(affId) {
    mature(); const s = (w, ...a) => one(`SELECT COALESCE(SUM(commission - reversed), 0) v FROM aff_commissions WHERE aff_id = ? AND ${w}`, affId, ...a).v;
    const a = get(affId); const paidOut = one("SELECT COALESCE(SUM(amount), 0) v FROM aff_payouts WHERE aff_id = ? AND status = 'paid'", affId).v;
    // negative balance from refunds after a payout is carried and netted against later payables
    const clawback = one("SELECT COALESCE(SUM(reversed), 0) v FROM aff_commissions WHERE aff_id = ? AND status = 'paid'", affId).v
      - one("SELECT COALESCE(SUM(netted), 0) v FROM aff_payouts WHERE aff_id = ? AND status = 'paid'", affId).v, gross = s("status = 'payable'");
    return { clicks: a ? a.clicks : 0, signups: one('SELECT COUNT(*) n FROM aff_referrals WHERE aff_id = ?', affId).n,
      paying: one('SELECT COUNT(DISTINCT user_id) n FROM aff_commissions WHERE aff_id = ? AND commission > reversed', affId).n,
      earned: s("status != 'reversed'"), pending: s("status = 'pending'"), payable: Math.max(0, gross - clawback), gross, clawback: Math.max(0, clawback), paid: paidOut, currency: 'usd' };
  }

  // ---- Connect Express ----
  async function onboard(affId, base) {
    const a = get(affId); if (!a || a.status !== 'approved') throw Object.assign(new Error('Affiliate not approved'), { status: 403 });
    const mode = connectMode(); if (!mode) throw Object.assign(new Error('Payout setup is not available yet'), { status: 503 });
    let acct = a.connect_mode === mode ? a.connect_account : null;
    if (!acct) { const ac = await stripe('POST', '/accounts', { type: 'express', country: 'US', email: a.email, capabilities: { transfers: { requested: true } }, business_type: 'individual', metadata: { affiliate_id: a.id } }, 'aff-acct-' + a.id + '-' + mode);
      acct = ac.id; run('UPDATE affiliates SET connect_account = ?, connect_mode = ? WHERE id = ?', acct, mode, a.id); }
    const link = await stripe('POST', '/account_links', { account: acct, refresh_url: base + '/?affiliate=refresh', return_url: base + '/?affiliate=connected', type: 'account_onboarding' });
    return { url: link.url, mode };
  }
  async function syncAccount(affId) {
    const a = get(affId); if (!a || !a.connect_account || a.connect_mode !== connectMode()) return a;
    const ac = await stripe('GET', '/accounts/' + a.connect_account); const ok = !!(ac.payouts_enabled && ac.capabilities && ac.capabilities.transfers === 'active');
    run('UPDATE affiliates SET payouts_enabled = ? WHERE id = ?', ok ? 1 : 0, a.id); return get(affId);
  }
  // Monthly: transfer each approved, onboarded affiliate's payable balance when it is at least $25.
  async function runPayouts({ force = false } = {}) {
    const mode = connectMode(); if (!mode) return { skipped: 'payouts disabled' };
    const month = iso(now()).slice(0, 7), last = (one("SELECT v FROM aff_meta WHERE k = 'payout_month'") || {}).v;
    if (!force && last === month) return { skipped: 'already ran ' + month };
    run("INSERT OR REPLACE INTO aff_meta (k, v) VALUES ('payout_month', ?)", month); mature(); const out = [];
    for (const a of q("SELECT * FROM affiliates WHERE status = 'approved' AND connect_account IS NOT NULL AND connect_mode = ?", mode)) {
      let cur = a; try { cur = await syncAccount(a.id); } catch { /* keep last known */ }
      if (!cur.payouts_enabled) continue; const s = summary(a.id); if (s.payable < MIN_PAYOUT) continue;
      const rows = q("SELECT id FROM aff_commissions WHERE aff_id = ? AND status = 'payable'", a.id);
      const p = run('INSERT INTO aff_payouts (aff_id, amount, netted, status, mode, created) VALUES (?, ?, ?, ?, ?, ?)', a.id, s.payable, s.gross - s.payable, 'processing', mode, iso(now())).lastInsertRowid;
      try { const tr = await stripe('POST', '/transfers', { amount: s.payable, currency: 'usd', destination: a.connect_account, description: 'StudyHertz affiliate commission ' + month, metadata: { affiliate_id: a.id, payout_id: p } }, 'aff-payout-' + p);
        run("UPDATE aff_payouts SET status = 'paid', transfer_id = ? WHERE id = ?", tr.id, p);
        for (const r of rows) run("UPDATE aff_commissions SET status = 'paid', payout_id = ? WHERE id = ?", p, r.id);
        out.push({ aff: a.id, amount: s.payable, transfer: tr.id }); }
      catch (e) { run("UPDATE aff_payouts SET status = 'failed', error = ? WHERE id = ?", str(e.message, 300), p); out.push({ aff: a.id, error: e.message }); }
    }
    return { mode, month, payouts: out };
  }
  const list = () => q('SELECT * FROM affiliates ORDER BY id DESC').map(a => ({ ...a, ip_hash: undefined, stats: summary(a.id) }));
  const publicView = a => a && { id: a.id, status: a.status, code: a.status === 'approved' ? a.code : null, rate: a.rate, months: a.months, name: a.name, website: a.website,
    connect: { ready: !!a.payouts_enabled, started: !!a.connect_account, available: !!connectMode() }, created: a.created };
  return { apply, decide, click, attribute, referralOf, commission, refund, summary, onboard, syncAccount, runPayouts, list, get, byUser, byCode, publicView, connectMode, parseCookie, MIN_PAYOUT, HOLD_DAYS, COOKIE_DAYS };
}
module.exports = { create, testKey, liveKey, DEFAULT_RATE, DEFAULT_MONTHS };
