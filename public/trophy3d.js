// 3D trophies: one shared WebGL renderer, three quality tiers (low/medium/high) picked per device.
// Grid tiles get cached static thumbnails (rendered lazily when visible, cached per tier); the viewer borrows
// the same renderer for a live, draggable model. Medium/high extras live in trophy3d-hq.js and are only
// fetched when that tier is in use. Falls back to the emoji icon if WebGL is unavailable.
import * as THREE from '/vendor/three/three.module.min.js';

export const Q = {
  low: { size: 160, seg: 1, bevel: 2, dpr: 1.5 },
  medium: { size: 224, seg: 1.6, bevel: 4, dpr: 2 },
  high: { size: 320, seg: 2.6, bevel: 8, dpr: 2, shadow: true }
};
let R = null, failed = false, tier = 'low', q = Q.low, HQ = null, env = null, info = null;
const envs = {}, cache = new Map(), queue = [], times = {};
function renderer() {
  if (R || failed) return R;
  try {
    const c = document.createElement('canvas'); R = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'default' });
    R.setPixelRatio(1); R.setSize(q.size, q.size, false); R.toneMapping = THREE.ACESFilmicToneMapping; R.outputColorSpace = THREE.SRGBColorSpace; R.setClearColor(0x000000, 0);
    R.shadowMap.type = THREE.PCFSoftShadowMap;
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); }, false);
  } catch { failed = true; R = null; }
  return R;
}
export const supported = () => !!renderer();
// tiny procedural studio environment for the low tier (medium/high use the HQ room environment)
function lowEnv() {
  const pm = new THREE.PMREMGenerator(R), es = new THREE.Scene(), g = new THREE.SphereGeometry(10, 16, 8);
  es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x1b1f2a, side: THREE.BackSide })));
  for (const [x, y, z, s, col] of [[0, 8, 0, 6, 0xffffff], [7, 2, 4, 3, 0xffe2b8], [-7, 1, -3, 3, 0xb8d4ff], [0, -6, 6, 4, 0x555b66]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); }
  const t = pm.fromScene(es, 0.02).texture; pm.dispose(); es.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); return t;
}
async function useTier(t) {
  if (!renderer()) return false;
  if (t !== 'low' && !HQ) HQ = await import('/trophy3d-hq.js').catch(() => null);
  if (t !== 'low' && !HQ) t = 'low';
  tier = t; q = Q[t]; const ek = t === 'low' ? 'low' : 'hq';
  env = envs[ek] ||= ek === 'low' ? lowEnv() : HQ.roomEnv(R); R.shadowMap.enabled = !!q.shadow; return true;
}
// ---- tier selection: override (Settings) > cached auto result > probe + benchmark ----
const TT = () => globalThis.TrophyTier;
function bench(t) {
  const s = { id: 'bench', base: 'cup', tier: 'gold', earned: true, metal: '#d4af37', accent: '#6c8cff', detail: 4, variant: 1, twist: 20, stars: 3, plinth: 0, unit: 'h' };
  const { sc, cam, obj } = stage(s), gl = R.getContext(), px = new Uint8Array(4), N = 8, ts = [];
  R.setSize(256, 256, false); R.compile(sc, cam);
  for (let i = 0; i < N; i++) { const t0 = performance.now(); obj.rotation.y = i * 0.3; R.render(sc, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }
  dispose(sc); R.setSize(q.size, q.size, false); const k = ts.slice(2).sort((a, b) => a - b); return Math.round(k[k.length >> 1] * 10) / 10;
}
async function chooseTier() {
  if (!renderer() || !TT()) { info = { tier: 'low', source: 'default' }; return useTier('low'); }
  const T = TT(), caps = T.probe(R.getContext()), gpu = caps.renderer || '', ov = localStorage.t3dQuality;
  let cached = null; try { cached = JSON.parse(localStorage.t3dAuto || 'null'); } catch { /* ignore */ }
  const r = T.resolve(ov, cached, gpu);
  if (r.tier) { info = { ...(cached || {}), tier: r.tier, source: r.source }; return useTier(r.tier); }
  const p = T.pick(caps); let t = p.tier === 'none' ? 'low' : p.tier, ms = null;
  if (t !== 'low') { await useTier(t); try { ms = bench(t); } catch { ms = null; } t = T.applyBench(t, ms); }
  const auto = { v: T.V, tier: t, ceil: p.tier, why: p.why, ms, gpu, at: Date.now() }; try { localStorage.t3dAuto = JSON.stringify(auto); } catch { /* ignore */ }
  info = { ...auto, source: 'detect' }; return useTier(t);
}
let ready = null; const whenReady = () => (ready ||= chooseTier());
// re-read the Settings override (or redo auto-detect) and switch tier; cached thumbnails for other tiers are kept
export async function refreshTier() { ready = null; queue.length = 0; await whenReady(); return tier; }

const grey = c => { const k = new THREE.Color(c), l = k.r * 0.3 + k.g * 0.59 + k.b * 0.11; return new THREE.Color(l * 0.55 + 0.08, l * 0.55 + 0.09, l * 0.55 + 0.11); };
function mats(s) {
  const earned = s.earned, metal = earned ? new THREE.Color(s.metal) : grey(s.metal), acc = earned ? new THREE.Color(s.accent) : grey(s.accent);
  return {
    metal: new THREE.MeshStandardMaterial({ color: metal, metalness: earned ? 1 : 0.2, roughness: earned ? (s.tier === 'platinum' ? 0.12 : 0.26) : 0.8, envMap: env, envMapIntensity: earned ? 1.25 : 0.35 }),
    accent: new THREE.MeshStandardMaterial({ color: acc, metalness: 0.3, roughness: 0.35, envMap: env, envMapIntensity: earned ? 0.8 : 0.2, emissive: earned ? acc.clone().multiplyScalar(0.25) : new THREE.Color(0) }),
    base: new THREE.MeshStandardMaterial({ color: earned ? 0x2a2f3a : 0x30333a, metalness: 0.1, roughness: 0.55, envMap: env, envMapIntensity: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: earned ? 0xdff3ff : 0x888c93, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0, envMap: env }),
    gem: new THREE.MeshStandardMaterial({ color: earned ? s.accent : grey(s.accent), metalness: 0.1, roughness: 0.08, envMap: env, envMapIntensity: earned ? 1.6 : 0.3, flatShading: true })
  };
}
const S = n => Math.max(3, Math.round(n * q.seg));
const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), S(seg));
// rocket fin: a swept trapezoid whose root edge is buried in the hull, so it stays attached at every angle
function finGeo() {
  const sh = new THREE.Shape(); sh.moveTo(0.2, -0.12); sh.lineTo(0.2, -0.7); sh.lineTo(0.6, -0.9); sh.lineTo(0.6, -0.66); sh.lineTo(0.2, -0.12);
  const b = q.bevel > 2, g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: b, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: q.bevel / 2 }); g.translate(0, 0, -0.025); return g;
}
function plinth(s, M) {
  const g = new THREE.Group(), kind = s.plinth;
  const geo = kind === 0 ? new THREE.CylinderGeometry(0.78, 0.86, 0.34, 48) : kind === 1 ? new THREE.BoxGeometry(1.5, 0.34, 1.5) : new THREE.CylinderGeometry(0.72, 0.9, 0.34, 6);
  const b = new THREE.Mesh(geo, M.base); b.position.y = -1.13; g.add(b);
  const band = new THREE.Mesh(kind === 1 ? new THREE.BoxGeometry(1.52, 0.06, 1.52) : new THREE.CylinderGeometry(kind === 2 ? 0.83 : 0.84, kind === 2 ? 0.83 : 0.84, 0.06, kind === 2 ? 6 : 48), M.metal); band.position.y = -1.0; g.add(band);
  for (let i = 0; i < s.stars; i++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.075), M.accent); st.position.set((i - (s.stars - 1) / 2) * 0.22, -1.13, kind === 1 ? 0.77 : 0.86); g.add(st); }
  return g;
}
const MODELS = {
  rocket(s, M) { const g = new THREE.Group();
    const body = new THREE.Mesh(lathe([[0, -0.75], [0.3, -0.7], [0.36, -0.2], [0.34, 0.35], [0.2, 0.75], [0, 1.0]]), M.metal); g.add(body);
    const win = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, S(10), S(24)), M.accent); win.position.set(0, 0.25, 0.33); g.add(win);
    const fg = finGeo(); for (let i = 0; i < s.detail; i++) { const f = new THREE.Mesh(fg, M.accent); f.rotation.y = i / s.detail * Math.PI * 2 + Math.PI / 2; g.add(f); }
    if (s.variant % 2) { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, S(16)), M.accent); fl.position.y = -0.95; fl.rotation.x = Math.PI; g.add(fl); }
    g.position.y = 0.05; return g; },
  hourglass(s, M) { const g = new THREE.Group();
    const glass = M.glass;
    const top = new THREE.Mesh(lathe([[0.05, 0], [0.42, 0.55], [0.44, 0.7], [0, 0.7]]), glass); const bot = top.clone(); bot.rotation.x = Math.PI; g.add(top, bot);
    const sand = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.32 + s.variant * 0.06, S(24)), M.accent); sand.position.y = -0.52; g.add(sand);
    for (const y of [0.76, -0.76]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.1, 6 + s.detail * 2), M.metal); cap.position.y = y; g.add(cap); }
    for (let i = 0; i < 3 + (s.variant % 2); i++) { const a = i / (3 + (s.variant % 2)) * Math.PI * 2, p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, S(8)), M.metal); p.position.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5); g.add(p); }
    return g; },
  flame(s, M) { const g = new THREE.Group(), n = 2 + (s.variant % 3);
    for (let i = 0; i < n; i++) { const k = 1 - i * 0.22, f = new THREE.Mesh(lathe([[0, -0.6], [0.42 * k, -0.35], [0.34 * k, 0.1], [0.12 * k, 0.6], [0, 0.95 * k]], 24), i === n - 1 ? M.accent : M.metal);
      f.position.y = -0.1 + i * 0.12; f.rotation.y = s.twist * Math.PI / 180 + i; f.scale.set(1, 1, 0.8); g.add(f); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, S(10), S(40)), M.metal); ring.rotation.x = Math.PI / 2; ring.position.y = -0.62; g.add(ring);
    for (let i = 0; i < s.detail; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, S(10), S(8)), M.accent), a = i / s.detail * Math.PI * 2; d.position.set(Math.sin(a) * 0.55, -0.62, Math.cos(a) * 0.55); g.add(d); }
    return g; },
  bolt(s, M) { const g = new THREE.Group(), sh = new THREE.Shape(), w = 0.9 + s.variant * 0.05;
    sh.moveTo(0.15 * w, 1.0); sh.lineTo(-0.45 * w, -0.05); sh.lineTo(-0.02, -0.05); sh.lineTo(-0.2 * w, -1.0); sh.lineTo(0.48 * w, 0.15); sh.lineTo(0.05, 0.15); sh.lineTo(0.15 * w, 1.0);
    const b = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: q.bevel }), M.metal); b.position.z = -0.11; g.add(b);
    for (let i = 0; i < s.detail - 1; i++) { const sp = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09), M.accent), a = i / (s.detail - 1) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.1); g.add(sp); }
    return g; },
  crystal(s, M) { const g = new THREE.Group(), geo = [new THREE.OctahedronGeometry(0.62, 0), new THREE.IcosahedronGeometry(0.58, 0), new THREE.DodecahedronGeometry(0.56, 0), new THREE.OctahedronGeometry(0.6, 1)][s.variant];
    const gem = new THREE.Mesh(geo, M.gem);
    gem.scale.y = 1.3; gem.position.y = 0.15; gem.rotation.y = s.twist * Math.PI / 180; g.add(gem);
    const cup = new THREE.Mesh(lathe([[0.1, -0.9], [0.2, -0.75], [0.42, -0.6], [0.46, -0.52], [0.0, -0.52]]), M.metal); g.add(cup);
    for (let i = 0; i < s.detail; i++) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, S(8)), M.metal), a = i / s.detail * Math.PI * 2; p.position.set(Math.sin(a) * 0.42, -0.42, Math.cos(a) * 0.42); g.add(p); }
    return g; },
  target(s, M) { const g = new THREE.Group(), n = 2 + s.variant;
    for (let i = 0; i < n; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.75 - i * (0.6 / n), 0.06, S(10), S(48)), i % 2 ? M.accent : M.metal); g.add(r); }
    const bull = new THREE.Mesh(new THREE.SphereGeometry(0.1, S(16), S(12)), M.accent); g.add(bull);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, S(8)), M.metal); shaft.rotation.x = Math.PI / 2 - 0.35; shaft.rotation.z = 0.3; shaft.position.set(0.12, 0.1, 0.5); g.add(shaft);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.4, S(10)), M.metal); stand.position.y = -0.95; g.add(stand); g.position.y = 0.1; return g; },
  medal(s, M) { const g = new THREE.Group(), sides = [S(48), 8, 12, 6][s.variant];
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, sides), M.metal); disk.rotation.x = Math.PI / 2; g.add(disk);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.14, sides), M.accent); inner.rotation.x = Math.PI / 2; g.add(inner);
    const star = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.13 : 0.3, a = i / 10 * Math.PI * 2 + Math.PI / 2; i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const st = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.06, bevelEnabled: q.bevel > 2, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: q.bevel }), M.metal); st.position.z = 0.06; g.add(st);
    for (const x of [-0.18, 0.18]) { const rb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.03), M.accent); rb.position.set(x, 0.9, -0.02); rb.rotation.z = x * -1.2; g.add(rb); }
    g.position.y = -0.15; return g; },
  globe(s, M) { const g = new THREE.Group(), sph = new THREE.Mesh(new THREE.SphereGeometry(0.55, S(32), S(20)), M.accent); g.add(sph);
    for (let i = 0; i < s.detail; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, S(8), S(48)), M.metal); r.rotation.y = i / s.detail * Math.PI; r.rotation.x = s.variant * 0.2; g.add(r); }
    const eq = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.04, S(8), S(48)), M.metal); eq.rotation.x = Math.PI / 2; g.add(eq);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.45, S(12)), M.metal); stem.position.y = -0.78; g.add(stem); g.position.y = 0.12; return g; },
  cup(s, M) { const g = new THREE.Group();
    const cup = new THREE.Mesh(lathe([[0.12, -0.95], [0.12, -0.55], [0.06, -0.4], [0.3, -0.15], [0.52, 0.35], [0.58, 0.8], [0.54, 0.82], [0.0, 0.2]]), M.metal); g.add(cup);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.535, 0.49, 0.14, S(40), 1, true), M.accent); band.position.y = 0.42; g.add(band);
    for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, S(8), S(24), Math.PI * 1.2), M.metal); h.position.set(sx * 0.58, 0.35, 0); h.rotation.z = sx > 0 ? -Math.PI * 0.6 : Math.PI * 1.6; g.add(h); }
    if (s.unit === 'h') { const k = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, S(8), S(24)), M.accent); k.position.y = -0.3; k.rotation.x = Math.PI / 2; g.add(k); }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.1, S(32)), M.metal); foot.position.y = -0.92; g.add(foot); return g; }
};
function build(s) {
  const M = HQ && tier !== 'low' ? HQ.mats(s, env, q) : mats(s), root = new THREE.Group(), model = (MODELS[s.base] || MODELS.cup)(s, M);
  model.scale.setScalar(0.92); const pl = HQ && tier !== 'low' ? HQ.plinth(s, M, q) : plinth(s, M); root.add(model, pl);
  if (HQ && tier !== 'low') HQ.detail(s, M, model, q); root.userData.model = model; return root;
}
function stage(s) {
  const sc = new THREE.Scene(); sc.environment = env;
  sc.add(new THREE.HemisphereLight(0xffffff, 0x334, s.earned ? 0.9 : 0.5));
  const k = new THREE.DirectionalLight(0xffffff, s.earned ? 1.6 : 0.6); k.position.set(2, 3, 4); sc.add(k);
  const rim = new THREE.DirectionalLight(0x9ecbff, s.earned ? 0.9 : 0.2); rim.position.set(-3, 1.5, -2); sc.add(rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 0.45, 5.2); cam.lookAt(0, -0.05, 0);
  const obj = build(s); sc.add(obj); if (HQ && tier !== 'low') HQ.stage(sc, k, obj, q); return { sc, cam, obj };
}
function dispose(o) { o.traverse(x => { x.geometry?.dispose(); x.shadow?.map?.dispose(); const m = x.material; if (m) (Array.isArray(m) ? m : [m]).forEach(mm => mm.dispose()); }); }

