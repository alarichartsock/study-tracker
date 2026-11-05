// Readable subject colours: keep a colour usable as bars, dots, ring strokes and labels on both the light card (#fff) and the dark card
// (#161920): WCAG contrast >= 3:1 against both, i.e. relative luminance in [LMIN, LMAX]. Out-of-range colours keep their hue and are moved
// along OKLCH lightness (chroma capped to stay in sRGB) to the nearest valid shade. Shared by the browser and the server.
(function (root) {
  const LMIN = 0.135, LMAX = 0.29, CMAX = 0.26;
  const toLin = v => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4), toSrgb = v => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  const hex2 = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  const lum = c => { const [r, g, b] = c.map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const toOk = c => { const [r, g, b] = c.map(toLin), l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s; return [L, Math.hypot(A, B), Math.atan2(B, A)]; };
  const fromOk = (L, C, H) => { const A = C * Math.cos(H), B = C * Math.sin(H), l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3), m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3), s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
    const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]; return lin.some(v => v < -1e-4 || v > 1.0001) ? null : lin.map(v => toSrgb(Math.max(0, Math.min(1, v)))); };
  const inRange = c => { const y = lum(c); return y >= LMIN - 1e-4 && y <= LMAX + 1e-4; };
  // nearest valid shade: same hue, chroma capped, lightness searched toward the violated bound
  function clamp(h) { const c = hex2(h); if (!c) return { color: h, adjusted: false }; let [L, C, H] = toOk(c);
    if (inRange(c) && C <= CMAX + 1e-3) return { color: toHex(c).toLowerCase(), adjusted: false };
    C = Math.min(C, CMAX); const want = lum(c) < LMIN ? LMIN : lum(c) > LMAX ? LMAX : lum(c); let best = null;
    for (let cc = C; cc >= 0 && !best; cc -= 0.01) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2, rgb = fromOk(mid, cc, H); const y = rgb ? lum(rgb) : (mid > L ? 1 : 0); if (y < want) lo = mid; else hi = mid; }
      for (const t of [lo, hi, (lo + hi) / 2]) { const rgb = fromOk(t, cc, H); if (rgb && inRange(rgb)) { best = rgb; break; } } }
    const out = toHex(best || [107, 115, 133]).toLowerCase(); return { color: out, adjusted: out !== toHex(c).toLowerCase() }; }
  const api = { clamp, color: h => clamp(h).color, valid: h => { const c = hex2(h); return !!c && inRange(c) && toOk(c)[1] <= CMAX + 1e-3; }, contrast: (a, b) => contrast(hex2(a), hex2(b)), LMIN, LMAX };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SubjectColor = api;
})(typeof window !== 'undefined' ? window : globalThis);
