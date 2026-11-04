// Exam templates: starting subjects and activities per standardized test. Shared by the browser (window.TEMPLATES)
// and the server/tests (require). Users can edit everything afterwards; sessions keep their subject/activity text.
(function (root) {
  'use strict';
  // score: [min, max] for the official total (null = no fixed scale). exam: default name for the test-day countdown.
  const LIST = [
    { id: 'mcat', name: 'MCAT', exam: 'MCAT', score: [472, 528], subjects: ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'],
      activities: ['Content review', 'Practice questions', 'Full-length exam', 'Flashcards', 'Review mistakes'] },
    { id: 'lsat', name: 'LSAT', exam: 'LSAT', score: [120, 180], subjects: ['Logical Reasoning', 'Reading Comprehension', 'Argumentative Writing'],
      activities: ['Drills', 'Timed sections', 'Practice test', 'Blind review', 'Review mistakes'] },
    { id: 'gre', name: 'GRE', exam: 'GRE', score: [260, 340], subjects: ['Verbal Reasoning', 'Quantitative Reasoning', 'Analytical Writing'],
      activities: ['Content review', 'Practice questions', 'Practice test', 'Vocabulary flashcards', 'Review mistakes'] },
    { id: 'gmat', name: 'GMAT', exam: 'GMAT', score: [205, 805], subjects: ['Quantitative Reasoning', 'Verbal Reasoning', 'Data Insights'],
      activities: ['Content review', 'Practice questions', 'Practice test', 'Error log review', 'Flashcards'] },
    { id: 'sat', name: 'SAT', exam: 'SAT', score: [400, 1600], subjects: ['Reading and Writing', 'Math'],
      activities: ['Content review', 'Practice questions', 'Practice test', 'Flashcards', 'Review mistakes'] },
    { id: 'act', name: 'ACT', exam: 'ACT', score: [1, 36], subjects: ['English', 'Math', 'Reading', 'Science', 'Writing'],
      activities: ['Content review', 'Practice questions', 'Practice test', 'Flashcards', 'Review mistakes'] },
    { id: 'usmle1', name: 'USMLE Step 1', exam: 'USMLE Step 1', score: null,
      subjects: ['Anatomy', 'Behavioral Science', 'Biochemistry', 'Microbiology', 'Pathology', 'Pharmacology', 'Physiology'],
      activities: ['Content review', 'Q-bank', 'Practice test', 'Flashcards', 'Review mistakes'] },
    { id: 'dat', name: 'DAT', exam: 'DAT', score: [200, 600], // 200-600 scale since March 1, 2025 (ADA)
      subjects: ['Biology', 'General Chemistry', 'Organic Chemistry', 'Perceptual Ability', 'Reading Comprehension', 'Quantitative Reasoning'],
      activities: ['Content review', 'Practice questions', 'Practice test', 'Flashcards', 'Review mistakes'] },
    { id: 'custom', name: 'Custom', exam: 'Exam', score: null, subjects: [], activities: ['Study', 'Practice', 'Review'] }
  ];
  const BY = Object.fromEntries(LIST.map(t => [t.id, t]));
  const get = id => BY[id] || null;
  // Clean a user-supplied name list: trimmed, max 60 chars, no duplicates (case-insensitive), at most `max` entries.
  function cleanNames(xs, max = 30) { const out = [], seen = new Set();
    for (const x of Array.isArray(xs) ? xs : []) { const n = String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 60); if (!n || seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase()); out.push(n); if (out.length >= max) break; }
    return out; }
  // Subjects/activities for a signup or a template switch: explicit lists win (when non-empty), else the template's.
  function resolve(id, subjects, activities) { const t = get(id); if (!t) throw new Error('Unknown study template');
    const s = cleanNames(subjects), a = cleanNames(activities);
    const out = { id: t.id, subjects: s.length ? s : t.subjects.slice(), activities: a.length ? a : t.activities.slice() };
    if (!out.subjects.length) throw new Error('Add at least one subject');
    return out; }
  // Score range for exam results: the template's scale, or a generic 0..10000 when the test has none.
  const scoreRange = id => (get(id) && get(id).score) || [0, 10000];
  const api = { LIST, get, cleanNames, resolve, scoreRange };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TEMPLATES = api;
})(typeof self !== 'undefined' ? self : this);