function thumb(s) {
  const key = tier + '|' + s.id + '|' + s.earned + '|' + s.tier + '|' + s.accent; if (cache.has(key)) return cache.get(key);
  const r = renderer(); if (!r) return null; const t0 = performance.now();
  const { sc, cam, obj } = stage(s); obj.rotation.y = -0.5 + (s.twist % 40) / 100; r.setPixelRatio(1); r.setSize(q.size, q.size, false); r.render(sc, cam); dispose(sc);
  const out = document.createElement('canvas'); out.width = out.height = q.size; out.getContext('2d').drawImage(r.domElement, 0, 0);
  const tm = times[tier] ||= { n: 0, ms: 0 }; tm.n++; tm.ms += performance.now() - t0;
  cache.set(key, out); return out;
}
let busy = false;
async function pump() { if (busy) return; busy = true; await whenReady();
  while (queue.length) { if (viewerOpen) break; const el = queue.shift(); if (!el.isConnected || el.dataset.t3d === 'done') continue;
    const s = JSON.parse(el.dataset.spec), img = thumb(s); if (!img) { failed = true; break; }
    const c = document.createElement('canvas'); c.width = c.height = q.size; c.className = 't3d'; c.dataset.tier = tier; c.setAttribute('aria-hidden', 'true'); c.getContext('2d').drawImage(img, 0, 0);
    el.replaceChildren(c); el.dataset.t3d = 'done'; el.classList.add('has-3d');
    await new Promise(r => requestAnimationFrame(r)); }
  busy = false; }
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target); } pump(); }, { rootMargin: '200px' }) : null;
export function hydrate(root = document) {
  if (!renderer()) { document.documentElement.classList.add('no-3d'); return false; }
  for (const el of root.querySelectorAll('.t-ic[data-spec]:not([data-t3d])')) { el.dataset.t3d = 'q'; io ? io.observe(el) : queue.push(el); }
  if (!io) pump(); return true;
}

