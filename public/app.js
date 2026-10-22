'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PALETTE = ['#6c8cff', '#f59f00', '#3ecf8e', '#e64980', '#22b8cf', '#ae3ec9', '#fd7e14', '#94d82d', '#868e96', '#f03e3e'];
const pad = n => String(n).padStart(2, '0');
const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dur = s => (new Date(s.end) - new Date(s.start)) / 1000;
const fmtH = s => { s = Math.round(s / 60); const h = Math.floor(s / 60), m = s % 60; return h ? `${h}h ${pad(m)}m` : `${m}m`; };
const fmtClock = s => `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s % 60))}`;
const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let ME = null, S = null, ST = null, sel = localStorage.subject || null, authMode = 'login';

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/password')) { showAuth(); throw new Error('Not logged in'); }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
const color = name => { const i = S ? S.subjects.indexOf(name) : -1; if (i >= 0) return PALETTE[i % PALETTE.length]; let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) | 0; return PALETTE[Math.abs(h) % PALETTE.length]; };

// ---------- auth ----------
async function boot() {
  const me = await api('/api/me');
  if (!me.user) { authMode = me.needsSetup ? 'setup' : 'login'; showAuth(me); return; }
  ME = me.user; $('auth').classList.add('hid'); $('app').classList.remove('hid');
  $('whoami').textContent = `Signed in as ${ME.username}${ME.admin ? ' (admin)' : ''}`;
  $('adminCard').classList.toggle('hid', !ME.admin);
  await load(); if (ME.admin) loadAdmin();
}
async function showAuth(me) {
  me = me || await api('/api/me');
  $('app').classList.add('hid'); $('auth').classList.remove('hid');
  if (me.needsSetup) authMode = 'setup';
  const reg = authMode !== 'login';
  $('authMsg').textContent = authMode === 'setup' ? 'Create the admin account to get started' : reg ? 'Create an account' : 'Sign in to continue';
  $('aSubmit').textContent = reg ? 'Create account' : 'Sign in';
  $('aPass').autocomplete = reg ? 'new-password' : 'current-password';
  $('aToggle').classList.toggle('hid', authMode === 'setup' || (!reg && !me.registrationOpen));
  $('aToggle').textContent = reg ? 'Have an account? Sign in' : 'New here? Create an account';
  $('aErr').textContent = '';
}
$('aToggle').onclick = e => { e.preventDefault(); authMode = authMode === 'login' ? 'register' : 'login'; showAuth(); };
$('authForm').onsubmit = async e => {
  e.preventDefault(); $('aErr').textContent = '';
  try { await api(authMode === 'login' ? '/api/login' : '/api/register', 'POST', { username: $('aUser').value.trim(), password: $('aPass').value }); $('aPass').value = ''; boot(); }
  catch (err) { $('aErr').textContent = err.message; }
};
$('logoutBtn').onclick = async () => { await api('/api/logout', 'POST'); ME = null; authMode = 'login'; showAuth(); };
$('themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = localStorage.theme = t; };

// ---------- nav ----------
let view = 'timer';
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => {
  view = b.dataset.v; document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hid', v.id !== 'v-' + view)); render();
});

// ---------- data ----------
async function load() { [S, ST] = await Promise.all([api('/api/state'), api('/api/stats')]); if (!S.subjects.includes(sel)) sel = S.active?.subject || S.subjects[0]; render(); }
const live = () => { const a = S?.active; return a ? a.accum + (a.paused ? 0 : (Date.now() - new Date(a.start)) / 1000) : 0; };

function render() {
  if (!S) return;
  renderTimer();
  if (view === 'dash') renderDash();
  if (view === 'hist') renderHist();
  if (view === 'set') renderSettings();
}
function statCards(el, items) { el.innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join(''); }
function setRing(el, r, pct) { const c = 2 * Math.PI * r; el.style.strokeDasharray = c; el.style.strokeDashoffset = c * (1 - Math.min(1, pct)); }

