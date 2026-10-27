// 3D trophy quality tiers: pure selection logic (unit-tested) + a browser probe. No three.js needed.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.TrophyTier = f(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TIERS = ['low', 'medium', 'high'], V = 1;
  const SOFT = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|mesa offscreen/i;
  // caps -> ceiling tier from hardware/browser hints. A benchmark can only lower it (applyBench).
  function pick(c) {
    c = c || {}; const why = [], low = r => ({ tier: 'low', why: [r] });
    if (!c.webgl) return { tier: 'none', why: ['WebGL unavailable'] };
    if (SOFT.test(c.renderer || '')) return low('software renderer (' + c.renderer + ')');
    if (c.saveData) return low('data saver is on');
    if (!c.webgl2) return low('no WebGL2');
    if (c.maxTex && c.maxTex < 4096) return low('max texture ' + c.maxTex);
    if (c.mem && c.mem <= 2) return low(c.mem + ' GB device memory');
    if (c.cores && c.cores <= 2) return low(c.cores + ' CPU cores');
    let tier = 'high'; const med = r => { tier = 'medium'; why.push(r); };
    const phone = !!c.coarse && Math.min(c.sw || 0, c.sh || 0) > 0 && Math.min(c.sw, c.sh) < 600;
    if (phone) med('phone-sized touch screen');
    if (c.mem && c.mem < 8) med(c.mem + ' GB device memory');
    if (c.cores && c.cores < 6) med(c.cores + ' CPU cores');
    if (c.maxTex && c.maxTex < 8192) med('max texture ' + c.maxTex);
    if (c.reduced) med('reduced motion');
    if (tier === 'high') why.push('capable GPU/CPU');
    return { tier, why };
  }
  // ms = median time for one medium/high trophy frame at 256px (render + sync readback).
  function applyBench(ceil, ms) {
    if (ceil === 'low' || ceil === 'none' || ms == null || !isFinite(ms)) return ceil;
    if (ms > 16) return 'low';
    if (ceil === 'high' && ms > 8) return 'medium';
    return ceil;
  }
  // override: 'auto'|'low'|'medium'|'high'; cached: {tier,v,gpu} from an earlier auto-detect
  function resolve(override, cached, gpu) {
    if (TIERS.includes(override)) return { tier: override, source: 'override' };
    if (cached && cached.v === V && TIERS.includes(cached.tier) && (!gpu || cached.gpu === gpu)) return { tier: cached.tier, source: 'cached' };
    return { tier: null, source: 'detect' };
  }
  function probe(gl) {
    const n = typeof navigator !== 'undefined' ? navigator : {}, w = typeof window !== 'undefined' ? window : {}, mm = q => !!(w.matchMedia && w.matchMedia(q).matches);
    const c = { webgl: !!gl, webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      mem: n.deviceMemory || 0, cores: n.hardwareConcurrency || 0, dpr: w.devicePixelRatio || 1, sw: (w.screen || {}).width || 0, sh: (w.screen || {}).height || 0,
      reduced: mm('(prefers-reduced-motion: reduce)'), saveData: !!(n.connection && n.connection.saveData), coarse: mm('(pointer: coarse)') };
    if (gl) { c.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); let r = '';
      try { const x = gl.getExtension('WEBGL_debug_renderer_info'); r = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { /* ignore */ }
      c.renderer = String(r || gl.getParameter(gl.RENDERER) || ''); }
    return c;
  }
  return { TIERS, V, SOFT, pick, applyBench, resolve, probe };
});
