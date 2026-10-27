'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const T = require('../public/trophy-spec.js'), analytics = require('../lib/analytics');

test('every achievement gets a distinct 3D trophy spec with a tier and a category base', () => {
  const ud = { sessions: [{ subject: 'CARS', activity: 'Anki', start: '2026-10-01T10:00:00Z', end: '2026-10-01T12:00:00Z', breakSec: 0 }, { subject: 'Bio', activity: 'Reading', start: '2026-10-02T10:00:00Z', end: '2026-10-02T11:00:00Z', breakSec: 0 }],
    exams: [], tasks: [], plan: {}, subjects: ['CARS', 'Bio'], subjectMeta: { CARS: { color: '#ff0000' }, Bio: { color: '#00ff00' } }, activities: ['Anki', 'Reading'], settings: { medals: {}, goals: {}, dailyGoalMin: 0, dayStartHour: 0 }, flags: {} };
  const A = analytics.achievements(ud), all = [...A.global, ...A.personal], tiers = T.tiers(all);
  assert.ok(A.global.length >= 60, 'expected 60+ global achievements, got ' + A.global.length);
  const sigs = new Map();
  for (const a of all) { const s = T.spec(a, tiers[a.id], a.kind === 'subject' ? ud.subjectMeta[a.key]?.color : null);
    assert.ok(T.TIERS.includes(s.tier)); assert.equal(s.base, T.BASES[a.cat || 'mine']); assert.match(s.metal, /^#[0-9a-f]{6}$/);
    const k = T.signature(s) + '|' + (a.key || ''); assert.ok(!sigs.has(k), a.id + ' looks identical to ' + sigs.get(k)); sigs.set(k, a.id); }
  for (const c of A.categories) assert.ok(T.BASES[c.id], 'no base model for category ' + c.id);
  const subj = A.personal.find(a => a.kind === 'subject' && a.key === 'CARS'); assert.equal(T.spec(subj, 'gold', '#ff0000').accent, '#ff0000');
  const tt = new Set(A.global.filter(a => a.cat === 'time').map(a => tiers[a.id])); assert.ok(tt.has('bronze') && tt.has('platinum'), 'time ladder spans bronze..platinum');
});

test('vendored three.js is pinned, licensed and served/precached', () => {
  const dir = path.join(__dirname, '..', 'public', 'vendor', 'three');
  for (const f of ['three.module.min.js', 'three.core.min.js', 'LICENSE']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(path.join(dir, 'three.core.min.js'), 'utf8').slice(0, 300), /REVISION|172/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'); for (const f of ['/vendor/three/three.module.min.js', '/vendor/three/three.core.min.js', '/trophy3d.js', '/trophy3d-hq.js', '/trophy-tier.js', '/trophy-spec.js']) assert.ok(sw.includes(f), 'sw precaches ' + f);
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'trophy3d.js'), 'utf8'); assert.ok(!/https?:\/\//.test(js.replace(/\/\/.*$/gm, '')), 'no CDN urls'); assert.equal((js.match(/new THREE\.WebGLRenderer/g) || []).length, 1, 'exactly one renderer');
});