// ---------- timer ----------
function renderTimer() {
  const a = S.active, l = live(), today = ST.today + l, goal = ST.goalSec;
  if (a) sel = a.subject;
  $('subjChips').innerHTML = S.subjects.map(s => `<button class="chip ${s === sel ? 'on' : ''}" style="--c:${color(s)}" data-s="${esc(s)}"><span class="dot" style="background:${color(s)}"></span>${esc(s)}</button>`).join('');
  $('subjChips').querySelectorAll('.chip').forEach(c => c.onclick = () => { if (S.active && !S.active.paused) return toast('Stop or pause the timer to switch subjects'); sel = localStorage.subject = c.dataset.s; if (S.active) S.active.subject = sel; renderTimer(); });
  $('tSubLbl').textContent = a ? (a.paused ? 'Paused · ' : '') + a.subject : sel || 'Pick a subject';
  $('tGoalLbl').textContent = goal ? `${fmtH(today)} of ${fmtH(goal)} today` : `${fmtH(today)} today`;
  if (a && document.activeElement !== $('tNote')) $('tNote').value = a.note || '';
  $('bStart').classList.toggle('hid', !!a && !a.paused); $('bStart').textContent = a?.paused ? 'Resume' : 'Start';
  $('bPause').classList.toggle('hid', !a || a.paused); $('bStop').classList.toggle('hid', !a);
  document.querySelector('.timer-wrap').className = 'timer-wrap' + (a ? (a.paused ? ' paused' : ' running') : '');
  tick();
  statCards($('miniStats'), [[fmtH(today), 'Today'], [fmtH(ST.week + l), 'This week'], [ST.streak + (ST.streak === 1 ? ' day' : ' days'), 'Streak'], [Math.round(ST.goalPct) + '%', 'Daily goal']]);
  const tk = dayKey(new Date()), todays = S.sessions.filter(s => dayKey(s.start) === tk).sort((x, y) => y.start.localeCompare(x.start));
  $('todayList').innerHTML = todays.map(itemHTML).join('') || '<p class="muted small">No sessions yet today. Start the timer!</p>';
}
function tick() { if (!S) return; const l = live(); $('clock').textContent = fmtClock(l); const g = ST.goalSec; setRing($('tRing'), 88, g ? (ST.today + l) / g : 0); }
setInterval(() => { tick(); if (S?.active && !S.active.paused && Math.floor(live()) % 60 === 0) renderTimer(); }, 1000);
$('bStart').onclick = async () => { await api('/api/timer/start', 'POST', { subject: sel, note: $('tNote').value }); await load(); };
$('bPause').onclick = async () => { await api('/api/timer/pause', 'POST'); await load(); };
$('bStop').onclick = async () => {
  const r = await api('/api/timer/stop', 'POST', { note: $('tNote').value, subject: sel }); $('tNote').value = '';
  toast(r.session ? `Saved ${fmtH(dur(r.session))} of ${r.session.subject}` : 'Too short to save (<30s)'); await load();
};

