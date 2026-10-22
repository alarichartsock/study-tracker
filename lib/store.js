'use strict';
const fs = require('fs');
const DEFAULT_SUBJECTS = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'];
const blankUserData = () => ({ sessions: [], subjects: DEFAULT_SUBJECTS.slice(), settings: { dailyGoalMin: 360, busyIp: '', busyToken: '' }, active: null, nextId: 1 });

class Store {
  constructor(file) {
    this.file = file;
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
    if (raw && raw.version === 2) this.db = raw;
    else {
      this.db = { version: 2, users: [], tokens: {}, config: { openRegistration: true }, userData: {}, nextUserId: 1 };
      if (raw && Array.isArray(raw.sessions)) { // v1 single-user file -> handed to first registered user
        try { fs.copyFileSync(file, file.replace(/\.json$/, '') + '.v1-backup.json'); } catch { /* ignore */ }
        this.db.legacy = { ...blankUserData(), ...raw, settings: { ...blankUserData().settings, ...(raw.settings || {}) } };
      }
      this.save();
    }
  }
  save() { const t = this.file + '.tmp'; fs.writeFileSync(t, JSON.stringify(this.db, null, 1)); fs.renameSync(t, this.file); }
  findUser(username) { return this.db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase()); }
  userById(id) { return this.db.users.find(u => u.id === id); }
  addUser({ username, salt, hash }) {
    const first = this.db.users.length === 0;
    const u = { id: this.db.nextUserId++, username, salt, hash, admin: first, created: new Date().toISOString() };
    this.db.users.push(u);
    if (first && this.db.legacy) { this.db.userData[u.id] = this.db.legacy; delete this.db.legacy; }
    else this.db.userData[u.id] = blankUserData();
    if (first) this.db.config.openRegistration = false; // closed by default once an admin exists
    this.save(); return u;
  }
  data(uid) { return (this.db.userData[uid] ||= blankUserData()); }
}
module.exports = { Store, blankUserData, DEFAULT_SUBJECTS };
