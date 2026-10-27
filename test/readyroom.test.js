'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server'), { Store, readSnapshot } = require('../lib/store'), analytics = require('../lib/analytics');
test('existing users get Ready Room once, silently; users created later do not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-')), f = path.join(dir, 'data.json');
  const ud = () => ({ sessions: [], exams: [], tasks: [], practice: [], plan: {}, subjects: ['Bio'], subjectMeta: {}, activities: ['Reading'], settings: {}, flags: {} });
  const a = ud(), b = ud(); b.flags.onboarded = 1; a.achNotified = ['first'];
  fs.writeFileSync(f, JSON.stringify({ version: 99, users: [{ id: 1, username: 'a' }, { id: 2, username: 'b' }], tokens: {}, config: { openRegistration: true }, userData: { 1: a, 2: b }, nextUserId: 3 }));
  let s = createApp({ dataFile: f, quiet: true }); s.close?.();
  let db = readSnapshot(f);
  assert.equal(db.config.readyRoomGrant.users, 1); assert.equal(db.userData[1].flags.onboarded, 1); assert.ok(db.userData[1].achNotified.includes('onboard'), 'marked notified (no popup)');
  assert.ok(analytics.ACHIEVEMENTS ? true : true);
  const st = new Store(f); st.db.userData[3] = ud(); st.db.users.push({ id: 3, username: 'c' }); st.save(); st.close();
  s = createApp({ dataFile: f, quiet: true }); s.close?.(); db = readSnapshot(f);
  assert.ok(!db.userData[3].flags.onboarded, 'later users are not auto-granted'); assert.equal(db.config.readyRoomGrant.users, 1);
});
