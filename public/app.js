'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const DAY = 864e5;
const dk = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayKey = d => dk(+new Date(d) - (S ? +S.settings.dayStartHour || 0 : 0) * 3600e3);
const k2d = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addD = (d, n) => { d = new Date(d); d.setDate(d.getDate() + n); return d; };
const dur = s => Math.max(0, (new Date(s.end) - new Date(s.start)) / 1000 - (+s.breakSec || 0));
const fmtH = s => { s = Math.round((s || 0) / 60); const h = Math.floor(s / 60), m = s % 60; return h ? `${h}h ${pad(m)}m` : `${m}m`; };
const fmtClock = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const fmtTime = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d, o = { month: 'short', day: 'numeric' }) => new Date(d).toLocaleDateString([], o);
const daysUntil = k => Math.round((k2d(k) - k2d(dk(new Date()))) / DAY);
const MEDAL_ORDER = ['platinum', 'gold', 'silver', 'bronze'];
const medalOf = sec => { const t = S.settings.medals || {}; for (const m of MEDAL_ORDER) if (t[m] && sec >= t[m] * 60) return m; return null; };

const BRAND = 'Study Tracker';
const TITLES = { timer: 'Timer', dash: 'Dashboard', sess: 'Sessions', cal: 'Calendar', stats: 'Stats', plan: 'Exams & To-dos', trophy: 'Trophies', data: 'Import / Export', set: 'Settings', admin: 'Bug reports' };
document.querySelectorAll('[data-brand]').forEach(e => (e.textContent = BRAND)); document.title = BRAND;
let landingDone = false;
let ME = null, S = null, ST = null, view = localStorage.view || 'timer', sel = localStorage.subject || null, authMode = 'login';
const UI = { mode: localStorage.timerMode || 'stopwatch', target: +localStorage.countdownMin || 25, pomo: JSON.parse(localStorage.pomo || 'null'), selected: new Set(), layout: localStorage.sessLayout || 'list',
  range: localStorage.statsRange || '30d', calMonth: dk(new Date()).slice(0, 7), taskView: 'inbox', wiz: { step: 1 } };

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/password')) { showAuth(); throw new Error('Not logged in'); }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg, action, fn) {
  const t = $('toast'); $('toastMsg').textContent = msg; $('toastAct').textContent = action || ''; $('toastAct').classList.toggle('hid', !action);
  $('toastAct').onclick = async () => { t.classList.remove('show'); if (fn) await fn(); };
  t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2400);
}
const color = name => (S && S.subjectMeta[name] && S.subjectMeta[name].color) || '#868e96';
const opt = (list, cur, blank) => (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') + list.map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
const ring = (r, pct, cls = '') => { const c = 2 * Math.PI * r; return `<circle cx="100" cy="100" r="${r}" class="ring-bg"/><circle cx="100" cy="100" r="${r}" class="ring-fg ${cls}" style="stroke-dasharray:${c};stroke-dashoffset:${c * (1 - Math.min(1, Math.max(0, pct)))}"/>`; };
const statCards = items => `<div class="grid4">${items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;

// ---------- notifications, sound, wake lock ----------
function beep(times = 2) { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); for (let i = 0; i < times; i++) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); const t = ctx.currentTime + i * 0.35; g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.start(t); o.stop(t + 0.3); } } catch { /* no audio */ } }
async function notify(title, body) {
  beep(); if (!('Notification' in window) || Notification.permission !== 'granted') return toast(title + (body ? ' — ' + body : ''));
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) return reg.showNotification(title, { body, icon: '/icon-192.png' }); new Notification(title, { body, icon: '/icon-192.png' }); } catch { toast(title); }
}
let wakeLock = null;
async function keepAwake(on) { try { if (on && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch { /* unsupported */ } }
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- auth ----------
async function boot() {
  const me = await api('/api/me');
  if (!me.user) { authMode = me.needsSetup ? 'setup' : 'login'; showAuth(me); return; }
  ME = me.user; $('auth').classList.add('hid'); $('landing').classList.add('hid'); $('app').classList.remove('hid');
  await load(); go(view);
  if (localStorage.onboard === '1') { localStorage.onboard = ''; onboarding(); }
}
async function showAuth(me) {
  me = me || await api('/api/me');
  $('app').classList.add('hid');
  const showLanding = !landingDone && !me.needsSetup; $('landing').classList.toggle('hid', !showLanding); $('auth').classList.toggle('hid', showLanding); $('aBack').classList.toggle('hid', !!me.needsSetup);
  if (me.needsSetup) authMode = 'setup';
  const reg = authMode !== 'login';
  $('authMsg').textContent = authMode === 'setup' ? 'Create the admin account to get started' : reg ? 'Create an account' : 'Sign in to continue';
  $('aSubmit').textContent = reg ? 'Create account' : 'Sign in'; $('aPass').autocomplete = reg ? 'new-password' : 'current-password';
  $('aToggle').classList.toggle('hid', authMode === 'setup' || (!reg && !me.registrationOpen));
  $('aToggle').textContent = reg ? 'Have an account? Sign in' : 'New here? Create an account'; $('aErr').textContent = '';
}
document.querySelectorAll('[data-auth]').forEach(b => b.onclick = () => { landingDone = true; authMode = b.dataset.auth; showAuth(); setTimeout(() => $('aUser').focus(), 50); });
$('aBack').onclick = () => { landingDone = false; authMode = 'login'; showAuth(); };
$('aToggle').onclick = e => { e.preventDefault(); authMode = authMode === 'login' ? 'register' : 'login'; showAuth(); };
$('authForm').onsubmit = async e => {
  e.preventDefault(); $('aErr').textContent = '';
  try { const r = await api(authMode === 'login' ? '/api/login' : '/api/register', 'POST', { username: $('aUser').value.trim(), password: $('aPass').value }); $('aPass').value = ''; if (r.onboarding) localStorage.onboard = '1'; boot(); }
  catch (err) { $('aErr').textContent = err.message; }
};
$('logoutBtn').onclick = async () => { await api('/api/logout', 'POST'); ME = null; authMode = 'login'; landingDone = false; showAuth(); };
$('themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = localStorage.theme = t; };
function applyAccent() { const a = S?.settings.accent, st = document.documentElement.style; if (a) { st.setProperty('--acc', a); st.setProperty('--acc2', a); } else { st.removeProperty('--acc'); st.removeProperty('--acc2'); } }

// ---------- nav & data ----------
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.v));
function go(v) { view = localStorage.view = v; document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x.dataset.v === v)); render(); window.scrollTo(0, 0); }
async function load() { [S, ST] = await Promise.all([api('/api/state'), api('/api/stats' + (sel ? '?subject=' + encodeURIComponent(sel) : ''))]); if (!S.subjects.includes(sel)) sel = S.active?.subject || S.subjects[0]; applyAccent(); }
async function refresh() { await load(); render(); }
const live = () => { const a = S?.active; return a ? a.accum + (a.paused ? 0 : (Date.now() - new Date(a.start)) / 1000) : 0; };
const VIEWS = {}, AFTER = {}, ACT = {};
async function render() { if (!S) return; const html = await VIEWS[view](); const m = $('main'); m.innerHTML = (TITLES[view] ? `<h1 class="large-title">${esc(TITLES[view])}</h1>` : '') + html; m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter'); AFTER[view]?.(); }
$('main').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && ACT[b.dataset.act]) { if (b.type !== 'checkbox') e.preventDefault(); Promise.resolve(ACT[b.dataset.act](b, e)).catch(err => toast(err.message)); } });
$('main').addEventListener('change', e => { const b = e.target.closest('[data-chg]'); if (b && ACT[b.dataset.chg]) Promise.resolve(ACT[b.dataset.chg](b, e)).catch(err => toast(err.message)); });
$('main').addEventListener('input', e => { const b = e.target.closest('[data-inp]'); if (b && ACT[b.dataset.inp]) ACT[b.dataset.inp](b, e); });

// ---------- dialog helper ----------
function dialog(html, onSubmit) {
  const d = $('dlg'), f = $('dlgForm'); f.innerHTML = html; d.returnValue = '';
  f.onclick = e => { const b = e.target.closest('[data-dact]'); if (b && dialog.acts[b.dataset.dact]) dialog.acts[b.dataset.dact](b, e); };
  d.onclose = async () => { if (d.returnValue && d.returnValue !== 'cancel') { try { await onSubmit(d.returnValue, f); } catch (e) { toast(e.message); } } };
  d.showModal();
}
dialog.acts = {};
const stars = (name, v) => `<div class="stars">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-dact="star" data-v="${i}" class="${v >= i ? 'on' : ''}">★</button>`).join('')}<input type="hidden" name="${name}" value="${v || ''}"></div>`;
dialog.acts.star = b => { const w = b.parentElement, v = +b.dataset.v, cur = +w.querySelector('input').value, nv = cur === v ? '' : v; w.querySelector('input').value = nv; w.querySelectorAll('button').forEach(x => x.classList.toggle('on', !!nv && +x.dataset.v <= nv)); };

// ================= TIMER =================
VIEWS.timer = () => {
  const a = S.active, mode = a ? a.mode || 'stopwatch' : UI.mode, p = UI.pomo;
  const sug = ST.suggestion ? `<button class="link small" data-act="useSuggestion">Suggested: ${fmtH(ST.suggestion)}</button>` : '';
  const ctrl = !a ? (p?.phase === 'break' ? `<button class="btn primary xl" data-act="skipBreak">Skip break</button><button class="btn xl" data-act="endPomo">End</button>` : `<button class="btn primary xl" data-act="start">Start</button>`)
    : a.paused ? `<button class="btn primary xl" data-act="resume">Resume</button><button class="btn xl danger" data-act="stop">Stop</button>`
    : `<button class="btn xl" data-act="pause">Pause</button><button class="btn xl danger" data-act="stop">Stop</button>`;
  return `<div class="timer-wrap ${a ? (a.paused ? 'paused' : 'running') : p?.phase === 'break' ? 'paused' : ''}" id="tw">
    <div class="tabs mode-tabs ${a ? 'gone' : ''} ${UI.wasActive !== undefined && UI.wasActive !== !!a ? (a ? 'anim-out' : 'anim-in') : ''}" style="width:min(420px,100%)" ${a ? 'aria-hidden="true" inert' : ''}>${['stopwatch', 'pomodoro', 'countdown'].map(m => `<button data-act="mode" data-m="${m}" class="${mode === m ? 'on' : ''}" ${a ? 'tabindex="-1"' : ''}>${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>${(UI.wasActive = !!a, '')}
    <div class="ring-box"><svg viewBox="0 0 200 200" class="ring" id="tRingSvg"></svg>
      <div class="ring-center"><div class="phase" id="tPhase"></div><div class="clock" id="clock">0:00:00</div><div class="muted" id="tSubLbl"></div><div class="muted small" id="tGoalLbl"></div></div></div>
    ${mode === 'countdown' && !a ? `<div class="row wrap gap" style="justify-content:center">${S.settings.quickDurations.map(m => `<button class="chip ${UI.target === m ? 'on' : ''}" style="--c:var(--acc)" data-act="target" data-m="${m}">${m} min</button>`).join('')}<input type="number" min="1" max="600" value="${UI.target}" style="width:90px" data-chg="targetInp"> ${sug}</div>` : ''}
    ${mode === 'pomodoro' && !a ? `<div class="muted small">${S.settings.pomodoro.focusMin}m focus · ${S.settings.pomodoro.shortMin}m break · ${S.settings.pomodoro.longMin}m long break every ${S.settings.pomodoro.cycles} · <a href="#" class="link" data-act="goto" data-v="set">change</a></div>` : ''}
    <div class="chips">${S.subjects.map(s => `<button class="chip ${s === sel ? 'on' : ''}" style="--c:${color(s)}" data-act="pick" data-s="${esc(s)}"><span class="dot" style="background:${color(s)}"></span>${esc(s)}</button>`).join('')}</div>
    <div class="row gap" style="width:min(520px,100%)"><select id="tAct">${opt(S.activities, a?.activity ?? localStorage.activity ?? '', 'Activity (optional)')}</select><input id="tNote" placeholder="Note (optional)" value="${esc(a?.note || '')}"></div>
    <div class="ctrl">${ctrl}<button class="btn xl" data-act="fullscreen" title="Fullscreen focus (F)">⛶</button></div>
  </div>
  ${statCards([[fmtH(ST.today + live()), 'Today'], [fmtH(ST.week + live()), 'This week'], [ST.streak + (ST.streak === 1 ? ' day' : ' days'), 'Streak'], [Math.round(Math.min(100, ST.goalSec ? (ST.today + live()) / ST.goalSec * 100 : 0)) + '%', 'Daily goal']])}
  <div class="card"><h3>Today</h3><div class="list">${todayItems() || '<p class="muted small">No sessions yet today. Start the timer!</p>'}</div></div>`;
};
const todayItems = () => S.sessions.filter(s => dayKey(s.start) === ST.todayKey).sort((x, y) => y.start.localeCompare(x.start)).map(s => itemHTML(s)).join('');
AFTER.timer = () => tick();
function tick() {
  if (!S || view !== 'timer' || !$('clock')) return;
  const a = S.active, l = live(), p = UI.pomo, today = ST.today + l;
  let shown = l, pct = ST.goalSec ? today / ST.goalSec : 0, phase = '';
  if (a?.targetSec) { shown = a.targetSec - l; pct = l / a.targetSec; phase = a.mode === 'pomodoro' ? `Focus ${p ? p.cycle : 1}/${S.settings.pomodoro.cycles}` : 'Countdown';
    if (l >= a.targetSec && !a.paused && !tick.busy) { tick.busy = true; finishTarget().catch(e => toast(e.message)).finally(() => (tick.busy = false)); } }
  else if (!a && p?.phase === 'break') { const left = (p.until - Date.now()) / 1000; shown = left; pct = 1 - left / p.len; phase = p.long ? 'Long break' : 'Break';
    if (left <= 0 && !tick.busy) { tick.busy = true; breakOver().catch(e => toast(e.message)).finally(() => (tick.busy = false)); } }
  else if (!a && UI.mode === 'countdown') shown = UI.target * 60;
  else if (!a && UI.mode === 'pomodoro') shown = S.settings.pomodoro.focusMin * 60;
  $('clock').textContent = fmtClock(shown); $('tPhase').textContent = phase; $('tRingSvg').innerHTML = ring(88, pct);
  $('tSubLbl').textContent = a ? (a.paused ? 'Paused · ' : '') + a.subject + (a.activity ? ' · ' + a.activity : '') : sel || 'Pick a subject';
  $('tGoalLbl').textContent = ST.goalSec ? `${fmtH(today)} of ${fmtH(ST.goalSec)} today` : `${fmtH(today)} today`;
  document.title = a && !a.paused ? `${fmtClock(shown)} · ${a.subject}` : 'MCAT Tracker';
}
setInterval(() => { tick(); checkReminder(); }, 1000);
ACT.mode = b => { UI.mode = localStorage.timerMode = b.dataset.m; render(); };
ACT.target = b => { UI.target = +b.dataset.m; localStorage.countdownMin = UI.target; render(); };
ACT.targetInp = b => { UI.target = Math.max(1, +b.value || 25); localStorage.countdownMin = UI.target; tick(); };
ACT.useSuggestion = () => { UI.target = Math.round(ST.suggestion / 60); localStorage.countdownMin = UI.target; render(); };
ACT.goto = b => go(b.dataset.v);
ACT.pick = async b => { if (S.active && !S.active.paused) return toast('Pause or stop the timer to switch subjects'); sel = localStorage.subject = b.dataset.s; if (S.active) S.active.subject = sel; ST = await api('/api/stats?subject=' + encodeURIComponent(sel)); render(); };
const tFields = () => ({ subject: sel, activity: $('tAct')?.value || '', note: $('tNote')?.value || '' });
const savePomo = () => (localStorage.pomo = JSON.stringify(UI.pomo));
ACT.start = async () => {
  const f = tFields(), mode = UI.mode, body = { ...f, mode }; localStorage.activity = f.activity;
  if (mode === 'countdown') body.targetSec = UI.target * 60;
  if (mode === 'pomodoro') { body.targetSec = S.settings.pomodoro.focusMin * 60; UI.pomo = { cycle: (UI.pomo?.cycle || 0) % S.settings.pomodoro.cycles + 1, phase: 'focus' }; savePomo(); }
  await api('/api/timer/start', 'POST', body); keepAwake(true); await refresh();
};
ACT.pause = async () => { await api('/api/timer/pause', 'POST'); await refresh(); };
ACT.resume = async () => { await api('/api/timer/start', 'POST', {}); await refresh(); };
ACT.stop = async () => { const f = tFields(), a = S.active; if (!a) return;
  const secs = (a.accum || 0) + (a.paused ? 0 : (Date.now() - new Date(a.start)) / 1000), short = secs < 30;
  const finish = async () => { UI.pomo = null; savePomo(); keepAwake(false); exitFs(); };
  dialog(`<h3>Save this session?</h3><p class="muted">${esc(sel || a.subject || '')} \u00b7 ${fmtH(secs)}${short ? ' \u00b7 under 30 seconds, too short to save' : ''}</p>
    ${short ? '' : `<div class="row"><div><label>Focus</label>${stars('focus', null)}</div><div><label>Progress</label>${stars('progress', null)}</div></div>`}
    <div class="row wrap"><button class="btn danger" value="discard">Discard</button><span class="sp"></span><button class="btn" value="cancel">Keep going</button>${short ? '' : '<button class="btn primary" value="save">Save</button>'}</div>`,
  async (v, fm) => {
    if (v === 'discard') { if (!confirm('Discard this session? It will not be saved.')) return; await api('/api/timer/discard', 'POST', {}); await finish(); await refresh(); return toast('Session discarded'); }
    const r = await api('/api/timer/stop', 'POST', { note: f.note, activity: f.activity, subject: sel, focus: +fm.focus.value || null, progress: +fm.progress.value || null });
    await finish(); await refresh(); checkAchievements(); if (r.session) toast(`Saved ${fmtH(dur(r.session))} of ${r.session.subject}`); });
};
async function afterSave(s) { await refresh(); checkAchievements(); if (!s) return toast('Too short to save (<30s)'); toast(`Saved ${fmtH(dur(s))} of ${s.subject}`, 'Rate it', () => rateSession(s)); }
function rateSession(s) {
  dialog(`<h3>How did it go?</h3><label>Focus</label>${stars('focus', s.focus)}<label>Progress</label>${stars('progress', s.progress)}
    <div class="row"><span class="sp"></span><button class="btn" value="cancel">Skip</button><button class="btn primary" value="save">Save</button></div>`,
  async (_, f) => { await api('/api/sessions/' + s.id, 'PUT', { focus: +f.focus.value || null, progress: +f.progress.value || null }); refresh(); });
}
async function finishTarget() {
  const a = S.active, f = tFields(); const r = await api('/api/timer/stop', 'POST', { note: f.note, activity: f.activity, subject: a.subject });
  if (a.mode === 'pomodoro') {
    const pc = S.settings.pomodoro, long = (UI.pomo?.cycle || 1) >= pc.cycles, len = (long ? pc.longMin : pc.shortMin) * 60;
    UI.pomo = { cycle: long ? 0 : UI.pomo?.cycle || 1, phase: 'break', long, len, until: Date.now() + len * 1000 }; savePomo();
    notify('Focus block done 🍅', `Take a ${len / 60} minute break.`);
  } else { keepAwake(false); notify('Countdown finished', r.session ? `${a.subject} · ${fmtH(dur(r.session))} saved` : a.subject); }
  await refresh(); checkAchievements();
}
async function breakOver() {
  notify('Break over', 'Ready for the next focus block?');
  if (S.settings.pomodoro.autoStart) { UI.pomo.phase = 'ready'; UI.mode = 'pomodoro'; await ACT.start(); } else { UI.pomo = { cycle: UI.pomo.cycle, phase: 'ready' }; savePomo(); render(); }
}
ACT.skipBreak = () => { UI.pomo.until = Date.now(); };
ACT.endPomo = () => { UI.pomo = null; savePomo(); keepAwake(false); render(); };
ACT.fullscreen = () => { const tw = $('tw'); if (tw.classList.contains('fs')) return exitFs(); tw.classList.add('fs'); tw.requestFullscreen?.().catch(() => {}); keepAwake(true);
  if (!tw.querySelector('.fs-exit')) tw.insertAdjacentHTML('beforeend', '<button class="btn fs-exit" data-act="exitFs" style="position:absolute;top:16px;right:16px;z-index:30">Exit</button>'); tw.querySelector('.fs-exit').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); exitFs(); }); };
ACT.exitFs = () => exitFs();
function exitFs() { $('tw')?.classList.remove('fs'); $('tw')?.querySelector('.fs-exit')?.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { $('tw')?.classList.remove('fs'); $('tw')?.querySelector('.fs-exit')?.remove(); } });
document.addEventListener('keydown', e => { if (view !== 'timer' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $('dlg').open) return;
  if (e.code === 'Space') { e.preventDefault(); (S.active ? (S.active.paused ? ACT.resume : ACT.pause) : ACT.start)().catch(x => toast(x.message)); }
  if (e.key === 'f' && !$('tw')?.classList.contains('fs')) ACT.fullscreen(); if (e.key === 'Escape') exitFs(); });

// ================= DASHBOARD =================
VIEWS.dash = () => {
  const l = live(), G = ST.goals, t = S.settings.term;
  const goalTile = (lbl, g, extra = '') => g ? `<div class="center"><div class="goal-ring"><svg viewBox="0 0 200 200" class="ring">${ring(84, g.goal ? g.done / g.goal : 0)}</svg><div class="ring-center"><b class="g-pct">${g.goal ? Math.round(g.done / g.goal * 100) : 0}%</b><span class="g-sub">${fmtH(g.done)} / ${fmtH(g.goal)}</span></div></div><b>${lbl}</b><div class="muted small">${extra}</div></div>` : '';
  const paceTxt = g => g ? (g.remainingSec <= 0 ? 'Goal reached 🎉' : `need ${fmtH(g.perDaySec)}/day for ${g.daysLeft}d · forecast ${fmtH(g.forecastSec)}${g.onTrack ? ' ✓' : ''}`) : '';
  const exams = S.exams.filter(e => daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const due = S.tasks.filter(x => !x.done && x.due && x.due <= ST.todayKey);
  const week = [...Array(7)].map((_, i) => addD(k2d(ST.todayKey), i - 6)), subjGoals = Object.entries(G.subjects || {});
  return `${statCards([[fmtH(ST.today + l), 'Today'], [fmtH(ST.week + l), 'This week'], [fmtH(ST.month + l), 'This month'], [`${ST.streak}d <small class="muted">best ${ST.bestStreak}d</small>`, 'Streak']])}
  <div class="card"><h3>Goals</h3><div class="goalgrid">${goalTile('Today', { done: G.day.done + l, goal: G.day.goal }, G.day.goal ? `${fmtH(Math.max(0, G.day.goal - G.day.done - l))} to go` : 'Set a daily goal in Settings')}
    ${goalTile('This week', G.week, paceTxt(G.week))}${goalTile('This month', G.month, paceTxt(G.month))}${goalTile(esc(t.name || 'Term'), G.term, paceTxt(G.term))}</div>
    ${!G.week && !G.month ? '<p class="muted small">Add weekly, monthly or term goals in Settings to see pace and forecasts.</p>' : ''}</div>
  <div class="grid2">
    <div class="card"><h3>Upcoming exams</h3>${exams.map(e => `<div class="subj-row"><span>${esc(e.name)} <small class="muted">${fmtDate(k2d(e.date), { weekday: 'short', month: 'short', day: 'numeric' })}</small></span><b>${daysUntil(e.date) === 0 ? 'Today' : daysUntil(e.date) + ' days'}</b></div>`).join('') || '<p class="muted small">No exams yet. <a href="#" class="link" data-act="goto" data-v="plan">Add your MCAT date</a></p>'}
      ${due.length ? `<h3 class="mt">Due to-dos</h3>${due.map(x => `<div class="subj-row"><input type="checkbox" class="chk" data-chg="taskDone" data-id="${x.id}"><span>${esc(x.title)}</span>${x.due < ST.todayKey ? '<span class="pill high">overdue</span>' : ''}</div>`).join('')}` : ''}</div>
    <div class="card"><h3>Last 7 days</h3>${(() => { const vals = week.map(d => (ST.byDay[dk(d)] || 0) + (dk(d) === ST.todayKey ? l : 0)), mx = Math.max(ST.goalSec || 0, 3600, ...vals); return `<div class="week7">${week.map((d, i) => { const v = vals[i], m = medalOf(v); return `<div class="w7-row${dk(d) === ST.todayKey ? ' today' : ''}"><span class="w7-lbl">${fmtDate(d, { weekday: 'short', day: 'numeric' })}</span><div class="w7-track">${v > 0 ? `<i style="width:max(6px,${(v / mx * 100).toFixed(1)}%)"></i>` : ''}</div><span class="w7-medal">${m ? `<span class="medal m-${m}" title="${m}"></span>` : ''}</span><b class="w7-val${v ? '' : ' muted'}">${fmtH(v)}</b></div>`; }).join('')}</div>`; })()}</div>
  </div>
  ${subjGoals.length ? `<div class="card"><h3>Weekly subject goals</h3>${subjGoals.map(([k, g]) => `<div class="sbar"><div class="row"><span><span class="dot" style="background:${color(k)}"></span> ${esc(k)}</span><b>${fmtH(g.done)} / ${fmtH(g.goal)}</b></div><div class="bar"><i style="width:${Math.min(100, g.done / g.goal * 100)}%;background:${color(k)}"></i></div></div>`).join('')}</div>` : ''}
  <div class="card"><h3>Last 14 days</h3><div class="chart">${stackChart()}</div><div class="legend">${legend()}</div></div>
  <div class="card"><h3>Study calendar</h3><div class="heat-scroll" id="heatS">${heatmap(ST.byDay)}</div>
    <div class="heat-key muted small">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More · dots = medal days</div></div>`;
};
AFTER.dash = () => { const h = $('heatS'); if (h) h.scrollLeft = 1e5; };
function stackChart() {
  const days = [...Array(14)].map((_, i) => addD(k2d(ST.todayKey), i - 13)), bd = ST.byDaySubject, subs = new Set();
  days.forEach(d => Object.keys(bd[dk(d)] || {}).forEach(s => subs.add(s)));
  const order = [...S.subjects.filter(s => subs.has(s)), ...[...subs].filter(s => !S.subjects.includes(s))];
  const tot = d => Object.values(bd[dk(d)] || {}).reduce((a, b) => a + b, 0), max = Math.max(ST.goalSec, 3600, ...days.map(tot)), W = 700, H = 200, top = 10, bot = 22, bw = W / 14;
  let out = `<div class="hcols stack">${ST.goalSec ? `<div class="goal-line" style="bottom:calc(22px + (100% - 22px) * )"></div>` : ''}`;
  days.forEach(d => { out += `<div class="hcol"><div class="hcol-bar">${order.map(s => { const v = (bd[dk(d)] || {})[s]; return v ? `<i style="height:${(v / max * 100).toFixed(2)}%;background:${color(s)}" title="${esc(s)}: ${fmtH(v)}"></i>` : ''; }).join('')}</div><span>${d.toLocaleDateString([], { weekday: 'narrow' })}${d.getDate()}</span></div>`; });
  legend.order = order; return out + '</div>';
}
const legend = () => (legend.order || []).map(s => `<span><i class="dot" style="background:${color(s)}"></i>${esc(s)}</span>`).join('') + (ST.goalSec ? '<span>- - daily goal</span>' : '');
const MEDAL_COLORS = { bronze: '#cd7f32', silver: '#c0c0c0', gold: '#f5c518', platinum: '#a6e3ff' };
function heatmap(byDay) {
  const c = 12, g = 3, end = k2d(ST.todayKey), start = addD(end, -52 * 7 - ((end.getDay() + 6) % 7)), goal = ST.goals.day.goal || 4 * 3600;
  const weeks = Math.ceil(((end - start) / DAY + 1) / 7); let out = `<svg width="${30 + weeks * (c + g)}" height="${20 + 7 * (c + g)}">`, lastM = -1;
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((t, i) => t && (out += `<text x="0" y="${20 + i * (c + g) + c / 2}" dominant-baseline="central" class="dow">${t}</text>`));
  for (let d = new Date(start), i = 0; d <= end; d = addD(d, 1), i++) {
    const w = Math.floor(i / 7), r = (d.getDay() + 6) % 7, v = byDay[dk(d)] || 0, lv = v <= 0 ? 0 : v < goal * 0.25 ? 1 : v < goal * 0.5 ? 2 : v < goal ? 3 : 4, m = medalOf(v), x = 30 + w * (c + g), y = 20 + r * (c + g);
    if (r === 0 && d.getMonth() !== lastM) { lastM = d.getMonth(); out += `<text x="${x}" y="10">${d.toLocaleDateString([], { month: 'short' })}</text>`; }
    out += `<rect class="l${lv}" x="${x}" y="${y}" width="${c}" height="${c}" rx="2"><title>${d.toDateString()}: ${fmtH(v)}${m ? ' · ' + m : ''}</title></rect>${m ? `<circle cx="${x + c / 2}" cy="${y + c / 2}" r="2.5" style="fill:${MEDAL_COLORS[m]}"/>` : ''}`;
  }
  return out + '</svg>';
}
ACT.taskDone = async b => { const id = b.dataset.id, done = b.checked; await api('/api/tasks/' + id, 'PUT', { done }); if (done) toast('Nice! Task done', 'Undo', async () => { await api('/api/tasks/' + id, 'PUT', { done: false }); refresh(); }); refresh(); };

// ================= SESSIONS =================
function itemHTML(s, selectable) {
  const m = [s.activity, s.note].filter(Boolean).map(esc).join(' · ');
  return `<div class="item ${UI.selected.has(s.id) ? 'sel' : ''}" data-act="edit" data-id="${s.id}">${selectable ? `<input type="checkbox" class="chk" data-act="selOne" data-id="${s.id}" ${UI.selected.has(s.id) ? 'checked' : ''}>` : ''}<span class="dot" style="background:${color(s.subject)}"></span>
    <div class="grow"><div>${esc(s.subject)} ${s.focus ? `<small class="muted">focus ${'★'.repeat(s.focus)}</small>` : ''}</div><div class="n">${fmtTime(s.start)}–${fmtTime(s.end)}${s.breakSec ? ` · ${fmtH(s.breakSec)} break` : ''}${m ? ' · ' + m : ''}</div></div><div class="t">${fmtH(dur(s))}</div></div>`;
}
const F = { subj: '', act: '', from: '', to: '', q: '' };
function filtered() { const q = F.q.toLowerCase();
  return S.sessions.filter(s => (!F.subj || s.subject === F.subj) && (!F.act || (s.activity || '') === F.act) && (!F.from || dayKey(s.start) >= F.from) && (!F.to || dayKey(s.start) <= F.to) && (!q || `${s.note} ${s.subject} ${s.activity}`.toLowerCase().includes(q))).sort((a, b) => b.start.localeCompare(a.start)); }
VIEWS.sess = () => `<div class="card filters" style="grid-template-columns:1fr 1fr 1fr 1fr 1.3fr">
    <select data-chg="filt" data-k="subj">${opt(S.subjects, F.subj, 'All subjects')}</select><select data-chg="filt" data-k="act">${opt(S.activities, F.act, 'All activities')}</select>
    <input type="date" value="${F.from}" data-chg="filt" data-k="from"><input type="date" value="${F.to}" data-chg="filt" data-k="to"><input placeholder="Search notes" value="${esc(F.q)}" data-inp="filtQ"></div>
  <div class="row"><span class="muted small grow" id="histSum"></span><div class="tabs"><button data-act="layout" data-l="list" class="${UI.layout === 'list' ? 'on' : ''}">List</button><button data-act="layout" data-l="table" class="${UI.layout === 'table' ? 'on' : ''}">Table</button></div>
    <button class="btn" data-act="selAll">Select all</button><button class="btn primary" data-act="add">+ Add</button></div><div id="histList"></div><div id="bulk"></div>`;
AFTER.sess = () => renderList();
function renderList() {
  const list = filtered(); $('histSum').textContent = `${list.length} sessions · ${fmtH(list.reduce((a, s) => a + dur(s), 0))}`;
  let html = '';
  if (UI.layout === 'table') html = `<div class="card scroll"><table class="tbl"><tr><th></th><th>Date</th><th>Time</th><th>Subject</th><th>Activity</th><th class="num">Duration</th><th class="num">Break</th><th>Focus</th><th>Note</th></tr>${list.slice(0, 1000).map(s => `<tr><td><input type="checkbox" class="chk" data-act="selOne" data-id="${s.id}" ${UI.selected.has(s.id) ? 'checked' : ''}></td><td class="nowrap"><a href="#" class="link" data-act="edit" data-id="${s.id}">${fmtDate(s.start, { month: 'short', day: 'numeric', year: '2-digit' })}</a></td><td class="nowrap">${fmtTime(s.start)}–${fmtTime(s.end)}</td><td><span class="dot" style="background:${color(s.subject)}"></span> ${esc(s.subject)}</td><td>${esc(s.activity)}</td><td class="num">${fmtH(dur(s))}</td><td class="num">${s.breakSec ? fmtH(s.breakSec) : ''}</td><td>${s.focus ? '★'.repeat(s.focus) : ''}</td><td>${esc(s.note)}</td></tr>`).join('')}</table></div>`;
  else { let last = ''; for (const s of list.slice(0, 500)) { const k = dayKey(s.start); if (k !== last) { last = k; const tot = list.filter(x => dayKey(x.start) === k).reduce((a, x) => a + dur(x), 0), m = medalOf(tot); html += `<div class="day"><span>${fmtDate(k2d(k), { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</span><span>${m ? `<span class="medal m-${m}"></span> ` : ''}${fmtH(tot)}</span></div>`; } html += itemHTML(s, true); } }
  $('histList').innerHTML = html || '<p class="muted">No sessions match.</p>';
  $('bulk').innerHTML = UI.selected.size ? `<div class="bulkbar"><b>${UI.selected.size} selected</b><select id="bSubj">${opt(S.subjects, '', 'Set subject…')}</select><select id="bAct">${opt(S.activities, '', 'Set activity…')}</select><button class="btn" data-act="bulkUpd">Apply</button><button class="btn danger" data-act="bulkDel">Delete</button><button class="btn" data-act="selNone">Clear</button></div>` : '';
}
ACT.filt = b => { F[b.dataset.k] = b.value; renderList(); };
ACT.filtQ = b => { F.q = b.value; renderList(); };
ACT.layout = b => { UI.layout = localStorage.sessLayout = b.dataset.l; render(); };
ACT.selOne = (b, e) => { e.stopPropagation(); const id = +b.dataset.id; UI.selected.has(id) ? UI.selected.delete(id) : UI.selected.add(id); renderList(); };
ACT.selAll = () => { filtered().forEach(s => UI.selected.add(s.id)); renderList(); };
ACT.selNone = () => { UI.selected.clear(); renderList(); };
ACT.bulkUpd = async () => { const set = {}; if ($('bSubj').value) set.subject = $('bSubj').value; if ($('bAct').value) set.activity = $('bAct').value; if (!Object.keys(set).length) return toast('Pick a subject or activity');
  const r = await api('/api/sessions/bulk', 'POST', { ids: [...UI.selected], action: 'update', set }); toast(`Updated ${r.updated}`); UI.selected.clear(); refresh(); };
ACT.bulkDel = async () => { if (!confirm(`Delete ${UI.selected.size} sessions?`)) return; const r = await api('/api/sessions/bulk', 'POST', { ids: [...UI.selected], action: 'delete' }); UI.selected.clear(); await refresh(); undoToast(`Deleted ${r.deleted} sessions`, r.removed); };
function undoToast(msg, removed) { toast(msg, 'Undo', async () => { await api('/api/sessions/bulk', 'POST', { action: 'restore', sessions: removed }); toast('Restored'); refresh(); }); }
function openAdd() {
  if (!S) return; editSession(null); const f = $('dlgForm'); if (!f.durm) return;
  const sync = () => { const e = new Date(f.date.value + 'T' + f.end.value), a = new Date(e - Math.max(1, +f.durm.value || 0) * 6e4); f.start.value = a.toTimeString().slice(0, 5); };
  f.durm.oninput = sync; f.end.oninput = sync;
  f.start.oninput = () => { const a = new Date(f.date.value + 'T' + f.start.value), b = new Date(f.date.value + 'T' + f.end.value); if (b <= a) b.setDate(b.getDate() + 1); f.durm.value = Math.round((b - a) / 6e4); };
}
ACT.add = () => openAdd();
$('addBtn').onclick = () => openAdd();
document.addEventListener('keydown', e => { if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey && ME && !$('dlg').open && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); openAdd(); } });
ACT.edit = (b, e) => { if (e.target.closest('.chk')) return; editSession(S.sessions.find(s => s.id === +b.dataset.id)); };
function editSession(s, preset = {}) {
  const st = s ? new Date(s.start) : preset.start || new Date(Date.now() - 3600e3), en = s ? new Date(s.end) : preset.end || new Date(), q = S.settings.quickDurations;
  dialog(`<h3>${s ? 'Edit session' : 'Add session'}</h3>
    <div class="row"><div><label>Subject</label><select name="subject">${opt(S.subjects, s ? s.subject : sel)}</select></div><div><label>Activity</label><select name="activity">${opt(S.activities, s ? s.activity || '' : localStorage.activity || '', '—')}</select></div></div>
    <label>Date</label><input type="date" name="date" value="${dk(st)}" required>
    <div class="row"><div><label>Start</label><input type="time" name="start" value="${st.toTimeString().slice(0, 5)}" required></div><div><label>End</label><input type="time" name="end" value="${en.toTimeString().slice(0, 5)}" required></div><div><label>Break (min)</label><input type="number" name="brk" min="0" value="${s ? Math.round((s.breakSec || 0) / 60) : 0}"></div></div>
    ${!s ? `<div class="row"><div><label>Duration (min)</label><input type="number" name="durm" min="1" value="${Math.max(1, Math.round((en - st) / 6e4))}"></div></div>` : ''}
    ${!s ? `<div class="row wrap gap small">Quick (ending now): ${q.map(m => `<button type="button" class="chip" data-dact="quick" data-m="${m}">${m}m</button>`).join('')}</div>` : ''}
    <label>Note</label><input name="note" value="${esc(s?.note || '')}">
    <div class="row"><div><label>Focus</label>${stars('focus', s?.focus)}</div><div><label>Progress</label>${stars('progress', s?.progress)}</div></div>
    <div class="row">${s ? '<button class="btn danger" value="del" formnovalidate>Delete</button>' : ''}${!s ? '<button type="button" class="link" data-dact="toTimer">Start timer instead</button>' : ''}<span class="sp"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="save">Save</button></div>`,
  async (v, f) => {
    if (v === 'del') { const r = await api('/api/sessions/' + s.id, 'DELETE'); await refresh(); return undoToast('Session deleted', [r.removed]); }
    const a = new Date(f.date.value + 'T' + f.start.value), b = new Date(f.date.value + 'T' + f.end.value); if (b <= a) b.setDate(b.getDate() + 1);
    const body = { subject: f.subject.value, activity: f.activity.value, note: f.note.value, start: a.toISOString(), end: b.toISOString(), breakSec: (+f.brk.value || 0) * 60, focus: +f.focus.value || null, progress: +f.progress.value || null };
    if (!s) localStorage.activity = body.activity; await api(s ? '/api/sessions/' + s.id : '/api/sessions', s ? 'PUT' : 'POST', body); toast('Saved'); refresh(); checkAchievements();
  });
}
dialog.acts.quick = b => { const f = $('dlgForm'), e = new Date(), st = new Date(+e - b.dataset.m * 60e3); f.date.value = dk(st); f.start.value = st.toTimeString().slice(0, 5); f.end.value = e.toTimeString().slice(0, 5); };
dialog.acts.toTimer = () => { $('dlg').close('cancel'); go('timer'); };
const _quick = dialog.acts.quick; dialog.acts.quick = b => { _quick(b); const f = $('dlgForm'); if (f.durm) f.durm.value = b.dataset.m; };

// ================= CALENDAR =================
VIEWS.cal = () => {
  const [y, m] = UI.calMonth.split('-').map(Number), first = new Date(y, m - 1, 1), start = addD(first, -((first.getDay() + 6) % 7));
  let cells = '', mTot = 0, mPlan = 0;
  for (let i = 0; i < 42; i++) { const d = addD(start, i), k = dk(d), v = ST.byDay[k] || 0, plan = S.plan[k], md = medalOf(v), ex = S.exams.filter(e => e.date === k), tk = S.tasks.filter(t => t.due === k && !t.done);
    if (d.getMonth() === m - 1) { mTot += v; mPlan += plan != null ? plan * 60 : 0; }
    const goal = plan != null ? plan * 60 : ST.goals.day.goal;
    cells += `<div class="cday ${d.getMonth() !== m - 1 ? 'out' : ''} ${k === ST.todayKey ? 'today' : ''}" data-act="calDay" data-k="${k}"><div class="row" style="margin:0;justify-content:space-between"><b>${d.getDate()}</b>${md ? `<span class="medal m-${md}"></span>` : ''}</div>
      ${v ? `<span>${fmtH(v)}</span>` : ''}${plan != null ? `<span class="muted tx">plan ${fmtH(plan * 60)}</span>` : ''}${ex.map(e => `<span class="ex tx">📝 ${esc(e.name)}</span>`).join('')}${tk.length ? `<span class="muted tx">☐ ${tk.length} to-do</span>` : ''}
      ${goal ? `<div class="bar"><i style="width:${Math.min(100, v / goal * 100)}%;background:var(--acc)"></i></div>` : ''}</div>`; }
  return `<div class="card"><div class="row" style="margin:0 0 12px"><button class="btn" data-act="calNav" data-d="-1">‹</button><h3 class="grow center" style="margin:0">${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h3><button class="btn" data-act="calNav" data-d="0">Today</button><button class="btn" data-act="calNav" data-d="1">›</button></div>
    <div class="calgrid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="dow">${x}</div>`).join('')}${cells}</div>
    <p class="muted small mt">Studied ${fmtH(mTot)} this month${mPlan ? ` · planned ${fmtH(mPlan)}` : ''}. Click a day to plan study time, review sessions or log a past session.</p></div>`;
};
ACT.calNav = b => { const d = +b.dataset.d; if (!d) UI.calMonth = dk(new Date()).slice(0, 7); else { const [y, m] = UI.calMonth.split('-').map(Number); UI.calMonth = dk(new Date(y, m - 1 + d, 1)).slice(0, 7); } render(); };
ACT.calDay = b => { const k = b.dataset.k, list = S.sessions.filter(s => dayKey(s.start) === k).sort((a, c) => a.start.localeCompare(c.start));
  dialog(`<h3>${fmtDate(k2d(k), { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
    <label>Planned study time (hours), overrides the daily goal for this day</label><input type="number" name="plan" min="0" max="24" step="0.25" value="${S.plan[k] != null ? S.plan[k] / 60 : ''}" placeholder="default ${fmtH(ST.goals.day.goal)}">
    <div class="list mt">${list.map(s => itemHTML(s)).join('') || '<p class="muted small">No sessions.</p>'}</div>
    ${S.exams.filter(e => e.date === k).map(e => `<p>📝 <b>${esc(e.name)}</b></p>`).join('')}
    <div class="row"><button class="btn" value="addPast">+ Add session</button><span class="sp"></span><button class="btn" value="cancel">Close</button><button class="btn primary" value="save">Save plan</button></div>`,
  async (v, f) => { if (v === 'addPast') { const d = k2d(k); d.setHours(9); return editSession(null, { start: d, end: new Date(+d + 3600e3) }); }
    await api('/api/plan', 'POST', { date: k, minutes: f.plan.value === '' ? null : Math.round(+f.plan.value * 60) }); refresh(); }); };

// ================= STATS / DATA ROOM =================
function rangeDates(r) { const t = k2d(ST.todayKey), term = S.settings.term;
  switch (r) { case '7d': return [dk(addD(t, -6)), ST.todayKey]; case '30d': return [dk(addD(t, -29)), ST.todayKey]; case 'week': { const m = addD(t, -((t.getDay() + 6) % 7)); return [dk(m), dk(addD(m, 6))]; }
    case 'month': return [dk(new Date(t.getFullYear(), t.getMonth(), 1)), dk(new Date(t.getFullYear(), t.getMonth() + 1, 0))]; case 'term': return term.start && term.end ? [term.start, term.end] : [dk(addD(t, -89)), ST.todayKey];
    case 'year': return [dk(addD(t, -364)), ST.todayKey]; case 'custom': return [UI.cFrom || dk(addD(t, -29)), UI.cTo || ST.todayKey]; default: return [null, null]; } }
const bars = (obj, total, colFn) => { const e = Object.entries(obj).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...e.map(x => x[1]));
  return e.map(([k, v]) => `<div class="sbar"><div class="row"><span>${esc(k)}</span><b>${fmtH(v)} <small class="muted">${total ? Math.round(v / total * 100) : 0}%</small></b></div><div class="bar"><i style="width:${v / mx * 100}%;background:${colFn(k)}"></i></div></div>`).join('') || '<p class="muted small">No data</p>'; };
const colChart = (arr, labels) => { const mx = Math.max(1, ...arr); return `<div class="hcols">${arr.map((v, i) => `<div class="hcol" title="${labels[i] || i}: ${fmtH(v)}"><div class="hcol-bar">${v > 0 ? `<i style="height:max(3px,${(v / mx * 100).toFixed(2)}%);background:var(--acc)"></i>` : ''}</div><span>${labels[i]}</span></div>`).join('')}</div>`; };
function donut(by, total) { if (!total) return ''; let a0 = 0;
  return `<svg viewBox="-1.1 -1.1 2.2 2.2" style="width:160px;height:160px;transform:rotate(-90deg)">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => { const a1 = a0 + v / total * Math.PI * 2 - 1e-6, L = a1 - a0 > Math.PI ? 1 : 0;
    const p = `M ${Math.cos(a0)} ${Math.sin(a0)} A 1 1 0 ${L} 1 ${Math.cos(a1)} ${Math.sin(a1)} L ${Math.cos(a1) * 0.6} ${Math.sin(a1) * 0.6} A 0.6 0.6 0 ${L} 0 ${Math.cos(a0) * 0.6} ${Math.sin(a0) * 0.6} Z`; a0 = a1 + 1e-6; return `<path d="${p}" fill="${color(k)}"><title>${esc(k)}: ${fmtH(v)}</title></path>`; }).join('')}</svg>`; }
VIEWS.stats = async () => {
  const [from, to] = rangeDates(UI.range), qs = new URLSearchParams(); if (from) qs.set('from', from); if (to) qs.set('to', to); if (UI.sSubj) qs.set('subject', UI.sSubj);
  const R = await api('/api/report?' + qs), c = R.current, chg = R.change, cum = R.cumulative, cMax = Math.max(1, ...cum.map(x => x[1]));
  const subjects = Object.keys(c.bySubject), acts = Object.keys(c.matrix.activitySubject), weeks = [...new Set(Object.values(c.matrix.subjectWeek).flatMap(Object.keys))].sort().slice(-12);
  const cell = v => v ? `<td class="num" style="background:color-mix(in srgb,var(--acc) ${Math.round(Math.min(70, v / Math.max(1, c.total) * 300))}%,transparent)">${fmtH(v)}</td>` : '<td class="num muted">–</td>';
  const range = c.from ? `${fmtDate(k2d(c.from), { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDate(k2d(c.to), { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No data yet';
  return `<div class="card"><div class="row wrap gap" style="margin:0"><div class="tabs grow">${[['7d', '7 days'], ['week', 'Week'], ['30d', '30 days'], ['month', 'Month'], ['term', 'Term'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']].map(([k, l]) => `<button data-act="range" data-r="${k}" class="${UI.range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <select data-chg="sSubj" style="width:auto">${opt(S.subjects, UI.sSubj || '', 'All subjects')}</select></div>
    ${UI.range === 'custom' ? `<div class="row"><input type="date" value="${from}" data-chg="cRange" data-k="cFrom"><input type="date" value="${to}" data-chg="cRange" data-k="cTo"></div>` : ''}
    <p class="muted small" style="margin:8px 0 0">${range}${R.previous ? ` · previous period: ${fmtH(R.previous.total)} ${chg == null ? '' : `<b style="color:${chg >= 0 ? 'var(--ok)' : 'var(--danger)'}">${chg >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(chg * 100))}%</b>`}` : ''}</p></div>
  ${statCards([[fmtH(c.total), 'Total'], [c.count, 'Sessions'], [fmtH(c.avgPerDay), 'Avg per day'], [fmtH(c.avgSession), 'Avg session']])}
  ${statCards([[`${c.activeDays}/${c.spanDays}`, 'Active days'], [fmtH(c.avgPerActiveDay), 'Avg per active day'], [c.bestDay ? fmtH(c.bestDay[1]) : '–', 'Best day' + (c.bestDay ? ' · ' + fmtDate(k2d(c.bestDay[0])) : '')], [c.avgFocus ? c.avgFocus.toFixed(1) + '★' : '–', 'Avg focus']])}
  <div class="grid2"><div class="card center"><h3>By subject</h3>${donut(c.bySubject, c.total)}<div class="legend" style="justify-content:center">${subjects.map(s => `<span><i class="dot" style="background:${color(s)}"></i>${esc(s)}</span>`).join('')}</div></div>
    <div class="card"><h3>Subjects</h3>${bars(c.bySubject, c.total, color)}</div></div>
  <div class="grid2"><div class="card"><h3>Activities</h3>${bars(c.byActivity, c.total, () => 'var(--acc)')}</div>
    <div class="card"><h3>Records</h3><div class="subj-row"><span>Best week</span><b>${c.bestWeek ? `${fmtH(c.bestWeek[1])} <small class="muted">${esc(c.bestWeek[0])}</small>` : '–'}</b></div><div class="subj-row"><span>Best month</span><b>${c.bestMonth ? `${fmtH(c.bestMonth[1])} <small class="muted">${esc(c.bestMonth[0])}</small>` : '–'}</b></div>
      <div class="subj-row"><span>Longest session</span><b>${fmtH(c.longestSession)}</b></div><div class="subj-row"><span>Longest streak</span><b>${c.streak} days</b></div><div class="subj-row"><span>Breaks</span><b>${fmtH(c.breakSec)}</b></div>
      <div class="subj-row"><span>Medals</span><b>${MEDAL_ORDER.map(m => `<span class="medal m-${m}"></span> ${c.medals[m]}`).join(' &nbsp;')}</b></div></div></div>
  <div class="grid2"><div class="card"><h3>By weekday</h3>${colChart(c.byWeekday, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])}</div><div class="card"><h3>Time of day</h3>${colChart(c.byHour, [...Array(24)].map((_, i) => (i % 3 ? '' : String(i))))}</div></div>
  <div class="card"><h3>Study “share price” (cumulative)</h3>${cum.length ? `<svg viewBox="0 0 700 160" preserveAspectRatio="none" style="width:100%;height:160px"><polyline vector-effect="non-scaling-stroke" fill="none" stroke="var(--ok)" stroke-width="2" points="${cum.map(([, v], i) => `${cum.length > 1 ? i / (cum.length - 1) * 700 : 0},${155 - v / cMax * 145}`).join(' ')}"/></svg><p class="muted small">${fmtH(cMax)} total since ${fmtDate(k2d(cum[0][0]), { month: 'short', day: 'numeric', year: 'numeric' })}</p>` : '<p class="muted small">No data yet</p>'}</div>
  <div class="card scroll"><h3>Data room · activities × subjects</h3>${acts.length ? `<table class="tbl"><tr><th></th>${subjects.map(s => `<th class="num">${esc(s)}</th>`).join('')}</tr>${acts.map(a => `<tr><th>${esc(a)}</th>${subjects.map(s => cell(c.matrix.activitySubject[a][s])).join('')}</tr>`).join('')}</table>` : '<p class="muted small">No data</p>'}</div>
  <div class="card scroll"><h3>Data room · subjects × weeks</h3>${weeks.length ? `<table class="tbl"><tr><th></th>${weeks.map(w => `<th class="num">${esc(w.slice(5))}</th>`).join('')}</tr>${subjects.map(s => `<tr><th><span class="dot" style="background:${color(s)}"></span> ${esc(s)}</th>${weeks.map(w => cell((c.matrix.subjectWeek[s] || {})[w])).join('')}</tr>`).join('')}<tr><th>Total</th>${weeks.map(w => `<td class="num"><b>${fmtH(c.byWeek[w])}</b></td>`).join('')}</tr></table>` : '<p class="muted small">No data</p>'}</div>`;
};
ACT.range = b => { UI.range = localStorage.statsRange = b.dataset.r; render(); };
ACT.sSubj = b => { UI.sSubj = b.value; render(); };
ACT.cRange = b => { UI[b.dataset.k] = b.value; render(); };

// ================= EXAMS & TO-DOS =================
const PRI = { high: 0, normal: 1, low: 2 };
VIEWS.plan = () => {
  const ex = S.exams.slice().sort((a, b) => a.date.localeCompare(b.date)), graded = ex.filter(e => e.grade != null && e.weight > 0);
  const wavg = graded.length ? graded.reduce((a, e) => a + e.grade * e.weight, 0) / graded.reduce((a, e) => a + +e.weight, 0) : null, tv = UI.taskView;
  const tasks = S.tasks.filter(t => (tv === 'done' ? t.done : !t.done && (tv === 'scheduled' ? !!t.due : !t.due))).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || PRI[a.priority] - PRI[b.priority]);
  return `<div class="card"><div class="row" style="margin:0 0 8px"><h3 class="grow" style="margin:0">Exams &amp; practice tests</h3><button class="btn primary" data-act="examEdit">+ Exam</button></div>
    ${ex.map(e => { const d = daysUntil(e.date); return `<div class="item" data-act="examEdit" data-id="${e.id}"><span class="dot" style="background:${color(e.subject)}"></span><div class="grow"><div>${esc(e.name)}</div><div class="n">${fmtDate(k2d(e.date), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${e.subject ? ' · ' + esc(e.subject) : ''}${e.notes ? ' · ' + esc(e.notes) : ''}</div></div><div class="t">${e.grade != null ? 'Score ' + esc(e.grade) : d > 0 ? d + ' days' : d === 0 ? 'Today' : 'Done'}</div></div>`; }).join('') || '<p class="muted small">Add your MCAT test date and AAMC full-lengths to get countdowns.</p>'}
    ${wavg != null ? `<p class="muted small">Weighted average score: <b>${wavg.toFixed(1)}</b> (${graded.length} graded)</p>` : ''}</div>
  <div class="card"><div class="row" style="margin:0 0 8px"><h3 class="grow" style="margin:0">To-dos / study plan</h3><div class="tabs">${['inbox', 'scheduled', 'done'].map(v => `<button data-act="taskView" data-v="${v}" class="${tv === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
    <div class="row wrap gap"><input id="nTask" placeholder="Add a to-do, e.g. UWorld 40 Qs Bio" class="grow"><input type="date" id="nDue" style="width:auto"><select id="nPri" style="width:auto"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select><select id="nTS" style="width:auto">${opt(S.subjects, '', 'Subject')}</select><button class="btn primary" data-act="taskAdd">Add</button></div>
    <div class="list mt">${tasks.map(t => `<div class="item"><input type="checkbox" class="chk" data-chg="taskDone" data-id="${t.id}" ${t.done ? 'checked' : ''}><div class="grow"><div style="${t.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.title)}</div><div class="n">${t.due ? (t.due < ST.todayKey && !t.done ? '<span class="pill high">overdue</span> ' : '') + fmtDate(k2d(t.due), { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date'}${t.subject ? ' · ' + esc(t.subject) : ''} ${t.priority !== 'normal' ? `<span class="pill ${t.priority}">${t.priority}</span>` : ''}</div></div><button class="icon" data-act="taskDel" data-id="${t.id}" title="Delete">✕</button></div>`).join('') || '<p class="muted small">Nothing here.</p>'}</div></div>`;
};
ACT.taskView = b => { UI.taskView = b.dataset.v; render(); };
ACT.taskAdd = async () => { const t = $('nTask').value.trim(); if (!t) return; await api('/api/tasks', 'POST', { title: t, due: $('nDue').value, priority: $('nPri').value, subject: $('nTS').value }); refresh(); };
ACT.taskDel = async b => { await api('/api/tasks/' + b.dataset.id, 'DELETE'); refresh(); };
ACT.examEdit = b => { const e = b.dataset.id ? S.exams.find(x => x.id === +b.dataset.id) : null;
  dialog(`<h3>${e ? 'Edit exam' : 'Add exam'}</h3><label>Name</label><input name="name" value="${esc(e?.name || 'MCAT')}" required><div class="row"><div><label>Date</label><input type="date" name="date" value="${e?.date || ''}" required></div><div><label>Subject</label><select name="subject">${opt(S.subjects, e?.subject || '', 'All / none')}</select></div></div>
    <div class="row"><div><label>Score / grade</label><input type="number" name="grade" value="${e?.grade ?? ''}"></div><div><label>Weight</label><input type="number" name="weight" min="0" step="0.5" value="${e?.weight ?? 1}"></div></div><label>Notes</label><input name="notes" value="${esc(e?.notes || '')}">
    <div class="row">${e ? '<button class="btn danger" value="del" formnovalidate>Delete</button>' : ''}<span class="sp"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="save">Save</button></div>`,
  async (v, f) => { if (v === 'del') await api('/api/exams/' + e.id, 'DELETE'); else await api(e ? '/api/exams/' + e.id : '/api/exams', e ? 'PUT' : 'POST', { name: f.name.value, date: f.date.value, subject: f.subject.value, grade: f.grade.value, weight: f.weight.value || 0, notes: f.notes.value }); refresh(); }); };

// ================= TROPHIES =================
VIEWS.trophy = async () => {
  const [A, R] = await Promise.all([api('/api/achievements'), api('/api/report')]), seen = new Set(JSON.parse(localStorage.seenAch || '[]')), md = R.current.medals;
  return `<div class="card"><h3>Medals</h3><p class="muted small">Earned for days above your thresholds (Settings): ${MEDAL_ORDER.slice().reverse().map(m => `<span class="medal m-${m}"></span> ${m} ${fmtH((S.settings.medals[m] || 0) * 60)}`).join(' · ')}</p>
    ${statCards(MEDAL_ORDER.map(m => [`<span class="medal m-${m}"></span> ${md[m]}`, m[0].toUpperCase() + m.slice(1)]))}</div>
  <div class="card"><h3>Achievements · ${A.filter(a => a.earned).length}/${A.length}</h3><div class="trophies">${A.map(a => `<div class="trophy ${a.earned ? 'on' : ''}"><div class="t-ic">${a.earned ? '🏆' : '🔒'}</div><b>${esc(a.name)}</b>${a.earned && !seen.has(a.id) ? ' <span class="pill approved">new</span>' : ''}<div class="muted small">${esc(a.desc)}</div>${a.earned ? '' : `<div class="bar t-prog"><i style="width:${Math.round((a.progress || 0) * 100)}%"></i></div><div class="muted small">${a.unit === 'h' ? fmtH(a.value) + ' / ' + fmtH(a.target) : a.value + ' / ' + a.target + (a.unit === 'd' ? ' days' : '')}</div>`}</div>`).join('')}</div></div>`;
};
AFTER.trophy = async () => { const A = await api('/api/achievements'); localStorage.seenAch = JSON.stringify(A.filter(a => a.earned).map(a => a.id)); };
async function checkAchievements() { try { const A = await api('/api/achievements'), stored = JSON.parse(localStorage.seenAch || 'null'), seen = new Set(stored || A.filter(a => a.earned).map(a => a.id));
  if (stored) for (const a of A) if (a.earned && !seen.has(a.id)) { notify('Achievement unlocked: ' + a.name, a.desc); seen.add(a.id); }
  localStorage.seenAch = JSON.stringify([...seen]); } catch { /* ignore */ } }

// ================= IMPORT / EXPORT (Athenify wizard) =================
const W = UI.wiz;
VIEWS.data = () => `<div class="card wizard" id="wiz"><h3>Import from Athenify</h3>${wizardHTML()}</div>
  <div class="card"><h3>Import CSV (other apps)</h3><p class="muted small">Columns are detected automatically (date, start, end, duration, subject/category, note). If detection is wrong, type the exact header names.</p>
    <input type="file" id="csvFile" accept=".csv,text/csv"><div class="grid3 maps">${['date', 'start', 'end', 'duration', 'subject', 'note'].map(k => `<input id="m_${k}" placeholder="${k} column">`).join('')}</div>
    <button class="btn primary" data-act="csvImport">Import CSV</button><pre id="csvRes" class="muted small"></pre></div>
  <div class="card"><h3>Backup &amp; export</h3><div class="row wrap gap"><a class="btn" href="/api/export.csv">Sessions CSV</a><a class="btn" href="/api/export.json">Full JSON backup</a>
    <label class="btn" style="margin:0">Restore JSON backup<input type="file" accept=".json,application/json" class="hid" data-chg="jsonImport"></label></div>
    <p class="muted small">Restoring merges and never deletes; sessions already present are skipped.</p></div>
  <div class="card"><h3>Calendar feed (iCal)</h3><p class="muted small">Subscribe to your sessions, exams and to-dos in Google Calendar, Apple Calendar or Outlook. The link is secret; make a new one if it leaks.</p>
    <div class="row wrap gap">${S.settings.hasFeed ? '<button class="btn" data-act="feedNew">Make a new link</button><button class="btn danger" data-act="feedOff">Disable feed</button>' : '<button class="btn primary" data-act="feedNew">Create feed link</button>'}</div><input id="feedUrl" class="mt hid" readonly></div>`;
function wizardHTML() {
  const rs = S.athenifyResync;
  if (W.step === 1) return `<ol class="steps"><li>Open <b>Athenify</b> in your browser and sign in.</li><li>Find its <b>calendar feed</b> (iCal) option, usually under Settings or integrations. Athenify lists it as “Export your study sessions as an iCal calendar feed”.</li>
    <li>Copy the feed link (it may start with <code>webcal://</code> or <code>https://</code>), or download it as an <code>.ics</code> file.</li><li>Paste the link or choose the file below. You'll see a preview and can map subjects before anything is imported.</li></ol>
    <p class="muted small">Can't find a feed? Athenify stores data under GDPR, so you can request a copy of your data (data export) from Athenify. Its CSV/JSON can then go through the CSV import below.</p>
    <label>Feed URL</label><input id="wUrl" placeholder="webcal://… or https://…" value="${esc(W.url || '')}"><div class="muted small center mt">or</div><input type="file" id="wFile" accept=".ics,text/calendar">
    <label>How are sessions named in the feed?</label><select id="wMode"><option value="auto">Auto-detect (“Subject - Activity”)</option><option value="subject">Whole title is the subject</option><option value="activity">Whole title is the activity</option></select>
    <div class="row"><span class="sp"></span><button class="btn primary" data-act="wizPreview">Preview</button></div>
    ${rs.enabled ? `<p class="muted small">Auto-resync is on (every 6 hours). Last sync: ${rs.lastSync ? new Date(rs.lastSync).toLocaleString() : 'never'}${rs.lastError ? ' · error: ' + esc(rs.lastError) : ''}. <button class="link" data-act="wizStopSync">Turn off and forget URL</button></p>` : ''}`;
  if (W.step === 2) { const P = W.preview, subjSel = s => `<select data-sub="${esc(s)}"><option value="__keep">Keep as new subject</option>${S.subjects.map(x => `<option ${x === s ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    return `<p><b>${P.count}</b> sessions found${P.duplicates ? ` · <b>${P.duplicates}</b> already imported (skipped)` : ''}${P.skipped.allDay ? ` · ${P.skipped.allDay} all-day events ignored` : ''}${P.skipped.invalid ? ` · ${P.skipped.invalid} invalid ignored` : ''}.</p>
      <h3 class="mt">Map subjects</h3><table class="tbl">${Object.entries(P.subjects).sort((a, b) => b[1].secs - a[1].secs).map(([s, v]) => `<tr><td>${esc(s)}</td><td class="num">${v.count}× · ${fmtH(v.secs)}</td><td>${subjSel(s)}</td></tr>`).join('')}</table>
      ${Object.keys(P.activities).length ? `<h3 class="mt">Activities found</h3><p class="small">${Object.entries(P.activities).map(([a, v]) => `${esc(a)} <span class="muted">(${v.count})</span>`).join(', ')}</p>` : ''}
      <h3 class="mt">Sample</h3><div class="scroll"><table class="tbl"><tr><th>Start</th><th>Duration</th><th>Title</th><th>Description</th></tr>${P.sample.map(e => `<tr><td class="nowrap">${new Date(e.start).toLocaleString()}</td><td>${fmtH((new Date(e.end) - new Date(e.start)) / 1000)}</td><td>${esc(e.summary)}</td><td>${esc(String(e.description).slice(0, 80))}</td></tr>`).join('')}</table></div>
      <label class="switch mt"><input type="checkbox" id="wNote" checked> Use event description as the session note</label>
      ${W.url ? '<label class="switch"><input type="checkbox" id="wSync"> Keep in sync: saves the feed URL on this server and re-imports new sessions every 6 hours</label>' : ''}
      <div class="row"><button class="btn" data-act="wizBack">Back</button><span class="sp"></span><button class="btn primary" data-act="wizImport">Import ${P.count - P.duplicates} sessions</button></div>`; }
  return `<p>✅ Imported <b>${W.result.added}</b> sessions${W.result.duplicates ? `, skipped ${W.result.duplicates} duplicates` : ''}${W.result.invalid ? `, ${W.result.invalid} invalid` : ''}.</p><div class="row"><button class="btn" data-act="wizBack">Import more</button><button class="btn primary" data-act="goto" data-v="dash">See dashboard</button></div>`;
}
ACT.wizPreview = async () => {
  const f = $('wFile').files[0], url = $('wUrl').value.trim(); W.mode = $('wMode').value;
  if (!f && !url) return toast('Paste the feed URL or choose an .ics file');
  W.url = f ? '' : url; toast('Loading…'); W.preview = await api('/api/athenify/preview', 'POST', f ? { ics: await f.text(), mode: W.mode } : { url, mode: W.mode }); W.step = 2; render();
};
ACT.wizBack = () => { W.step = 1; render(); };
ACT.wizImport = async () => {
  const subjectMap = {}; document.querySelectorAll('#wiz [data-sub]').forEach(s => { if (s.value !== '__keep') subjectMap[s.dataset.sub] = s.value; });
  const sync = !!$('wSync')?.checked;
  W.result = await api('/api/athenify/import', 'POST', { events: W.preview.events, mode: W.mode, subjectMap, noteFrom: $('wNote').checked ? 'description' : 'none', ...(sync ? { url: W.url, resync: true } : {}) });
  W.step = 3; W.preview = null; if (!sync) W.url = ''; await refresh(); checkAchievements();
};
ACT.wizStopSync = async () => { await api('/api/athenify/resync', 'DELETE'); toast('Auto-resync off; feed URL deleted'); refresh(); };
ACT.csvImport = async () => { const f = $('csvFile').files[0]; if (!f) return toast('Choose a CSV file'); const map = {}; ['date', 'start', 'end', 'duration', 'subject', 'note'].forEach(k => { const v = $('m_' + k).value.trim(); if (v) map[k] = v; });
  const r = await api('/api/import', 'POST', { csv: await f.text(), map }); $('csvRes').textContent = `Imported ${r.added}, skipped ${r.skipped}.\nDetected columns: ${JSON.stringify(r.columns)}`; await load(); };
ACT.jsonImport = async b => { const f = b.files[0]; if (!f) return; const r = await api('/api/import.json', 'POST', JSON.parse(await f.text())); toast(`Restored ${r.added} sessions (${r.skipped} skipped)`); refresh(); };
ACT.feedNew = async () => { const r = await api('/api/feed', 'POST'); await refresh(); const i = $('feedUrl'); i.value = location.origin + r.path; i.classList.remove('hid'); i.select(); toast('Copy the link now; it is only shown once'); };
ACT.feedOff = async () => { await api('/api/feed', 'DELETE'); refresh(); };

// ================= SETTINGS =================
VIEWS.set = async () => {
  const s = S.settings, g = s.goals, pm = s.pomodoro, md = s.medals, my = await api('/api/reports').catch(() => []), th = document.documentElement.dataset.theme;
  return `<div class="card"><h3>Appearance</h3><div class="row wrap gap"><div class="tabs grow"><button data-act="theme" data-t="dark" class="${th === 'dark' ? 'on' : ''}">Dark</button><button data-act="theme" data-t="light" class="${th === 'light' ? 'on' : ''}">Light</button></div>
    <span class="muted small">Accent</span><input type="color" id="sAccent" value="${s.accent || '#6c8cff'}" style="width:60px;padding:2px"><button class="btn" data-act="saveAccent">Save</button><button class="btn" data-act="resetAccent">Reset</button></div></div>
  <div class="card"><h3>Goals</h3><div class="grid3"><div><label>Daily (h)</label><input type="number" step="0.25" min="0" id="gD" value="${g.dailyMin / 60}"></div><div><label>Weekend daily (h, blank = same)</label><input type="number" step="0.25" min="0" id="gWE" value="${g.weekendDailyMin == null ? '' : g.weekendDailyMin / 60}"></div>
    <div><label>Weekly (h)</label><input type="number" min="0" id="gW" value="${g.weeklyMin / 60 || ''}"></div><div><label>Monthly (h)</label><input type="number" min="0" id="gM" value="${g.monthlyMin / 60 || ''}"></div><div><label>Term / prep total (h)</label><input type="number" min="0" id="gT" value="${g.termMin / 60 || ''}"></div><div><label>Day starts at hour (night owls)</label><input type="number" min="0" max="6" id="gDS" value="${s.dayStartHour}"></div></div>
    <div class="grid3"><div><label>Term name</label><input id="tN" value="${esc(s.term.name)}" placeholder="MCAT prep"></div><div><label>Term start</label><input type="date" id="tS" value="${s.term.start}"></div><div><label>Term end / test day</label><input type="date" id="tE" value="${s.term.end}"></div></div>
    <div class="row"><span class="sp"></span><button class="btn primary" data-act="saveGoals">Save goals</button></div></div>
  <div class="card"><h3>Subjects</h3>${S.subjects.map(n => { const m = S.subjectMeta[n] || {}; return `<div class="subj-row" data-subj="${esc(n)}"><input type="color" value="${m.color || '#868e96'}" style="width:40px;padding:2px" data-chg="subjColor"><span>${esc(n)}</span>
      <input type="number" min="0" placeholder="weekly goal h" value="${m.weeklyGoalMin ? m.weeklyGoalMin / 60 : ''}" style="width:120px" data-chg="subjGoal" title="Weekly goal (hours)"><button class="icon" data-act="subjRename" title="Rename">✎</button><button class="icon" data-act="subjDel" title="Remove">✕</button></div>`; }).join('')}
    <div class="row"><input id="newSubj" placeholder="Add custom subject"><button class="btn" data-act="addSubj">Add</button></div></div>
  <div class="card"><h3>Activities (study types)</h3><div class="row wrap gap">${S.activities.map(a => `<span class="pill">${esc(a)} <button class="link" data-act="actDel" data-a="${esc(a)}">✕</button></span>`).join('')}</div>
    <div class="row"><input id="newAct" placeholder="e.g. UWorld, Anki, AAMC section bank"><button class="btn" data-act="addAct">Add</button></div></div>
  <div class="card"><h3>Timer</h3><div class="grid3"><div><label>Focus (min)</label><input type="number" id="pF" value="${pm.focusMin}"></div><div><label>Short break (min)</label><input type="number" id="pS" value="${pm.shortMin}"></div><div><label>Long break (min)</label><input type="number" id="pL" value="${pm.longMin}"></div><div><label>Cycles before long break</label><input type="number" id="pC" value="${pm.cycles}"></div><div><label>Quick durations (min, comma)</label><input id="qD" value="${s.quickDurations.join(', ')}"></div><div><label>&nbsp;</label><label class="switch"><input type="checkbox" id="pA" ${pm.autoStart ? 'checked' : ''}> Auto-start next focus</label></div></div>
    <div class="row"><span class="sp"></span><button class="btn primary" data-act="saveTimer">Save timer</button></div></div>
  <div class="card"><h3>Medals</h3><div class="grid4">${MEDAL_ORDER.slice().reverse().map(m => `<div><label><span class="medal m-${m}"></span> ${m} (h/day)</label><input type="number" step="0.25" min="0" id="md_${m}" value="${md[m] / 60}"></div>`).join('')}</div><div class="row"><span class="sp"></span><button class="btn primary" data-act="saveMedals">Save medals</button></div></div>
  <div class="card"><h3>Notifications &amp; reminders</h3><p class="muted small">${window.isSecureContext ? '' : '⚠️ Browsers only allow system notifications and installing the app over HTTPS. Use the Tailscale HTTPS address (see README); sounds and in-app alerts still work here. '}Reminders fire while the app is open or installed.</p>
    <div class="row wrap gap"><button class="btn" data-act="notifPerm">${'Notification' in window && Notification.permission === 'granted' ? 'Notifications enabled ✓' : 'Enable notifications'}</button><span class="muted small">Remind me if I haven't studied by</span><input type="time" id="remT" value="${localStorage.remindAt || ''}" style="width:auto"><button class="btn" data-act="saveRem">Save</button></div></div>
  <div class="card"><h3>Busy Bar</h3><p class="muted small">Optional. Shows your study status on a Busy Bar on your network. Leave the IP blank to disable.</p>
    <label>Busy Bar IP</label><input id="sBip" value="${esc(s.busyIp)}" placeholder="192.168.0.x"><label>API token</label><input id="sBtok" type="password" autocomplete="off" value="${esc(s.busyToken)}">
    <div class="row"><button class="btn primary" data-act="saveBusy">Save</button><button class="btn" data-act="testBusy">Send test</button></div></div>
  <div class="card"><h3>Report a bug</h3><p class="muted small">Goes to the admin for review. The current page and browser info are attached.</p>
    <input id="bgT" placeholder="Short title" maxlength="120"><textarea id="bgD" class="mt" placeholder="What happened? What did you expect?" maxlength="4000"></textarea><textarea id="bgS" class="mt" placeholder="Steps to reproduce (optional)" maxlength="4000"></textarea>
    <div class="row"><span class="sp"></span><button class="btn primary" data-act="bugSend">Submit report</button></div>
    ${my.length ? `<h3 class="mt">My reports</h3>${my.slice().reverse().map(r => `<div class="report"><b>${esc(r.title)}</b> <span class="pill ${esc(r.status)}">${esc(r.status)}</span>${r.adminNote ? `<div class="muted small">Admin: ${esc(r.adminNote)}</div>` : ''}</div>`).join('')}` : ''}</div>
  <div class="card"><h3>Account</h3><p class="muted small">Signed in as ${esc(ME.username)}${ME.admin ? ' (admin)' : ''}</p>
    <input id="pCur" type="password" placeholder="Current password" autocomplete="current-password"><input id="pNew" class="mt" type="password" placeholder="New password (8+ chars)" autocomplete="new-password">
    <div class="row"><button class="btn" data-act="changePw">Update password</button><span class="sp"></span><button class="btn" data-act="onboard">Show welcome tour</button></div></div>
  ${ME.admin ? await adminHTML() : ''}`;
};
async function adminHTML() {
  const [cfg, users, reps] = await Promise.all([api('/api/admin/config'), api('/api/admin/users'), api('/api/admin/reports')]), f = UI.repFilter || 'pending';
  const list = reps.filter(r => f === 'all' || r.status === f).reverse();
  return `<div class="card"><h3>Admin</h3><label class="switch"><input type="checkbox" data-chg="openReg" ${cfg.openRegistration ? 'checked' : ''}> Allow new users to register</label>
    <div class="list mt">${users.map(u => `<div class="subj-row"><span>${esc(u.username)}${u.admin ? ' <small class="muted">admin</small>' : ''}</span><small class="muted">${new Date(u.created).toLocaleDateString()}</small></div>`).join('')}</div></div>
  <div class="card"><div class="row wrap" style="margin:0 0 8px"><h3 class="grow" style="margin:0">Bug reports</h3><div class="tabs">${['pending', 'approved', 'rejected', 'all'].map(s => `<button data-act="repFilter" data-f="${s}" class="${f === s ? 'on' : ''}">${s}${s === 'all' ? '' : ' ' + reps.filter(r => r.status === s).length}</button>`).join('')}</div></div>
    <p class="muted small">Report text is user-submitted and untrusted. Approving only saves it to <code>mcat-tracker-reports/approved/</code> so the developer can read it on request. Nothing is changed automatically.</p>
    ${list.map(r => `<div class="report"><div class="row" style="margin:0"><b class="grow">#${r.id} ${esc(r.title)}</b><span class="pill ${esc(r.status)}">${esc(r.status)}</span></div>
      <div class="muted small">by ${esc(r.username)} · ${new Date(r.created).toLocaleString()} · ${esc(r.meta?.page)} · ${esc(String(r.meta?.userAgent || '').slice(0, 80))}</div>
      <p>${esc(r.description)}</p>${r.steps ? `<div class="muted small">Steps:</div><p>${esc(r.steps)}</p>` : ''}${r.adminNote ? `<div class="muted small">Note: ${esc(r.adminNote)}</div>` : ''}
      <div class="row"><button class="btn" data-act="repReview" data-id="${r.id}">Review / edit</button>${r.status !== 'approved' ? `<button class="btn primary" data-act="repSet" data-id="${r.id}" data-s="approved">Approve</button>` : ''}${r.status !== 'rejected' ? `<button class="btn danger" data-act="repSet" data-id="${r.id}" data-s="rejected">Reject</button>` : ''}</div></div>`).join('') || '<p class="muted small">No reports.</p>'}</div>`;
}
ACT.theme = b => { document.documentElement.dataset.theme = localStorage.theme = b.dataset.t; render(); };
ACT.saveAccent = async () => { await api('/api/settings', 'POST', { accent: $('sAccent').value }); await refresh(); };
ACT.resetAccent = async () => { await api('/api/settings', 'POST', { accent: '' }); await refresh(); };
const hrs = id => Math.round((+$(id).value || 0) * 60);
ACT.saveGoals = async () => { await api('/api/settings', 'POST', { goals: { dailyMin: hrs('gD'), weekendDailyMin: $('gWE').value === '' ? null : hrs('gWE'), weeklyMin: hrs('gW'), monthlyMin: hrs('gM'), termMin: hrs('gT') }, dayStartHour: +$('gDS').value || 0, term: { name: $('tN').value, start: $('tS').value, end: $('tE').value } }); toast('Goals saved'); refresh(); };
ACT.saveTimer = async () => { await api('/api/settings', 'POST', { pomodoro: { focusMin: +$('pF').value, shortMin: +$('pS').value, longMin: +$('pL').value, cycles: +$('pC').value, autoStart: $('pA').checked }, quickDurations: $('qD').value.split(/[ ,]+/).filter(Boolean).map(Number) }); toast('Timer saved'); refresh(); };
ACT.saveMedals = async () => { const medals = {}; MEDAL_ORDER.forEach(m => (medals[m] = hrs('md_' + m))); await api('/api/settings', 'POST', { medals }); toast('Medals saved'); refresh(); };
const subjOf = b => b.closest('[data-subj]').dataset.subj;
ACT.subjColor = async b => { await api('/api/subjects', 'PUT', { name: subjOf(b), color: b.value }); await load(); };
ACT.subjGoal = async b => { await api('/api/subjects', 'PUT', { name: subjOf(b), weeklyGoalMin: Math.round((+b.value || 0) * 60) }); toast('Weekly subject goal saved'); await load(); };
ACT.subjRename = async b => { const n = subjOf(b), nn = prompt('Rename subject (past sessions are renamed too):', n); if (nn && nn.trim() && nn !== n) { await api('/api/subjects', 'PUT', { name: n, rename: nn.trim() }); if (sel === n) sel = nn.trim(); refresh(); } };
ACT.subjDel = async b => { const n = subjOf(b); if (confirm(`Remove "${n}" from the list? Past sessions are kept.`)) { await api('/api/subjects', 'DELETE', { name: n }); refresh(); } };
ACT.addSubj = async () => { const n = $('newSubj').value.trim(); if (n) { await api('/api/subjects', 'POST', { name: n }); refresh(); } };
ACT.addAct = async () => { const n = $('newAct').value.trim(); if (n) { await api('/api/activities', 'POST', { name: n }); refresh(); } };
ACT.actDel = async b => { await api('/api/activities', 'DELETE', { name: b.dataset.a }); refresh(); };
ACT.notifPerm = async () => { if (!('Notification' in window)) return toast('Notifications are not supported in this browser'); if (!window.isSecureContext) return toast('Notifications need HTTPS (see README: Tailscale HTTPS)'); await Notification.requestPermission(); render(); };
ACT.saveRem = () => { localStorage.remindAt = $('remT').value; toast($('remT').value ? 'Reminder set' : 'Reminder off'); };
function checkReminder() { const t = localStorage.remindAt; if (!t || !ST || S?.active) return; const now = new Date(), [h, m] = t.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m || localStorage.remindedOn === dk(now) || ST.today > 0) return; localStorage.remindedOn = dk(now); notify('Time to study 📚', `Nothing logged yet today. Keep your ${ST.streak}-day streak alive!`); }
ACT.saveBusy = async () => { await api('/api/settings', 'POST', { busyIp: $('sBip').value, busyToken: $('sBtok').value }); toast('Busy Bar saved'); refresh(); };
ACT.testBusy = async () => { const r = await api('/api/busybar/test', 'POST'); toast(r.ok ? 'Sent! Check your Busy Bar.' : 'Could not reach the Busy Bar'); };
ACT.changePw = async () => { await api('/api/password', 'POST', { current: $('pCur').value, password: $('pNew').value }); toast('Password updated; other devices signed out'); render(); };
ACT.bugSend = async () => { await api('/api/reports', 'POST', { title: $('bgT').value, description: $('bgD').value, steps: $('bgS').value, page: '#' + view, userAgent: navigator.userAgent }); toast('Thanks! Report sent for review.'); render(); };
ACT.openReg = async b => { await api('/api/admin/config', 'POST', { openRegistration: b.checked }); toast(b.checked ? 'Registration open' : 'Registration closed'); };
ACT.repFilter = b => { UI.repFilter = b.dataset.f; render(); };
ACT.repSet = async b => { await api('/api/admin/reports/' + b.dataset.id, 'PUT', { status: b.dataset.s }); toast('Report ' + b.dataset.s); render(); };
ACT.repReview = async b => { const r = (await api('/api/admin/reports')).find(x => x.id === +b.dataset.id);
  dialog(`<h3>Review report #${r.id}</h3><p class="muted small">From ${esc(r.username)}. Edit the wording before approving if needed.</p><label>Title</label><input name="title" value="${esc(r.title)}" maxlength="120"><label>Description</label><textarea name="description" maxlength="4000">${esc(r.description)}</textarea>
    <label>Steps</label><textarea name="steps" maxlength="4000">${esc(r.steps)}</textarea><label>Admin note</label><textarea name="note" maxlength="2000">${esc(r.adminNote)}</textarea>
    <div class="row"><button class="btn danger" value="rejected">Reject</button><span class="sp"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn" value="pending">Save as pending</button><button class="btn primary" value="approved">Approve</button></div>`,
  async (v, f) => { await api('/api/admin/reports/' + r.id, 'PUT', { title: f.title.value, description: f.description.value, steps: f.steps.value, adminNote: f.note.value, status: v }); toast('Saved'); render(); }); };

// ---------- onboarding ----------
ACT.onboard = () => onboarding();
function onboarding() {
  dialog(`<h3>Welcome to your MCAT tracker 👋</h3><ol class="steps"><li>Set a <b>daily goal</b>. Weekly, monthly and test-day goals are in Settings.</li><li>Pick a subject and hit <b>Start</b>, or use Pomodoro / Countdown mode.</li><li>Coming from <b>Athenify</b>? Import your history in a few clicks.</li></ol>
    <label>Daily goal (hours)</label><input type="number" name="goal" step="0.5" min="0" value="${S.settings.goals.dailyMin / 60}"><label>MCAT test date (optional)</label><input type="date" name="mcat">
    <div class="row"><button class="btn" value="athenify">Import from Athenify</button><span class="sp"></span><button class="btn primary" value="ok">Let's go</button></div>`,
  async (v, f) => { await api('/api/settings', 'POST', { goals: { dailyMin: Math.round(+f.goal.value * 60) } }); if (f.mcat.value) await api('/api/exams', 'POST', { name: 'MCAT', date: f.mcat.value });
    await refresh(); if (v === 'athenify') { W.step = 1; go('data'); } });
}

// ---------- periodic refresh ----------
setInterval(() => { if (ME && !document.hidden && !$('dlg').open && ['timer', 'dash'].includes(view)) refresh().catch(() => {}); }, 60000);
setInterval(() => { if (ME && !document.hidden) checkAchievements(); }, 120000);
document.addEventListener('visibilitychange', () => { if (ME && !document.hidden && view === 'timer') refresh().catch(() => {}); });
boot().catch(e => { document.body.innerHTML = '<p style="padding:20px">Failed to load: ' + esc(e.message) + '</p>'; });
