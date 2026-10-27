'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), T = require('../public/trophy-tier.js');
const desk = { webgl: true, webgl2: true, maxTex: 16384, renderer: 'ANGLE (NVIDIA GeForce RTX 3070)', mem: 8, cores: 12, dpr: 1, sw: 2560, sh: 1440 };
test('tier pick: capable desktop gets high, constraints step down', () => {
  assert.equal(T.pick(desk).tier, 'high');
  assert.equal(T.pick({ ...desk, coarse: true, sw: 390, sh: 844, dpr: 3 }).tier, 'medium');
  assert.equal(T.pick({ ...desk, mem: 4 }).tier, 'medium');
  assert.equal(T.pick({ ...desk, cores: 4 }).tier, 'medium');
  assert.equal(T.pick({ ...desk, maxTex: 4096 }).tier, 'medium');
  assert.equal(T.pick({ ...desk, reduced: true }).tier, 'medium');
  assert.equal(T.pick({ ...desk, mem: 0, cores: 0 }).tier, 'high', 'unknown memory/cores (Safari/Firefox) do not penalise');
});
test('tier pick: low for software renderers, weak or constrained devices', () => {
  for (const r of ['Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver']) assert.equal(T.pick({ ...desk, renderer: r }).tier, 'low', r);
  assert.equal(T.pick({ ...desk, webgl2: false }).tier, 'low');
  assert.equal(T.pick({ ...desk, saveData: true }).tier, 'low');
  assert.equal(T.pick({ ...desk, mem: 2 }).tier, 'low');
  assert.equal(T.pick({ ...desk, cores: 2 }).tier, 'low');
  assert.equal(T.pick({ ...desk, maxTex: 2048 }).tier, 'low');
  assert.equal(T.pick({ webgl: false }).tier, 'none');
  assert.ok(T.pick({ ...desk, mem: 2 }).why.length);
});
test('benchmark can only lower the ceiling', () => {
  assert.equal(T.applyBench('high', 3), 'high'); assert.equal(T.applyBench('high', 10), 'medium'); assert.equal(T.applyBench('high', 30), 'low');
  assert.equal(T.applyBench('medium', 10), 'medium'); assert.equal(T.applyBench('medium', 20), 'low'); assert.equal(T.applyBench('low', 1), 'low'); assert.equal(T.applyBench('high', null), 'high');
});
test('override beats cache; cache is invalidated by version or GPU change', () => {
  assert.deepEqual(T.resolve('medium', { tier: 'high', v: T.V }), { tier: 'medium', source: 'override' });
  assert.deepEqual(T.resolve('auto', { tier: 'high', v: T.V, gpu: 'A' }, 'A'), { tier: 'high', source: 'cached' });
  assert.equal(T.resolve('auto', { tier: 'high', v: T.V, gpu: 'A' }, 'B').source, 'detect');
  assert.equal(T.resolve(undefined, { tier: 'high', v: 0 }).source, 'detect');
  assert.equal(T.resolve('bogus', null).source, 'detect');
});
