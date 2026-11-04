'use strict';
// Per-test landing pages (/mcat, /lsat, ...): same landing as /, with its own title, meta, canonical, h1 and rotation start.
// slug -> { id: template id (what the signup picker and analytics use), word: rotating-word text, full name, blurb }
const EXAMS = {
  mcat: { id: 'mcat', word: 'MCAT', full: 'MCAT', what: 'MCAT prep: Chem/Phys, CARS, Bio/Biochem and Psych/Soc hours, practice-test scores (472-528) and goals' },
  lsat: { id: 'lsat', word: 'LSAT', full: 'LSAT', what: 'LSAT prep: Logical Reasoning and Reading Comprehension hours, PrepTest scores (120-180) and goals' },
  gre: { id: 'gre', word: 'GRE', full: 'GRE', what: 'GRE prep: Verbal, Quant and Writing hours, practice-test scores (260-340) and goals' },
  gmat: { id: 'gmat', word: 'GMAT', full: 'GMAT Focus', what: 'GMAT prep: Quant, Verbal and Data Insights hours, practice-test scores (205-805) and goals' },
  sat: { id: 'sat', word: 'SAT', full: 'SAT', what: 'SAT prep: Reading and Writing and Math hours, practice-test scores (400-1600) and goals' },
  act: { id: 'act', word: 'ACT', full: 'ACT', what: 'ACT prep: English, Math, Reading and Science hours, practice-test composites (1-36) and goals' },
  usmle: { id: 'usmle1', word: 'USMLE', full: 'USMLE Step 1', what: 'USMLE Step 1 prep: system and discipline hours, NBME/UWSA practice scores and goals' },
  dat: { id: 'dat', word: 'DAT', full: 'DAT', what: 'DAT prep: Biology, Chemistry, PAT, Reading and Quantitative hours, practice-test scores (200-600) and goals' },
};
const ORDER = Object.keys(EXAMS), BY_ID = Object.fromEntries(ORDER.map(s => [EXAMS[s].id, s]));
const slugFor = v => { v = String(v || '').toLowerCase(); return EXAMS[v] ? v : BY_ID[v] || null; }; // accepts slug or template id
const idFor = v => { const s = slugFor(v); return s ? EXAMS[s].id : null; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// render index.html for one test; `site` = canonical origin
function examHead(html, slug, site) {
  const e = EXAMS[slug]; if (!e) return html;
  const url = site + '/' + slug, title = `StudyHertz: ${e.full} Study Tracker with Focus Timer, Stats and Scores`, ogt = `StudyHertz: ${e.full} Study Tracker`;
  const desc = `StudyHertz is an open-source ${e.full} study tracker for ${e.what}. Focus timer, heatmap calendar and streaks. Start with a 30-day free trial.`;
  const others = ORDER.filter(s => s !== slug).map(s => EXAMS[s].word);
  return html.replace(/<html lang="en"/, `<html lang="en" data-exam="${e.id}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, '$1' + esc(desc))
    .replace(/(<link rel="canonical" href=")[^"]*/, '$1' + url).replace(/(<meta property="og:url" content=")[^"]*/, '$1' + url)
    .replace(/(<meta property="og:title" content=")[^"]*/, '$1' + esc(ogt)).replace(/(<meta name="twitter:title" content=")[^"]*/, '$1' + esc(ogt))
    .replace(/(<meta property="og:description" content=")[^"]*/, '$1' + esc(desc)).replace(/(<meta name="twitter:description" content=")[^"]*/, '$1' + esc(desc))
    .replace(/(&middot; )MCAT( study tracker<\/p>)/, '$1' + esc(e.full) + '$2')
    .replace(/(<span class="rot-w on">)MCAT(<\/span>)/, '$1' + e.word + '$2')
    .replace(/(<span class="vh"> \(or )[^)]*(\)<\/span>)/, '$1' + others.join(', ') + '$2');
}
module.exports = { EXAMS, ORDER, slugFor, idFor, examHead };
