// Medium/high-tier extras for the 3D trophies, fetched only when that tier is in use.
// Procedural room environment (no HDR files), physical materials with clearcoat, bevelled/engraved plinths,
// per-model detail meshes, a contact-AO disc and (high only) soft shadows.
import * as THREE from '/vendor/three/three.module.min.js';

// RoomEnvironment-style studio: a dim box room with emissive light panels, prefiltered with PMREM.
export function roomEnv(R) {
  const pm = new THREE.PMREMGenerator(R), sc = new THREE.Scene(), geo = new THREE.BoxGeometry(), mats = [];
  const room = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: 0x7a7f8a, roughness: 1 })); room.scale.set(16, 10, 16); room.position.y = 3; sc.add(room); mats.push(room.material);
  sc.add(new THREE.PointLight(0xffffff, 300, 30, 2));
  const panel = (k, x, y, z, sx, sy, sz, col = 0xffffff) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k) }); mats.push(m); const p = new THREE.Mesh(geo, m); p.position.set(x, y, z); p.scale.set(sx, sy, sz); sc.add(p); };
  panel(9, 0, 7.9, 0, 6, 0.1, 3); panel(6, -7.9, 3, 1, 0.1, 3, 5, 0xbcd6ff); panel(5, 7.9, 4, -2, 0.1, 4, 3, 0xffe3c0); panel(3, 0, 4, -7.9, 8, 2, 0.1); panel(2.5, 3, 1, 7.9, 3, 2, 0.1);
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(geo, room.material); b.position.set(-4 + i * 2.7, -1.5, -3 + (i % 2) * 5); b.scale.set(1.4, 2 + i * 0.6, 1.4); b.rotation.y = i; sc.add(b); }
  const t = pm.fromScene(sc, 0.035).texture; pm.dispose(); geo.dispose(); mats.forEach(m => m.dispose()); return t;
}
const grey = c => { const k = new THREE.Color(c), l = k.r * 0.3 + k.g * 0.59 + k.b * 0.11; return new THREE.Color(l * 0.55 + 0.08, l * 0.55 + 0.09, l * 0.55 + 0.11); };
export function mats(s, env, q) {
  const e = s.earned, hi = !!q.shadow, metal = e ? new THREE.Color(s.metal) : grey(s.metal), acc = e ? new THREE.Color(s.accent) : grey(s.accent);
  const P = o => new THREE.MeshPhysicalMaterial({ envMap: env, ...o });
  return {
    metal: P({ color: metal, metalness: e ? 1 : 0.25, roughness: e ? (s.tier === 'platinum' ? 0.1 : s.tier === 'gold' ? 0.18 : 0.24) : 0.7, envMapIntensity: e ? 1.15 : 0.35,
      clearcoat: e ? 0.6 : 0.15, clearcoatRoughness: 0.12, specularIntensity: 1 }),
    accent: P({ color: acc, metalness: 0.15, roughness: 0.3, envMapIntensity: e ? 0.9 : 0.2, clearcoat: 1, clearcoatRoughness: 0.06, emissive: e ? acc.clone().multiplyScalar(0.18) : new THREE.Color(0) }),
    base: P({ color: e ? 0x23272f : 0x2c2f35, metalness: 0.05, roughness: 0.42, envMapIntensity: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: new THREE.Color(0x404858) }),
    engrave: P({ color: e ? metal.clone().multiplyScalar(0.35) : 0x1d1f24, metalness: e ? 0.9 : 0.1, roughness: 0.6, envMapIntensity: 0.4 }),
    glass: hi ? P({ color: e ? 0xeaf6ff : 0x9a9ea6, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.15, ior: 1.5, envMapIntensity: 1, transparent: true, opacity: 0.95 })
      : P({ color: e ? 0xdff3ff : 0x888c93, transparent: true, opacity: 0.32, roughness: 0.04, metalness: 0, clearcoat: 1, envMapIntensity: 1 }),
    gem: P({ color: e ? s.accent : grey(s.accent), metalness: 0, roughness: 0.04, envMapIntensity: e ? 1.8 : 0.3, flatShading: true, clearcoat: 1, ior: 2.0, specularIntensity: 1,
      ...(hi && e ? { transmission: 0.55, thickness: 0.6, iridescence: 0.25 } : {}) })
  };
}
const V2 = (x, y) => new THREE.Vector2(x, y);
// chamfered/rounded plinth profile: bottom lip, body, bevelled top edge
function profile(r0, r1, h, c, n) { const p = [V2(0, 0), V2(r0 - c, 0)];
  for (let i = 0; i <= n; i++) { const a = i / n * Math.PI / 2; p.push(V2(r0 - c + Math.sin(a) * c, c - Math.cos(a) * c)); }
  p.push(V2(r1, h - c)); for (let i = 0; i <= n; i++) { const a = i / n * Math.PI / 2; p.push(V2(r1 - c + Math.cos(a) * c, h - c + Math.sin(a) * c)); }
  p.push(V2(0, h)); return p; }
