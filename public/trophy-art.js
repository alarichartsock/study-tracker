// Trophy art: hand-authored isometric line drawings (one per trophy), in the spirit of Hairline: one thin round-capped stroke,
// rounded solids, hidden lines removed by painting faces back-to-front with the card colour, a faint accent tint, room to breathe.
// Shared grid: 64x64 viewBox, 30deg isometric, origin (32,44), 1 unit = 1px. Colour comes from CSS (currentColor / vars), so light/dark just work.
// Add a group by adding entries to ART keyed by achievement id.
(() => {
  const K = Math.cos(Math.PI / 6), OX = 32, OY = 44, f = n => +n.toFixed(2);
  let YAW = 0; // popup drag turns the view a few degrees about the vertical axis; circles stay circles, so only positions rotate
  const P = (x0, y0, z) => { const c = Math.cos(YAW), s = Math.sin(YAW), x = x0 * c - y0 * s, y = x0 * s + y0 * c; return [f(OX + (x - y) * K), f(OY + (x + y) * 0.5 - z)]; };
  // Hover: AIM = cursor in viewBox units plus strength 0..1 (eased by the caller); each drawing turns one part toward it
  let AIM = null; const AS = () => AIM ? AIM.s : 0, lerp = (a, b, t) => a + (b - a) * t;
  const aimDeg = (z, rest) => { if (!AIM) return rest; const [cx, cy] = P(0, 0, z), sx = (AIM.x - cx) / K, sy = 2 * (AIM.y - cy), x = (sx + sy) / 2, y = (sy - sx) / 2, a = Math.atan2(y, x) * 180 / Math.PI;
    let d = ((a - rest) % 360 + 540) % 360 - 180; return rest + d * AIM.s; };
  const E = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3), B = t => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  const pt = a => a.join(' ');
  const poly = (pts, cls = '') => '<path' + (cls ? ' class="' + cls + '"' : '') + ' d="M' + pts.map(p => pt(P(...p))).join('L') + 'Z"/>';
  const line = (pts, cls = 'l') => '<path class="' + cls + '" d="M' + pts.map(p => pt(P(...p))).join('L') + '"/>';
  // box: top + the two faces that look at the viewer (x+ and y+); the rest is hidden
  const box = (x, y, z, w, d, h, cls = '') => poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], cls) + poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], cls) + poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], 'tp ' + cls);
  // horizontal circle (radius r at height z) as an iso ellipse
  const RX = r => f(r * K * Math.SQRT2), RY = r => f(r * Math.SQRT1_2);
  const ell = (cx, cy, z, r, cls = 'tp') => { const [X, Y] = P(cx, cy, z); return '<ellipse class="' + cls + '" cx="' + X + '" cy="' + Y + '" rx="' + RX(r) + '" ry="' + RY(r) + '"/>'; };
  const cyl = (cx, cy, z, r, h, open) => { const [X, Y0] = P(cx, cy, z), Y1 = f(Y0 - h), a = RX(r), b = RY(r);
    return '<path d="M' + f(X - a) + ' ' + Y1 + 'L' + f(X - a) + ' ' + Y0 + 'A' + a + ' ' + b + ' 0 0 0 ' + f(X + a) + ' ' + Y0 + 'L' + f(X + a) + ' ' + Y1 + '"/>' + (open ? '' : ell(cx, cy, z + h, r)); };
  const arc = (cx, cy, z, r, cls) => { const [X, Y] = P(cx, cy, z), a = RX(r), b = RY(r); return '<path class="' + cls + '" d="M' + f(X - a) + ' ' + Y + 'A' + a + ' ' + b + ' 0 0 0 ' + f(X + a) + ' ' + Y + '"/>'; }; // front half only
  const onRim = (cx, cy, z, r, deg) => { const t = deg * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t), z]; };
  // High quality: a few exhaust puffs drifting down and out under the rocket while it lifts
  const trail = p => [0, 1, 2, 3, 4].map(i => { const q = Math.min(1, Math.max(0, p * 1.6 - i * .12)); if (!q || q >= 1) return ''; const a = i * 72 * Math.PI / 180, d = 2 + q * 6; return ell(Math.cos(a) * d, Math.sin(a) * d, 2.5 + 4 * (1 - q), .5 + q * 1.4, 'l a pf'); }).join('');
  // ---- shared primitives for every group (same grid, stroke and hidden-line rules as Launch Pad) ----
  const S = (x, y, z) => P(x, y, z); // screen point
  const pth = (pts, cls = '', closed = true) => '<path' + (cls ? ' class="' + cls + '"' : '') + ' d="M' + pts.map(q => pt(P(...q))).join('L') + (closed ? 'Z' : '') + '"/>';
  // vertical circle: pl 'y' = in the plane y=c (faces the left/front, spans x,z); pl 'x' = in the plane x=c (faces right/front, spans y,z)
  const vpts = (cx, cy, cz, r, pl, a0 = 0, a1 = 360, n = 28) => Array.from({ length: n + 1 }, (_, i) => { const t = (a0 + (a1 - a0) * i / n) * Math.PI / 180, u = r * Math.cos(t), v = r * Math.sin(t); return pl === 'y' ? [cx + u, cy, cz + v] : [cx, cy + u, cz + v]; });
  const vc = (cx, cy, cz, r, pl, cls = 'tp') => pth(vpts(cx, cy, cz, r, pl), cls);
  const va = (cx, cy, cz, r, pl, a0, a1, cls = 'l') => pth(vpts(cx, cy, cz, r, pl, a0, a1, 16), cls, false);
  // vertical disc with thickness (medal, wheel, coin on edge): back face, rim, front face
  const vdisc = (cx, cy, cz, r, pl, t, cls = 'tp') => { const o = pl === 'y' ? [0, t, 0] : [t, 0, 0], b = vpts(cx, cy, cz, r, pl), f2 = b.map(q => [q[0] + o[0], q[1] + o[1], q[2]]);
    return pth(b, '') + pth(f2, cls); };
  // seven-segment digits on a vertical plane (pl 'y': text runs along +x; pl 'x': along -y so it reads left to right on screen)
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', K: 'fegbc' };
  const digits = (str, ox, oy, oz, h, pl = 'y', cls = 'l a') => { const w = h * .55, g = h * .3; let s = '';
    [...String(str)].forEach((ch, i) => { const segs = SEG[ch] || ''; const u0 = i * (w + g), Q = (u, v) => pl === 'y' ? [ox + u0 + u, oy, oz + v] : [ox, oy - u0 - u, oz + v];
      const L = { a: [[0, h], [w, h]], b: [[w, h], [w, h / 2]], c: [[w, h / 2], [w, 0]], d: [[w, 0], [0, 0]], e: [[0, 0], [0, h / 2]], f: [[0, h / 2], [0, h]], g: [[0, h / 2], [w, h / 2]] };
      for (const k of segs) s += line(L[k].map(([u, v]) => Q(u, v)), cls); }); return s; };
  // screen-space marks (stars, flames, sparks) anchored at a 3D point
  const star = (x, y, z, r, cls = 'hl', rot = -90) => { const [X, Y] = S(x, y, z); return '<path class="' + cls + '" d="M' + Array.from({ length: 10 }, (_, i) => { const t = (rot + i * 36) * Math.PI / 180, q = i % 2 ? r * .45 : r; return f(X + q * Math.cos(t)) + ' ' + f(Y + q * Math.sin(t)); }).join('L') + 'Z"/>'; };
  const flame = (x, y, z, h, lean = 0, cls = 'hl') => { const [X, Y] = S(x, y, z), w = h * .36, tx = X + lean * h * .5, ty = Y - h;
    return '<path class="' + cls + '" d="M' + f(X) + ' ' + f(Y) + 'C' + f(X - w * 1.4) + ' ' + f(Y - h * .2) + ' ' + f(X - w * .5) + ' ' + f(Y - h * .7) + ' ' + f(tx) + ' ' + f(ty) + 'C' + f(X + w * .6) + ' ' + f(Y - h * .65) + ' ' + f(X + w * 1.4) + ' ' + f(Y - h * .2) + ' ' + f(X) + ' ' + f(Y) + 'Z"/>'; };
  const ball = (x, y, z, r, cls = 'tp') => { const [X, Y] = S(x, y, z); return '<circle class="' + cls + '" cx="' + X + '" cy="' + Y + '" r="' + f(r) + '"/>' + '<path class="l d" d="M' + f(X - r) + ' ' + Y + 'A' + f(r) + ' ' + f(r * .38) + ' 0 0 0 ' + f(X + r) + ' ' + Y + '"/>'; };
  const ray = (x, y, z, r0, r1, deg) => { const [X, Y] = S(x, y, z), t = deg * Math.PI / 180; return '<path class="l a" d="M' + f(X + r0 * Math.cos(t)) + ' ' + f(Y + r0 * Math.sin(t)) + 'L' + f(X + r1 * Math.cos(t)) + ' ' + f(Y + r1 * Math.sin(t)) + '"/>'; };
  const plate = (w = 26, d = 26, h = 2) => box(-w / 2, -d / 2, 0, w, d, h);
  // hover helpers: how strongly the cursor is near a 3D point (0..1, eased by AIM.s); cursor x/y as -1..1
  const near = (q, sig = 60) => { if (!AIM) return 0; const [X, Y] = S(...q); return AIM.s * Math.exp(-((X - AIM.x) ** 2 + (Y - AIM.y) ** 2) / sig); };
  const ax = () => AIM ? AIM.s * Math.max(-1, Math.min(1, (AIM.x - 32) / 24)) : 0, ay = () => AIM ? AIM.s * Math.max(-1, Math.min(1, (AIM.y - 30) / 24)) : 0;
  const nearest = qs => { if (!AIM || AIM.s < .05) return -1; let b = 1e9, k = -1; qs.forEach((q, i) => { const [X, Y] = S(...q), d = (X - AIM.x) ** 2 + (Y - AIM.y) ** 2; if (d < b) { b = d; k = i; } }); return k; };
  const sq = (p, i, n, span = .5) => E((p - i * (1 - span) / Math.max(1, n - 1)) / span); // staggered per-item progress for click actions
  const shown = p => p >= 1 ? 1 : 0;
  // surface of revolution silhouette (profile [[radius, z], ...] bottom to top) about a vertical axis
  const rev = (prof, cls = 'tp', cx = 0, cy = 0) => { const side = sg => prof.map(([r, z]) => { const [X, Y] = S(cx, cy, z); return f(X + sg * RX(r)) + ' ' + f(Y); });
    return '<path class="' + cls + '" d="M' + side(-1).join('L') + 'L' + side(1).reverse().join('L') + 'Z"/>'; };
  // screen-space convex hull of 3D points (silhouette of a lying cylinder, a gem, a bell...)
  const hull = (pts, cls = 'tp') => { const q = pts.map(v => P(...v)).sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of q.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const h = lo.slice(0, -1).concat(up.slice(0, -1)); return '<path class="' + cls + '" d="M' + h.map(pt).join('L') + 'Z"/>'; };
  // a cylinder lying along x (log, barbell bar, roller): body silhouette + the visible end at x1
  const xcyl = (x0, x1, cy, cz, r, cls = 'tp', endCls = 'hl') => hull([...vpts(x0, cy, cz, r, 'x'), ...vpts(x1, cy, cz, r, 'x')], cls) + vc(x1, cy, cz, r, 'x', endCls);
  const ART = {
    // Liftoff: a rocket just off its pad, three exhaust dashes beneath
    first: (p = 1) => { const r = 5, nose = (z0, h) => '<path class="tp" d="M' + pt(P(...onRim(0, 0, z0, r, 135))) + 'C' + pt(P(...onRim(0, 0, z0 + h * .55, r, 135))) + ' ' + pt(P(-1.2, 1.2, z0 + h * .9)) + ' ' + pt(P(AS() * (AIM ? (AIM.x - 32) / 26 : 0) * 2.4, -AS() * (AIM ? (AIM.x - 32) / 26 : 0) * 2.4, z0 + h)) + 'C' + pt(P(1.2, -1.2, z0 + h * .9)) + ' ' + pt(P(...onRim(0, 0, z0 + h * .55, r, -45))) + ' ' + pt(P(...onRim(0, 0, z0, r, -45))) + '"/>';
      const L = 2.5 + 7 * B(p), X = 3.5 * B(p * 1.15); return box(-12, -12, 0, 24, 24, 2.5) + ell(0, 0, 2.5, 3.2 + X * .6, 'l d') + line([[0, 0, 4.5], [0, 0, 8 + L - 2.5]], 'l a') + line([[2.2, 2.2, 5.2 - X * .3], [2.2, 2.2, 7.6 + L - 2.5]], 'l a') + line([[-2.2, -2.2, 5.2 - X * .3], [-2.2, -2.2, 7.6 + L - 2.5]], 'l a') +
        cyl(0, 0, 9 + L, r, 13, 1) + poly([[3.5, -3.5, 9.5 + L], [7.8, -7.8, 8 + L], [7.8, -7.8, 12.5 + L], [3.5, -3.5, 16 + L]]) + poly([[-3.5, 3.5, 9.5 + L], [-7.8, 7.8, 8 + L], [-7.8, 7.8, 12.5 + L], [-3.5, 3.5, 16 + L]]) +
        nose(22 + L, 10) + arc(0, 0, 22 + L, r, 'l d') + arc(0, 0, 11 + L, r, 'l d') + ell(2.6, 2.6, 18.2 + L, 1.5, 'l a'); },
    // Week Zero: seven day-tiles rising like steps
    week1: (p = 1) => Array.from({ length: 7 }, (_, i) => box(-17.5 + i * 5, -2.2, 0, 4.2, 4.2, 0.4 + (2.1 + i * 2.2) * E(p * 1.9 - i * 0.13) + (AIM ? 4 * AIM.s * Math.exp(-Math.pow(P(-15.4 + i * 5, 0, 0)[0] - AIM.x, 2) / 40) : 0), i === 6 ? 'hl' : '')).join(''),
    // Clock In: a stopwatch puck, ticks round the face, hand set, crown on top
    timer1: (p = 1) => cyl(0, 0, 0, 13, 4) + Array.from({ length: 12 }, (_, i) => line([onRim(0, 0, 4, i % 3 ? 11 : 10, i * 30), onRim(0, 0, 4, 12, i * 30)], 'l' + (i % 3 ? ' d' : ''))).join('') +
      line([[0, 0, 4], onRim(0, 0, 4, 8.5, aimDeg(4, -100) + 360 * E(p))], 'l a') + line([[0, 0, 4], onRim(0, 0, 4, 5.5, -10)], 'l') + ell(0, 0, 4, 0.9, 'l a') + cyl(-9.2, -9.2, 4, 1.6, 3.5) + box(-10.6, -10.6, 7.5, 2.8, 2.8, 1.2),
    // Aim High: a target disc with an arrow home in the bull
    subjgoal: (p = 1) => { const d = 14 * (1 - E(p * 1.4)), w = p > .72 && p < 1 ? Math.sin((p - .72) * 40) * (1 - p) * 4 : 0, g = AIM ? AIM.s * (AIM.x - 32) / 26 * 5 : 0, h = AIM ? AIM.s * (AIM.y - 30) / 26 * 4 : 0, A = ([x, y, z]) => { const t = (z - 1.6) / 17.4; return [x - d * .37 + w - g * t, y - d * .37 - w + g * t, z + d * .85 + h * t]; };
      return cyl(0, 0, 0, 13, 1.6) + ell(0, 0, 1.6, 8.8, 'l') + ell(0, 0, 1.6, 4.6, 'l') + ell(0, 0, 1.6, 1.2 + (p > .7 && p < 1 ? 2.5 * (1 - p) * 3 : 0), 'l a') + [
      [[0, 0, 1.6], [-7, -7, 19]], [[-5.6, -5.6, 15.5], [-5.2, -8.8, 17.4]], [[-5.6, -5.6, 15.5], [-8.8, -5.2, 17.4]], [[-6.6, -6.6, 18], [-6.2, -9.8, 19.9]], [[-6.6, -6.6, 18], [-9.8, -6.2, 19.9]]].map(q => line(q.map(A), 'l a')).join(''); },
    // Ready Room: a doorway with its door swung open toward you
    onboard: (p = 1) => { const a = (lerp(60, AIM ? 10 + 80 * Math.min(1, Math.max(0, (AIM.x - 8) / 48)) : 60, AS()) - 52 * B(p)) * Math.PI / 180, hx = -6.8 + 13.2 * Math.sin(a) * 0 , dx = -6.8 + 13.2 * Math.cos(Math.PI / 2 - a) * 0; const ex = -6.8 + 13.2 * Math.cos(a), ey = -0.8 + 13.2 * Math.sin(a); return box(-13, -6, 0, 26, 18, 1.5) + box(-9, -3, 1.5, 2.2, 2.2, 22) + box(6.8, -3, 1.5, 2.2, 2.2, 22) + box(-9, -3, 23.5, 18, 2.2, 2.2) +
      line([[-6.8, -0.8, 1.5], [6.8, -0.8, 1.5]], 'l d') + poly([[-6.8, -0.8, 1.5], [-6.8, -0.8, 23.5], [ex, ey, 23.5], [ex, ey, 1.5]], 'hl') + ell(-6.8 + 10.6 * Math.cos(a), -0.8 + 10.6 * Math.sin(a), 12.5, 0.7, 'l a'); },
    // Knob Turner: a dial on a plate, scale ticks, indicator turned past centre
    tinker: (p = 1, turn = 0) => box(-12, -12, 0, 24, 24, 2.5) + Array.from({ length: 9 }, (_, i) => line([onRim(0, 0, 2.5, 9, 90 + i * 30), onRim(0, 0, 2.5, i === 6 ? 11.4 : 10.4, 90 + i * 30)], 'l' + (i === 6 ? ' a' : ' d'))).join('') +
      cyl(0, 0, 2.5, 6.6, 5.5) + ell(0, 0, 8, 4.8, 'l d') + line([[0, 0, 8], onRim(0, 0, 8, 5.6, aimDeg(8, 270 + turn))], 'l a'),
    // Grand Tour: a 3x3 map of tiles with a route that visits each one, flag at the end
    explore: (p = 1) => { let s = ''; for (let k = 0; k <= 4; k++) for (let i = 0; i < 3; i++) { const j = k - i; if (j < 0 || j > 2) continue; s += box(-11 + i * 7.6, -11 + j * 7.6, 0, 6, 6, 1.4); }
      const c = (i, j) => [-8 + i * 7.6, -8 + j * 7.6, 1.4], R = [c(0, 0), c(1, 0), c(2, 0), c(2, 1), c(1, 1), c(0, 1), c(0, 2), c(1, 2), c(2, 2)];
      let near = R.length - 1; if (AIM && AIM.s > .05) { let bd = 1e9; R.forEach((q, i) => { const [X, Y] = P(...q), dd = (X - AIM.x) ** 2 + (Y - AIM.y) ** 2; if (dd < bd) { bd = dd; near = i; } }); }
      const n = (AIM && AIM.s > .05 ? lerp(R.length - 1, near, AIM.s) : (R.length - 1) * E(p)), k = Math.floor(n), Rp = R.slice(0, k + 1).concat(k < R.length - 1 ? [R[k].map((v, i) => v + (R[k + 1][i] - v) * (n - k))] : []);
      return s + (p < 1 || (AIM && AIM.s > .05) ? line(R, 'l d dd') + line(Rp, 'l a') : line(R, 'l a dd')) + ell(...c(0, 0), 1, 'l a') + ell(...c(2, 2), 1.9, 'l a') + ell(...c(2, 2), 0.6, 'l a'); },
    // Thirty Down: a month of pages stacked, the top one ruled and checked. Hover lifts the top page a little at its front edge
    // (hinged on the back edge, more as the cursor rises); tap turns it up and lets it fall back. Rest = flat, no flap.
    month1: (p = 1) => { const lift = AIM ? AIM.s * (.12 + .38 * Math.min(1, Math.max(0, (52 - AIM.y) / 40))) : 0, a = Math.max(lift, 1.1 * B(p)),
        Q = (x, y) => [x, -11 + (y + 11) * Math.cos(a), 8.8 + (y + 11) * Math.sin(a)], top = a > .01;
      const ruled = M => [1, 2, 3, 4].map(k => line([M(-11 + k * 4.4, -11), M(-11 + k * 4.4, 11)], 'l w d')).join('') + [1, 2, 3, 4].map(k => line([M(-11, -11 + k * 4.4), M(11, -11 + k * 4.4)], 'l w d')).join('') + line([M(-4, 3), M(0, 7), M(8, -5)], 'l a w');
      const flat = (x, y) => [x, y, 8.8];
      return [0, 2.4, 4.8, 7.2].map((z, i) => box(-11, -11, z, 22, 22, 1.6, i === 3 ? 'hl' : '')).join('') + (top ? poly([Q(-11, -11), Q(11, -11), Q(11, 11), Q(-11, 11)].map(([x, y, z]) => [x, y, z + .05]), 'hl') + ruled((x, y) => { const [X, Y, Z] = Q(x, y); return [X, Y, Z + .05]; }) : ruled(flat)); },
    // ---- Total time ----
    // Hour Zero: an hourglass; the sand stream sways toward the cursor; tap pours the top bulb into the bottom
    h1: (p = 1) => { const t = E(p), sw = ax() * 1.6, [nx, ny] = S(0, 0, 13), [bx, by] = S(0, 0, 3.5 + 6 * t);
      return cyl(0, 0, 0, 10, 2) + rev([[7, 2], [7.4, 5], [5.5, 9], [1, 13], [5.5, 17], [7.4, 21], [7, 24]]) +
        rev([[6.4 * Math.max(.15, t), 2.4], [5.2 * t, 2.4 + 4 * t], [.6, 2.4 + 6.4 * t]], 'hl') + (t < .98 ? rev([[.8, 13.4], [5 * (1 - t), 13.4 + 5 * (1 - t) ** .6], [6.4 * (1 - t), 13.6 + 6 * (1 - t) ** .6]], 'hl') : '') +
        '<path class="l a" d="M' + nx + ' ' + ny + 'Q' + f(nx + sw) + ' ' + f((ny + by) / 2) + ' ' + f(bx + sw * 1.4) + ' ' + f(by) + '"/>' + cyl(0, 0, 24, 10, 2) + line([[-6.4, 6.4, 2], [-6.4, 6.4, 24]], 'l') + line([[6.4, -6.4, 2], [6.4, -6.4, 24]], 'l d'); },
    // Warm Engine: an engine block with four pistons; the piston under the cursor rises; tap fires them in order
    h10: (p = 1) => { let s = box(-13, -7, 0, 26, 14, 9); const xs = [-9, -3, 3, 9], hk = nearest(xs.map(x => [x, 0, 12]));
      xs.forEach((x, i) => { const up = 3 + (i === hk ? 5 * AIM.s : 0) + 6 * B(sq(p, i, 4, .4)); s += cyl(x, 0, 9, 2.4, up) + line([[x, 0, 9 + up], [x, 0, 9 + up + 1.2]], 'l a'); });
      return s + line([[-13, 7, 3], [13, 7, 3]], 'l d') + line([[-11, 7, 6], [-5, 7, 6]], 'l a'); },
    // Quarter Mark: a clock face with the first quarter filled; the hand points at the cursor; tap sweeps the quarter
    h25: (p = 1) => { const q = 90 * E(p), w = [[0, 0, 3], ...Array.from({ length: 13 }, (_, i) => onRim(0, 0, 3, 11, -90 + q * i / 12))];
      return cyl(0, 0, 0, 13, 3) + (q > 1 ? pth(w, 'hl') : '') + Array.from({ length: 4 }, (_, i) => line([onRim(0, 0, 3, 9.5, i * 90), onRim(0, 0, 3, 12, i * 90)], 'l')).join('') +
        line([[0, 0, 3], onRim(0, 0, 3, 10, aimDeg(3, -90 + q))], 'l a w') + line([[0, 0, 3], onRim(0, 0, 3, 6, -90)], 'l') + ell(0, 0, 3, 1, 'l a'); },
    // Fifty Club: a measuring cylinder filled to the 50 line; the level follows the cursor; tap fills it with a slosh
    h50: (p = 1) => { const lv = Math.max(2, Math.min(20, 2 + 9 * E(p) + (p > .6 && p < 1 ? Math.sin(p * 30) * (1 - p) * 3 : 0) - ay() * 8));
      let s = cyl(0, 0, 0, 10, 1.5) + cyl(0, 0, 1.5, 6, lv, 0).replace('<path', '<path class="hl"') + ell(0, 0, 1.5 + lv, 6, 'hl') + cyl(0, 0, 1.5, 6, 21, 1).replace('<path', '<path class="l"');
      for (let k = 1; k <= 4; k++) s += line([onRim(0, 0, 1.5 + k * 4.4, 6, 120), onRim(0, 0, 1.5 + k * 4.4, 6, k === 2 ? 75 : 100)], 'l' + (k === 2 ? ' a' : ' d'));
      return s + digits('50', 7.2, 2, 9.5, 3, 'x', 'l a'); },
    // Triple Digits: three tiles reading 100; the tile under the cursor lifts; tap rolls the digits in like an odometer
    h100: (p = 1) => ['1', '0', '0'].map((d, i) => { const y = 8 - i * 9.4, z = 2.5 * near([4, y - 4, 8], 50) + 4 * B(sq(p, i, 3, .5)); return box(-4, y - 8.6, z, 8, 8.6, 12, i ? '' : 'hl') + (sq(p, i, 3, .5) > .5 || p >= 1 ? digits(d, 4, y - (d === '1' ? 1.2 : 2.4), z + 2.4, 7.4, 'x', 'l a w') : ''); }).reverse().join(''),
    // Deep Roots: a tree on a cut-away plot, roots spreading below; the crown sways toward the cursor; tap grows the roots
    h250: (p = 1) => { const g = E(p), sw = ax() * 2.4, [tx, ty] = S(0, 0, 18);
      let s = box(-12, -12, -8, 24, 24, 8) + [[-7, 3], [-3, 6], [3, 5], [7, 2], [1, -4]].map(([x, y], i) => line([[0, 0, -.2], [x * .5 * g, y * .5 * g, -3 * g], [x * g, y * g, -6.5 * g]], 'l a')).join('');
      s += cyl(0, 0, 0, 1.6, 13) + ball(-4 + sw, 3, 17, 5.2, 'hl') + ball(4 + sw, -3, 17.5, 5.2, 'hl') + ball(sw * 1.2, 0, 22, 6, 'hl');
      return s + line([[-12, 12, -3], [12, 12, -3]], 'l d'); },
    // Long Game: a pawn far up a chessboard, its long path behind it; the pawn steps toward the cursor's file; tap advances it
    h300: (p = 1) => { let s = ''; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += box(-12 + i * 6, -12 + j * 6, 0, 6, 6, 1.5, (i + j) % 2 ? 'hl' : '');
      const j = 3 - 2.6 * E(p), i = 1.5 + ax() * 1.2, cx = -9 + i * 6, cy = -9 + j * 6;
      return s + line([[cx, 12, 1.5], [cx, cy, 1.5]], 'l a dd') + rev([[4.6, 1.5], [4.6, 3.6], [2, 6.5], [1.6, 12], [3.2, 13.4], [1.6, 14.6]], 'tp', cx, cy) + ball(cx, cy, 17.5, 3.6); },
    // Half-K: an oval track with a runner halfway round; the runner follows the cursor round the track; tap runs the half lap
    h500: (p = 1) => { const T = a => [Math.cos(a) * 13, Math.sin(a) * 7, 1.6], pts = Array.from({ length: 41 }, (_, i) => T(i / 40 * 2 * Math.PI)), inn = pts.map(([x, y]) => [x * .66, y * .45, 1.6]);
      let a = Math.PI * E(p); if (AIM && AIM.s > .05) { const [cx, cy] = S(0, 0, 1.6); a = lerp(a, Math.atan2((AIM.y - cy) * 2, (AIM.x - cx) / K) - Math.PI / 4, AIM.s); }
      const half = Array.from({ length: 21 }, (_, i) => T(i / 40 * 2 * Math.PI));
      return box(-15, -9, 0, 30, 18, 1.6) + pth(pts, 'l') + pth(inn, 'l d') + pth(half, 'l a w', false) + line([T(0), [T(0)[0] * .66, 0, 1.6]], 'l a') + ball(...T(a).map((v, i) => i === 2 ? v + 2.2 : v), 1.8, 'hl'); },
    // The Thousand: a tower of ten blocks; the top block lifts toward the cursor; tap drops the blocks in one by one
    h1000: (p = 1) => { let s = ''; for (let k = 0; k < 10; k++) { const t = sq(p, k, 10, .3), z = k * 2.6 + (1 - t) * 14 + (k === 9 ? 3 * near([0, 0, 26], 80) : 0); if (t > 0) s += box(-5, -5, z, 10, 10, 2.2, k === 9 ? 'hl' : ''); } return cyl(0, 0, -1.5, 10, 1.5) + s; },
    // Ten Logged: a slate with ten tally marks; the mark under the cursor lifts; tap strikes the bundles
    n10: (p = 1) => { let s = box(-13, -9, 0, 26, 18, 2); const gk = nearest([[-5.4, 0, 2], [5.6, 0, 2]]); for (let k = 0; k < 10; k++) { const g = Math.floor(k / 5), x = -9 + g * 11 + (k % 5) * 1.8, h = g === gk ? 1.6 * AIM.s : 0; if (k % 5 < 4) s += line([[x, -5, 2 + h], [x, 5, 2 + h]], 'l a'); }
      for (let g = 0; g < 2; g++) { const t = sq(p, g, 2, .6); if (t > 0) s += line([[-10 + g * 11, 5, 2], [-10 + g * 11 + 8.4 * t, 5 - 10 * t, 2]], 'l a w'); } return s; },
    // Fifty Logged: a stack of index cards; the top card slides toward the cursor; tap fans the stack
    n50: (p = 1) => { let s = ''; const sl = ax() * 4, fan = B(p); for (let k = 0; k < 4; k++) { const dx = k === 3 ? sl : 0, rot = fan * (k - 1.5) * 2.2; s += box(-10 + dx + rot, -7 - rot * .4, k * 2.6, 20, 14, 1, k === 3 ? 'hl' : ''); }
      return s + [0, 1, 2].map(r => line([[-7 + sl, -4 + r * 3.4, 8.8], [7 + sl, -4 + r * 3.4, 8.8]], 'l' + (r ? ' d' : ' a'))).join(''); },
    // Century Log: a cut log with growth rings on its end; the rings ripple toward the cursor; tap counts the rings outward
    n100: (p = 1) => { let s = box(-14, -9, 0, 28, 18, 1) + xcyl(-11, 9, 0, 8.4, 7.2); const rip = near([9, 0, 8.4], 90);
      for (let k = 1; k <= 4; k++) { const t = sq(p, k - 1, 4, .5); if (t > 0) s += vc(9, 0, 8.4, (k * 1.45 + rip * .5 * Math.sin(k * 2)) * t, 'x', 'l' + (k % 2 ? ' a' : ' d')); }
      return s + line([[-6, 0, 15.6], [3, 0, 15.6]], 'l d') + ell(9, 0, 8.4, .1, 'l a'); },
    // Logbook: an open book; the right page lifts toward the cursor; tap turns a page
    n300: (p = 1) => { const lift = Math.max(1.1 * B(p), AIM ? AIM.s * (.12 + .38 * Math.min(1, Math.max(0, (52 - AIM.y) / 40))) : 0), Q = (x, y) => [x * Math.cos(lift), y, 2 + x * Math.sin(lift)];
      let s = box(-14, -9, 0, 28, 18, 1.4) + pth([[-13, -8, 2], [0, -8, 2.6], [0, 8, 2.6], [-13, 8, 2]], 'tp') + pth([[0, -8, 2.6], [13, -8, 2], [13, 8, 2], [0, 8, 2.6]], 'tp');
      for (let r = 0; r < 4; r++) s += line([[-11, -5 + r * 3.4, 2.3], [-2, -5 + r * 3.4, 2.6]], 'l d') + line([[2, -5 + r * 3.4, 2.6], [11, -5 + r * 3.4, 2.3]], 'l' + (r ? ' d' : ' a'));
      return s + (lift > .02 ? pth([Q(0, -8), Q(13, -8), Q(13, 8), Q(0, 8)].map(([x, y, z]) => [x, y, z + .6]), 'hl') : ''); },
    // The Archive: a filing cabinet; the drawer at the cursor's height slides out; tap opens each drawer in turn
    n500: (p = 1) => { let s = box(-7, -8, 0, 14, 16, 26); const k = AIM && AIM.s > .05 ? Math.max(0, Math.min(3, Math.floor((S(0, 8, 0)[1] - AIM.y) / 6.5))) : -1;
      for (let d = 3; d >= 0; d--) { const o = (d === k ? 4 * AIM.s : 0) + 5 * B(sq(p, d, 4, .45)), z = 1 + d * 6.2; s += (o > .3 ? box(-6, -7, z, 13.5 + o, 14, 5.4, 'hl') : poly([[7.5, -7, z], [7.5, 7, z], [7.5, 7, z + 5.4], [7.5, -7, z + 5.4]])) + line([[7.5 + o, -2, z + 3.2], [7.5 + o, 2, z + 3.2]], 'l a'); }
      return s; },
  };
  const inner = (id, p = 1, o = {}) => { YAW = (o.yaw || 0) * Math.PI / 180; AIM = o.aim && o.aim.s > 0.002 ? o.aim : null; const h = (ART[id](p, o.turn || 0) + (o.rich && id === 'first' && p > 0 && p < 1 ? trail(p) : '')).replace(/<(path|ellipse|circle)/g, '<$1 pathLength="1"'); YAW = 0; AIM = null; return h; };
  const svg = (id, p, o) => ART[id] ? '<svg class="ta" viewBox="6 5 52 52" aria-hidden="true">' + inner(id, p, o) + '</svg>' : '';
  const DUR = { first: 1300, week1: 1100, timer1: 1200, subjgoal: 900, onboard: 1300, tinker: 500, explore: 1300, month1: 900 }; for (const k in ART) DUR[k] ||= 1000;
  // personal trophies (per subject/activity) share one drawing per tier: 'subject:cars:h10' -> 'p-h10'
  const key = x => { const id = typeof x === 'string' ? x : x && x.id; if (!id) return ''; if (ART[id]) return id; const m = /:(h|n)(\d+)$/.exec(id); return m && ART['p-' + m[1] + m[2]] ? 'p-' + m[1] + m[2] : ''; };
  window.TrophyArt = { has: x => !!key(x), key, svg, inner, ids: Object.keys(ART), DUR };
})();
