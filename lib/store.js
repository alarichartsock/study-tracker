'use strict';
const fs = require('fs');
const SCHEMA = 3;
const DEFAULT_SUBJECTS = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'];
const DEFAULT_ACTIVITIES = ['Content review', 'Practice questions', 'Full-length exam', 'Flashcards', 'Review mistakes'];
const PALETTE = ['#6c8cff', '#f59f00', '#3ecf8e', '#e64980', '#22b8cf', '#ae3ec9', '#fd7e14', '#94d82d', '#868e96', '#f03e3e'];
const defaultSettings = () => ({
  dailyGoalMin: 360, busyIp: '', busyToken: '',
  goals: { dailyMin: 360, weekendDailyMin: null, weeklyMin: 0, monthlyMin: 0, termMin: 0 },
  term: { name: '', start: '', end: '' },
  medals: { bronze: 60, silver: 180, gold: 300, platinum: 480 },
  dayStartHour: 0,
  pomodoro: { focusMin: 25, shortMin: 5, longMin: 15, cycles: 4, autoStart: false },
  quickDurations: [25, 50, 90],
  accent: '', feedToken: null,
});
const blankUserData = () => ({ sessions: [], subjects: DEFAULT_SUBJECTS.slice(), subjectMeta: {}, activities: DEFAULT_ACTIVITIES.slice(),
  exams: [], tasks: [], plan: {}, settings: defaultSettings(), active: null, nextId: 1 });

// Idempotent upgrade of one user's data to the current schema. Never drops existing values.
function migrateUserData(ud) {
  const d = blankUserData(), def = defaultSettings();
  for (const k of Object.keys(d)) if (ud[k] === undefined) ud[k] = d[k];
  const s = (ud.settings ||= {});
  for (const k of Object.keys(def)) if (s[k] === undefined) s[k] = def[k];
  for (const k of ['goals', 'term', 'medals', 'pomodoro']) for (const [kk, v] of Object.entries(def[k])) if (s[k][kk] === undefined) s[k][kk] = v;
  if (s.dailyGoalMin !== undefined && s.goals.dailyMin === def.goals.dailyMin && s.dailyGoalMin !== def.dailyGoalMin) s.goals.dailyMin = s.dailyGoalMin;
  ud.subjects.forEach((n, i) => { const m = (ud.subjectMeta[n] ||= {}); if (!m.color) m.color = PALETTE[i % PALETTE.length]; if (m.weeklyGoalMin === undefined) m.weeklyGoalMin = 0; if (m.credits === undefined) m.credits = 0; });
  let maxId = 0; for (const x of [...ud.sessions, ...ud.exams, ...ud.tasks]) maxId = Math.max(maxId, +x.id || 0);
  if (!(ud.nextId > maxId)) ud.nextId = maxId + 1;
  return ud;
}

class Store {
  constructor(file) {
    this.file = file;
    let raw = null, text = null;
    try { text = fs.readFileSync(file, 'utf8'); raw = JSON.parse(text); } catch (e) { if (text) throw new Error(`Refusing to start: ${file} is not valid JSON (${e.message})`); }
    const backup = tag => { if (text) fs.writeFileSync(file.replace(/\.json$/, '') + `.${tag}-backup-${Date.now()}.json`, text); };
    if (raw && raw.version >= 2) {
      this.db = raw;
      if (raw.version < SCHEMA) { backup('v' + raw.version); for (const ud of Object.values(this.db.userData)) migrateUserData(ud); if (this.db.legacy) migrateUserData(this.db.legacy); this.db.version = SCHEMA; this.save(); }
    } else {
      this.db = { version: SCHEMA, users: [], tokens: {}, config: { openRegistration: true }, userData: {}, nextUserId: 1 };
      if (raw && Array.isArray(raw.sessions)) { backup('v1'); this.db.legacy = migrateUserData({ ...raw, settings: { ...raw.settings } }); }
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
  data(uid) { return migrateUserData(this.db.userData[uid] ||= blankUserData()); }
}
module.exports = { Store, blankUserData, migrateUserData, defaultSettings, DEFAULT_SUBJECTS, DEFAULT_ACTIVITIES, PALETTE, SCHEMA };