// ---- live viewer (borrows the shared renderer) ----
let viewerOpen = false;
export function openViewer(host, s, { reduced = false } = {}) {
  const r = renderer(); if (!r) return null; viewerOpen = true;
  let stopped = false, raf = 0, cleanup = () => {};
  whenReady().then(() => { if (stopped) return;
    const size = () => Math.max(200, Math.min(host.clientWidth || 320, 420)), dpr = Math.min(devicePixelRatio || 1, q.dpr);
    const { sc, cam, obj } = stage(s); const cv = r.domElement; cv.className = 't3d-live'; cv.dataset.tier = tier; cv.style.width = cv.style.height = size() + 'px'; host.replaceChildren(cv);
    r.setPixelRatio(dpr); r.setSize(size(), size(), false);
    let rotY = -0.5, rotX = 0, vel = reduced ? 0 : 0.006, drag = null, last = performance.now();
    const draw = () => { obj.rotation.set(rotX, rotY, 0); r.render(sc, cam); };
    const down = e => { drag = { x: e.clientX, y: e.clientY, ry: rotY, rx: rotX }; cv.setPointerCapture?.(e.pointerId); };
    const move = e => { if (!drag) return; rotY = drag.ry + (e.clientX - drag.x) * 0.012; rotX = Math.max(-0.6, Math.min(0.6, drag.rx + (e.clientY - drag.y) * 0.008)); if (reduced) draw(); };
    const up = () => { drag = null; };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.style.touchAction = 'none';
    const loop = t => { const dt = Math.min(64, t - last); last = t; if (!drag) rotY += vel * dt / 16; draw(); raf = requestAnimationFrame(loop); };
    if (reduced) draw(); else raf = requestAnimationFrame(loop);
    cleanup = () => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
      dispose(sc); cv.remove(); cv.className = ''; cv.style.cssText = ''; };
  });
  return () => { stopped = true; cancelAnimationFrame(raf); cleanup(); r.setPixelRatio(1); r.setSize(q.size, q.size, false); viewerOpen = false; pump(); };
}
export const stats = () => ({ tier, info, size: q.size, cached: cache.size, failed, queued: queue.length, hqLoaded: !!HQ,
  thumbMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v.ms / v.n * 10) / 10])) });
