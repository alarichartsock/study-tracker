// Trophy art: hand-authored isometric line drawings (one per trophy), in the spirit of Hairline: one thin round-capped stroke,
// rounded solids, hidden lines removed by painting faces back-to-front with the card colour, a faint accent tint, room to breathe.
// Shared grid: 64x64 viewBox, 30deg isometric, origin (32,44), 1 unit = 1px. Colour comes from CSS (currentColor / vars), so light/dark just work.
// Add a group by adding entries to ART keyed by achievement id.
(() => {
  const K = Math.cos(Math.PI / 6), OX = 32, OY = 44, f = n => +n.toFixed(2);
  const P = (x, y, z) => [f(OX + (x - y) * K), f(OY + (x + y) * 0.5 - z)];
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
  const ART = {
    // Liftoff: a rocket just off its pad, three exhaust dashes beneath
    first: () => { const r = 5, nose = (z0, h) => '<path class="tp" d="M' + pt(P(...onRim(0, 0, z0, r, 135))) + 'C' + pt(P(...onRim(0, 0, z0 + h * .55, r, 135))) + ' ' + pt(P(-1.2, 1.2, z0 + h * .9)) + ' ' + pt(P(0, 0, z0 + h)) + 'C' + pt(P(1.2, -1.2, z0 + h * .9)) + ' ' + pt(P(...onRim(0, 0, z0 + h * .55, r, -45))) + ' ' + pt(P(...onRim(0, 0, z0, r, -45))) + '"/>';
      const L = 2.5; return box(-12, -12, 0, 24, 24, 2.5) + ell(0, 0, 2.5, 3.2, 'l d') + line([[0, 0, 4.5], [0, 0, 8]], 'l a') + line([[2.2, 2.2, 5.2], [2.2, 2.2, 7.6]], 'l a') + line([[-2.2, -2.2, 5.2], [-2.2, -2.2, 7.6]], 'l a') +
        cyl(0, 0, 9 + L, r, 13, 1) + poly([[3.5, -3.5, 9.5 + L], [7.8, -7.8, 8 + L], [7.8, -7.8, 12.5 + L], [3.5, -3.5, 16 + L]]) + poly([[-3.5, 3.5, 9.5 + L], [-7.8, 7.8, 8 + L], [-7.8, 7.8, 12.5 + L], [-3.5, 3.5, 16 + L]]) +
        nose(22 + L, 10) + arc(0, 0, 22 + L, r, 'l d') + arc(0, 0, 11 + L, r, 'l d') + ell(2.6, 2.6, 18.2 + L, 1.5, 'l a'); },
    // Week Zero: seven day-tiles rising like steps
    week1: () => Array.from({ length: 7 }, (_, i) => box(-17.5 + i * 5, -2.2, 0, 4.2, 4.2, 2.5 + i * 2.2, i === 6 ? 'hl' : '')).join(''),
    // Clock In: a stopwatch puck, ticks round the face, hand set, crown on top
    timer1: () => cyl(0, 0, 0, 13, 4) + Array.from({ length: 12 }, (_, i) => line([onRim(0, 0, 4, i % 3 ? 11 : 10, i * 30), onRim(0, 0, 4, 12, i * 30)], 'l' + (i % 3 ? ' d' : ''))).join('') +
      line([[0, 0, 4], onRim(0, 0, 4, 8.5, -100)], 'l a') + line([[0, 0, 4], onRim(0, 0, 4, 5.5, -10)], 'l') + ell(0, 0, 4, 0.9, 'l a') + cyl(-9.2, -9.2, 4, 1.6, 3.5) + box(-10.6, -10.6, 7.5, 2.8, 2.8, 1.2),
    // Aim High: a target disc with an arrow home in the bull
    subjgoal: () => cyl(0, 0, 0, 13, 1.6) + ell(0, 0, 1.6, 8.8, 'l') + ell(0, 0, 1.6, 4.6, 'l') + ell(0, 0, 1.6, 1.2, 'l a') +
      line([[0, 0, 1.6], [-7, -7, 19]], 'l a') + line([[-5.6, -5.6, 15.5], [-5.2, -8.8, 17.4]], 'l a') + line([[-5.6, -5.6, 15.5], [-8.8, -5.2, 17.4]], 'l a') + line([[-6.6, -6.6, 18], [-6.2, -9.8, 19.9]], 'l a') + line([[-6.6, -6.6, 18], [-9.8, -6.2, 19.9]], 'l a'),
    // Ready Room: a doorway with its door swung open toward you
    onboard: () => box(-13, -6, 0, 26, 18, 1.5) + box(-9, -3, 1.5, 2.2, 2.2, 22) + box(6.8, -3, 1.5, 2.2, 2.2, 22) + box(-9, -3, 23.5, 18, 2.2, 2.2) +
      line([[-6.8, -0.8, 1.5], [6.8, -0.8, 1.5]], 'l d') + poly([[-6.8, -0.8, 1.5], [-6.8, -0.8, 23.5], [-0.2, 10.6, 23.5], [-0.2, 10.6, 1.5]], 'hl') + ell(-1.6, 8.2, 12.5, 0.7, 'l a'),
    // Knob Turner: a dial on a plate, scale ticks, indicator turned past centre
    tinker: () => box(-12, -12, 0, 24, 24, 2.5) + Array.from({ length: 9 }, (_, i) => line([onRim(0, 0, 2.5, 9, 90 + i * 30), onRim(0, 0, 2.5, i === 6 ? 11.4 : 10.4, 90 + i * 30)], 'l' + (i === 6 ? ' a' : ' d'))).join('') +
      cyl(0, 0, 2.5, 6.6, 5.5) + ell(0, 0, 8, 4.8, 'l d') + line([[0, 0, 8], onRim(0, 0, 8, 5.6, 270)], 'l a'),
    // Grand Tour: a 3x3 map of tiles with a route that visits each one, flag at the end
    explore: () => { let s = ''; for (let k = 0; k <= 4; k++) for (let i = 0; i < 3; i++) { const j = k - i; if (j < 0 || j > 2) continue; s += box(-11 + i * 7.6, -11 + j * 7.6, 0, 6, 6, 1.4); }
      const c = (i, j) => [-8 + i * 7.6, -8 + j * 7.6, 1.4], R = [c(0, 0), c(1, 0), c(2, 0), c(2, 1), c(1, 1), c(0, 1), c(0, 2), c(1, 2), c(2, 2)];
      return s + line(R, 'l a dd') + ell(...c(0, 0), 1, 'l a') + ell(...c(2, 2), 1.9, 'l a') + ell(...c(2, 2), 0.6, 'l a'); },
    // Thirty Down: a month of pages stacked, the top one ruled and checked
    month1: () => [0, 2.4, 4.8, 7.2].map((z, i) => box(-11, -11, z, 22, 22, 1.6, i === 3 ? 'hl' : '')).join('') +
      [1, 2, 3, 4].map(k => line([[-11 + k * 4.4, -11, 8.8], [-11 + k * 4.4, 11, 8.8]], 'l d')).join('') + [1, 2, 3, 4].map(k => line([[-11, -11 + k * 4.4, 8.8], [11, -11 + k * 4.4, 8.8]], 'l d')).join('') +
      line([[-4, 3, 8.8], [0, 7, 8.8], [8, -5, 8.8]], 'l a w')
  };
  const svg = id => ART[id] ? '<svg class="ta" viewBox="6 5 52 52" aria-hidden="true">' + ART[id]().replace(/<(path|ellipse)/g, '<$1 pathLength="1"') + '</svg>' : '';
  window.TrophyArt = { has: id => !!ART[id], svg, ids: Object.keys(ART) };
})();