// ---------- dashboard ----------
function renderDash() {
  const l = live();
  statCards($('dashStats'), [[fmtH(ST.today + l), 'Today'], [fmtH(ST.week + l), 'This week'], [fmtH(ST.month + l), 'This month'], [`${ST.streak}d <small class="muted">best ${ST.bestStreak}d</small>`, 'Streak']]);
  const pct = ST.goalSec ? (ST.today + l) / ST.goalSec : 0;
  setRing($('gRing'), 80, pct); $('gPct').textContent = Math.round(pct * 100) + '%'; $('gSub').textContent = `${fmtH(ST.today + l)} / ${fmtH(ST.goalSec)}`;
  const ms = Object.entries(ST.bySubject.month).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...ms.map(x => x[1]));
  $('subjBars').innerHTML = ms.map(([k, v]) => `<div class="sbar"><div class="row"><span><span class="dot" style="background:${color(k)}"></span> ${esc(k)}</span><b>${fmtH(v)}</b></div><div class="bar"><i style="width:${(v / mx) * 100}%;background:${color(k)}"></i></div></div>`).join('') || '<p class="muted small">No study time this month yet.</p>';
  renderStack(); renderHeat();
}
function renderStack() {
  const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13 + i); return d; });
  const subs = new Set(); days.forEach(d => Object.keys(ST.byDaySubject[dayKey(d)] || {}).forEach(s => subs.add(s)));
  const order = [...S.subjects.filter(s => subs.has(s)), ...[...subs].filter(s => !S.subjects.includes(s))];
  const tot = d => Object.values(ST.byDaySubject[dayKey(d)] || {}).reduce((a, b) => a + b, 0);
  const max = Math.max(ST.goalSec, 3600, ...days.map(tot)), W = 700, H = 200, top = 10, bot = 22, bw = W / 14;
  let out = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  days.forEach((d, i) => {
    let y = H - bot; const x = i * bw + bw * 0.18, w = bw * 0.64;
    for (const s of order) { const v = (ST.byDaySubject[dayKey(d)] || {})[s]; if (!v) continue; const h = (v / max) * (H - top - bot); y -= h; out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color(s)}"><title>${esc(s)}: ${fmtH(v)}</title></rect>`; }
    out += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${d.toLocaleDateString([], { weekday: 'narrow' })}${d.getDate()}</text>`;
  });
  if (ST.goalSec) { const gy = H - bot - (ST.goalSec / max) * (H - top - bot); out += `<line x1="0" x2="${W}" y1="${gy}" y2="${gy}" stroke="var(--muted)" stroke-dasharray="4 4"/>`; }
  $('stack').innerHTML = out + '</svg>';
  $('legend').innerHTML = order.map(s => `<span><i class="dot" style="background:${color(s)}"></i>${esc(s)}</span>`).join('') + (ST.goalSec ? '<span>- - daily goal</span>' : '');
}
function renderHeat() {
  const c = 12, g = 3, end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - 52 * 7 - ((end.getDay() + 6) % 7));
  const weeks = Math.ceil(((end - start) / 864e5 + 1) / 7), goal = ST.goalSec || 4 * 3600;
  let out = `<svg width="${30 + weeks * (c + g)}" height="${20 + 7 * (c + g)}">`, lastM = -1;
  ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((t, i) => t && (out += `<text x="0" y="${20 + i * (c + g) + 9}">${t}</text>`));
  for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
    const w = Math.floor(i / 7), r = (d.getDay() + 6) % 7, v = ST.byDay[dayKey(d)] || 0;
    const lv = v <= 0 ? 0 : v < goal * 0.25 ? 1 : v < goal * 0.5 ? 2 : v < goal ? 3 : 4;
    if (r === 0 && d.getMonth() !== lastM) { lastM = d.getMonth(); out += `<text x="${30 + w * (c + g)}" y="10">${d.toLocaleDateString([], { month: 'short' })}</text>`; }
    out += `<rect class="l${lv}" x="${30 + w * (c + g)}" y="${20 + r * (c + g)}" width="${c}" height="${c}" rx="2"><title>${d.toDateString()}: ${fmtH(v)}</title></rect>`;
  }
  $('heat').innerHTML = out + '</svg>';
  $('heat').parentElement.scrollLeft = 1e5;
}

// ---------- history ----------
function itemHTML(s) {
  return `<div class="item" data-id="${s.id}"><span class="dot" style="background:${color(s.subject)}"></span><div class="grow"><div>${esc(s.subject)}</div><div class="n">${fmtTime(s.start)}–${fmtTime(s.end)}${s.note ? ' · ' + esc(s.note) : ''}</div></div><div class="t">${fmtH(dur(s))}</div></div>`;
}
function renderHist() {
  const fs = $('fSubj'), cur = fs.value; fs.innerHTML = '<option value="">All subjects</option>' + S.subjects.map(s => `<option>${esc(s)}</option>`).join(''); fs.value = cur;
  const f = fs.value, from = $('fFrom').value, to = $('fTo').value, q = $('fText').value.toLowerCase();
  const list = S.sessions.filter(s => (!f || s.subject === f) && (!from || dayKey(s.start) >= from) && (!to || dayKey(s.start) <= to) && (!q || (s.note || '').toLowerCase().includes(q) || s.subject.toLowerCase().includes(q)))
    .sort((a, b) => b.start.localeCompare(a.start));
  $('histSum').textContent = `${list.length} sessions · ${fmtH(list.reduce((a, s) => a + dur(s), 0))}`;
  let html = '', last = '';
  for (const s of list.slice(0, 500)) {
    const k = dayKey(s.start);
    if (k !== last) { last = k; const tot = list.filter(x => dayKey(x.start) === k).reduce((a, x) => a + dur(x), 0); html += `<div class="day"><span>${new Date(s.start).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</span><span>${fmtH(tot)}</span></div>`; }
    html += itemHTML(s);
  }
  $('histList').innerHTML = html || '<p class="muted">No sessions match.</p>';
  $('histList').querySelectorAll('.item').forEach(el => el.onclick = () => openEdit(S.sessions.find(s => s.id === +el.dataset.id)));
}
['fSubj', 'fFrom', 'fTo', 'fText'].forEach(id => $(id).oninput = renderHist);
$('bAdd').onclick = () => openEdit(null);
function openEdit(s) {
  $('eSubj').innerHTML = S.subjects.map(x => `<option>${esc(x)}</option>`).join('');
  const st = s ? new Date(s.start) : new Date(Date.now() - 3600e3), en = s ? new Date(s.end) : new Date();
  $('dlgTitle').textContent = s ? 'Edit session' : 'Add session';
  $('eSubj').value = s ? s.subject : sel; $('eDate').value = dayKey(st); $('eStart').value = st.toTimeString().slice(0, 5); $('eEnd').value = en.toTimeString().slice(0, 5); $('eNote').value = s?.note || '';
  $('eDel').classList.toggle('hid', !s);
  const dlg = $('dlg');
  dlg.onclose = async () => {
    try {
      if (dlg.returnValue === 'del' && s) { if (confirm('Delete this session?')) { await api('/api/sessions/' + s.id, 'DELETE'); toast('Deleted'); } }
      else if (dlg.returnValue === 'save') {
        const a = new Date($('eDate').value + 'T' + $('eStart').value), b = new Date($('eDate').value + 'T' + $('eEnd').value);
        if (b <= a) b.setDate(b.getDate() + 1);
        const body = { subject: $('eSubj').value, note: $('eNote').value, start: a.toISOString(), end: b.toISOString() };
        await api(s ? '/api/sessions/' + s.id : '/api/sessions', s ? 'PUT' : 'POST', body); toast('Saved');
      } else return;
      await load();
    } catch (e) { toast(e.message); }
  };
  dlg.returnValue = ''; dlg.showModal();
}

// ---------- import ----------
$('bImp').onclick = async () => {
  const f = $('file').files[0]; if (!f) return toast('Choose a CSV file first');
  const map = {}; ['date', 'start', 'end', 'duration', 'subject', 'note'].forEach(k => { const v = $('m_' + k).value.trim(); if (v) map[k] = v; });
  try { const r = await api('/api/import', 'POST', { csv: await f.text(), map }); $('impRes').textContent = `Imported ${r.added} sessions, skipped ${r.skipped}.\nDetected columns: ${JSON.stringify(r.columns, null, 1)}`; await load(); }
  catch (e) { $('impRes').textContent = 'Import failed: ' + e.message; }
};

// ---------- settings ----------
function renderSettings() {
  if (document.activeElement !== $('sGoal')) $('sGoal').value = S.settings.dailyGoalMin / 60;
  if (document.activeElement !== $('sBip')) $('sBip').value = S.settings.busyIp;
  if (document.activeElement !== $('sBtok')) $('sBtok').value = S.settings.busyToken;
  $('subjList').innerHTML = S.subjects.map(s => `<div class="subj-row"><i class="dot" style="background:${color(s)}"></i><span>${esc(s)}</span><button class="icon" data-s="${esc(s)}" title="Remove">✕</button></div>`).join('');
  $('subjList').querySelectorAll('button').forEach(b => b.onclick = async () => { if (confirm(`Remove "${b.dataset.s}"? Past sessions are kept.`)) { await api('/api/subjects', 'DELETE', { name: b.dataset.s }); load(); } });
}
$('bGoal').onclick = async () => { await api('/api/settings', 'POST', { dailyGoalMin: Math.round(+$('sGoal').value * 60) }); toast('Goal saved'); load(); };
$('bAddSubj').onclick = async () => { const n = $('newSubj').value.trim(); if (!n) return; await api('/api/subjects', 'POST', { name: n }); $('newSubj').value = ''; load(); };
$('bBusy').onclick = async () => { await api('/api/settings', 'POST', { busyIp: $('sBip').value, busyToken: $('sBtok').value }); toast('Busy Bar settings saved'); load(); };
$('bBusyTest').onclick = async () => { const r = await api('/api/busybar/test', 'POST'); $('busyMsg').textContent = r.ok ? 'Sent! Check your Busy Bar.' : 'Could not reach the Busy Bar (check IP/token).'; };
$('bPass').onclick = async () => { try { await api('/api/password', 'POST', { current: $('pCur').value, password: $('pNew').value }); $('pCur').value = $('pNew').value = ''; $('passMsg').textContent = 'Password updated. Other devices were signed out.'; } catch (e) { $('passMsg').textContent = e.message; } };
async function loadAdmin() {
  const [cfg, users] = await Promise.all([api('/api/admin/config'), api('/api/admin/users')]);
  $('openReg').checked = !!cfg.openRegistration;
  $('userList').innerHTML = users.map(u => `<div class="subj-row"><span>${esc(u.username)}${u.admin ? ' <small class="muted">admin</small>' : ''}</span><small class="muted">${new Date(u.created).toLocaleDateString()}</small></div>`).join('');
}
$('openReg').onchange = async e => { await api('/api/admin/config', 'POST', { openRegistration: e.target.checked }); toast(e.target.checked ? 'Registration open' : 'Registration closed'); };

setInterval(() => { if (ME && !document.hidden) load().catch(() => {}); }, 60000);
document.addEventListener('visibilitychange', () => { if (ME && !document.hidden) load().catch(() => {}); });
boot().catch(e => { document.body.innerHTML = '<p style="padding:20px">Failed to load: ' + esc(e.message) + '</p>'; });