export function plinth(s, M, q) {
  const g = new THREE.Group(), kind = s.plinth, n = Math.max(2, q.bevel >> 1), round = Math.round(48 * q.seg), H = 0.34, y0 = -1.3;
  let body;
  if (kind === 1) { const sh = new THREE.Shape(), w = 0.72, r = 0.08; sh.moveTo(-w + r, -w); sh.lineTo(w - r, -w); sh.quadraticCurveTo(w, -w, w, -w + r); sh.lineTo(w, w - r); sh.quadraticCurveTo(w, w, w - r, w); sh.lineTo(-w + r, w); sh.quadraticCurveTo(-w, w, -w, w - r); sh.lineTo(-w, -w + r); sh.quadraticCurveTo(-w, -w, -w + r, -w);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: H - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: q.bevel, curveSegments: 6 }); geo.rotateX(-Math.PI / 2); geo.translate(0, 0.03, 0);
    body = new THREE.Mesh(geo, M.base); }
  else body = new THREE.Mesh(new THREE.LatheGeometry(profile(kind === 2 ? 0.9 : 0.86, kind === 2 ? 0.72 : 0.78, H, 0.035, n), kind === 2 ? 6 : round), M.base);
  body.position.y = y0; if (kind === 2) body.rotation.y = Math.PI / 6; g.add(body); // hex: flat face to the front
  const ringGeo = kind === 1 ? new THREE.BoxGeometry(1.5, 0.05, 1.5) : new THREE.TorusGeometry(kind === 2 ? 0.735 : 0.79, 0.028, Math.round(8 * q.seg), kind === 2 ? 6 : round);
  const band = new THREE.Mesh(ringGeo, M.metal); if (kind !== 1) band.rotation.set(Math.PI / 2, 0, 0); band.position.y = -1.0; g.add(band);
  // engraved grooves around the body
  for (const y of [-1.24, -1.04]) { const gr = new THREE.Mesh(kind === 1 ? new THREE.BoxGeometry(1.475, 0.012, 1.475) : new THREE.TorusGeometry(kind === 2 ? 0.9 - (y + 1.3) * 0.53 : 0.86 - (y + 1.3) * 0.235, 0.008, 4, kind === 2 ? 6 : round), M.engrave);
    if (kind !== 1) gr.rotation.set(Math.PI / 2, 0, 0); gr.position.y = y; g.add(gr); }
  // front plaque with engraved lines and bevelled star studs
  const z = kind === 1 ? 0.755 : kind === 2 ? 0.715 : 0.83, tilt = kind === 2 ? -0.43 : -0.23, pl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.17, 0.02), M.metal); pl.position.set(0, -1.14, z); if (kind !== 1) pl.rotation.x = tilt; g.add(pl);
  for (let i = 0; i < 2; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.44 - i * 0.14, 0.012, 0.012), M.engrave); l.position.set(0, -1.11 - i * 0.05, z + 0.012); if (kind !== 1) l.rotation.x = tilt; g.add(l); }
  for (let i = 0; i < s.stars; i++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, q.shadow ? 1 : 0), M.accent); st.scale.z = 0.5; st.position.set((i - (s.stars - 1) / 2) * 0.16, -1.215, z + 0.03); g.add(st); }
  return g;
}
// extra detail meshes per model type
export function detail(s, M, m, q) {
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); m.add(o); return o; }, seg = n => Math.round(n * q.seg);
  const ring = (r, y, t, mat = M.metal) => add(new THREE.TorusGeometry(r, t, seg(6), seg(48)), mat, 0, y, 0, Math.PI / 2);
  switch (s.base) {
    case 'rocket': ring(0.345, -0.25, 0.018); ring(0.35, 0.3, 0.014, M.engrave); add(new THREE.CylinderGeometry(0.17, 0.24, 0.12, seg(24), 1, true), M.engrave, 0, -0.77, 0);
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; add(new THREE.SphereGeometry(0.014, 6, 4), M.metal, Math.sin(a) * 0.357, 0.05, Math.cos(a) * 0.357); } break;
    case 'cup': ring(0.555, 0.78, 0.02); ring(0.33, -0.12, 0.012, M.engrave); ring(0.13, -0.6, 0.02);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; add(new THREE.BoxGeometry(0.01, 0.2, 0.01), M.engrave, Math.sin(a) * 0.43, 0.08, Math.cos(a) * 0.43, 0, a, 0).rotation.x = 0; } break;
    case 'medal': add(new THREE.TorusGeometry(0.6, 0.025, seg(6), seg(64)), M.accent, 0, 0, 0.04); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; add(new THREE.SphereGeometry(0.018, 6, 4), M.metal, Math.cos(a) * 0.51, Math.sin(a) * 0.51, 0.075); } break;
    case 'globe': for (let i = 1; i < 4; i++) { const t = add(new THREE.TorusGeometry(0.55 * Math.cos(i * 0.38), 0.008, 4, seg(48)), M.engrave, 0, 0.55 * Math.sin(i * 0.38) * (i % 2 ? 1 : -1), 0, Math.PI / 2); t.scale.setScalar(1.01); } ring(0.13, -0.56, 0.02); break;
    case 'hourglass': ring(0.53, 0.82, 0.02); ring(0.53, -0.82, 0.02); break;
    case 'flame': ring(0.55, -0.7, 0.025, M.engrave); break;
    case 'target': add(new THREE.ConeGeometry(0.045, 0.14, seg(10)), M.accent, 0.03, 0.02, 0.03, -Math.PI / 2 + 0.35, 0, 0.3); break;
    case 'crystal': ring(0.44, -0.55, 0.02); ring(0.2, -0.82, 0.015, M.engrave); break;
    case 'bolt': add(new THREE.TorusGeometry(0.82, 0.015, 4, seg(64)), M.engrave, 0, 0, -0.02); break;
  }
}
let aoTex = null;
function ao() { if (aoTex) return aoTex; const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 10, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return aoTex = new THREE.CanvasTexture(c); }
export function stage(sc, key, obj, q) {
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: ao(), transparent: true, depthWrite: false })); disc.material.map = ao(); disc.rotation.x = -Math.PI / 2; disc.position.y = -1.305; sc.add(disc);
  if (!q.shadow) return;
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  const c = key.shadow.camera; c.left = -1.8; c.right = 1.8; c.top = 2; c.bottom = -2; c.near = 0.5; c.far = 12; key.target.position.set(0, -0.3, 0); sc.add(key.target);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}
