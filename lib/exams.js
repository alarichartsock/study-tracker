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
  step2: { id: 'usmle2', word: 'Step 2', full: 'USMLE Step 2 CK', what: 'USMLE Step 2 CK prep: Medicine, Pediatrics, Obstetrics and Gynecology, Psychiatry and Surgery hours, NBME practice scores and goals' },
  bar: { id: 'bar', word: 'Bar', full: 'Bar Exam', what: 'Bar Exam prep: the seven MBE subjects plus MEE and MPT hours, practice scores and goals' },
  dat: { id: 'dat', word: 'DAT', full: 'DAT', what: 'DAT prep: Biology, Chemistry, PAT, Reading and Quantitative hours, practice-test scores (200-600) and goals' },
};
const ORDER = Object.keys(EXAMS), BY_ID = Object.fromEntries(ORDER.map(s => [EXAMS[s].id, s]));
const slugFor = v => { v = String(v || '').toLowerCase(); return EXAMS[v] ? v : BY_ID[v] || null; }; // accepts slug or template id
const idFor = v => { const s = slugFor(v); return s ? EXAMS[s].id : null; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// render index.html for one test; `site` = canonical origin
function examHead(html, slug, site) {
  const e = EXAMS[slug]; if (!e) return html; if (slug !== 'mcat') html = examBody(html, slug);
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
// Body copy below the headline (tour previews, sections, FAQ + JSON-LD, CTAs, footer) from lib/exam-copy.js.
const COPY = require('./exam-copy');
const MCAT_SUBJ = ['Chem/Phys', 'CARS', 'Bio/Biochem', 'Psych/Soc'];
const SHORT = { lsat: ['LR', 'RC', 'Writing'], gre: ['Verbal', 'Quant', 'Writing'], gmat: ['Quant', 'Verbal', 'DI'], sat: ['R&W', 'Math'], act: ['English', 'Math', 'Reading', 'Science'], usmle: ['Pathology', 'Pharm', 'Physiology', 'Micro'], step2: ['Medicine', 'Pediatrics', 'OB/GYN', 'Psychiatry'], bar: ['Contracts', 'Torts', 'Evidence', 'MEE'], dat: ['Bio', 'Gen Chem', 'Orgo', 'PAT'] };
const MCAT_DESC = 'StudyHertz is an open-source MCAT study tracker with a focus timer, study stats, a heatmap calendar, practice-test scores and goals. Start with a 30-day free trial.';
function examBody(html, slug) {
  const e = EXAMS[slug], c = COPY[slug]; if (!c) return html; const sh = SHORT[slug], col = COPY.COLORS;
  const name = i => sh[i] || null, R = (from, to) => { if (!html.includes(from)) throw new Error('exam copy anchor missing: ' + from.slice(0, 60)); html = html.split(from).join(to); };
  // hero mock "Subjects" card
  html = html.replace(/(<div class="h3" aria-hidden="true">Subjects<\/div>)(?:<div class="mock-sub">[\s\S]*?<\/div><\/div>)+/, (m, h) => h + sh.slice(0, 4).map((n, i) => `<div class="mock-sub"><span>${esc(n)}</span><div class="bar"><i style="width:${[72, 54, 38, 26][i]}%;background:${col[i]}"></i></div></div>`).join('') + '<div class="mock-sub" aria-hidden="true" style="visibility:hidden"><span>&nbsp;</span><div class="bar"><i></i></div></div>'.repeat(Math.max(0, 4 - sh.length)));
  // tour section (hidden filler rows keep the hero card the same height as the MCAT one: no layout shift): swap the MCAT subjects for this test's sections, drop rows it doesn't have
  html = html.replace(/<section class="ltour"[\s\S]*?<\/section>/, sec => {
    sec = sec.replace(/<div class="pv-sub"><span>([^<]+)<\/span><span><b>[^<]*<\/b>[^<]*<\/span><\/div>(<div class="bar">[\s\S]*?<\/div>)?/g, (m, n) => { const i = MCAT_SUBJ.indexOf(n); return i >= 0 && !name(i) ? '' : m; });
    MCAT_SUBJ.forEach((n, i) => { if (name(i)) sec = sec.split(n).join(esc(name(i))); });
    const m = c.mock;
    return sec.replace('See exactly where your MCAT prep time goes', `See exactly where your ${e.word} prep time goes`)
      .replace('<div class="h3">MCAT practice exams</div>', `<div class="h3">${esc(e.full)} practice exams</div>`)
      .replace(/<b class="pv-score">510<\/b> <span class="muted small">79th pct<\/span><div class="muted small">Latest: AAMC FL2<\/div>/, `<b class="pv-score">${m.score}</b> <span class="muted small">${esc(m.scoreNote)}</span><div class="muted small">Latest: ${esc(m.latest)}</div>`)
      .replace('hours by MCAT subject', `hours by ${e.word} section`).replace('Hours by MCAT section and activity', `Hours by ${e.word} section and activity`)
      .replace('sample scores from 498 to 512 and section scores', `sample scores from ${m.range[0]} to ${m.range[1]} and section scores`)
      .replace('<span>FL1 &rarr; FL6</span><span><b>498 &rarr; 512</b></span>', `<span>${esc(m.trend[0])} &rarr; ${esc(m.trend[1])}</span><span><b>${m.range[0]} &rarr; ${m.range[1]}</b></span>`)
      .replace(/<div class="pv-secs">[\s\S]*?<\/div><\/div><\/div>/, `<div class="pv-secs">${m.tiles.map(([v, l]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div></div>`)
      .replace('section scores (472 to 528)', `section scores (${esc(m.scale)})`)
      .replace('Log full-lengths with total and section scores (472 to 528)', `Log practice tests with total and section scores (${esc(m.scale)})`); });
  R('<a href="#mcat">MCAT</a>', `<a href="#mcat">${e.word}</a>`);
  R('<p class="eyebrow">Built around the MCAT</p>', `<p class="eyebrow">Built around the ${esc(e.full)}</p>`);
  html = html.replace(/(<p class="muted sec-lead">)[^<]*(<\/p>)/, '$1' + esc(c.sectionsLead) + '$2')
    .replace(/(<div class="sgrid">)[\s\S]*?(<\/div><\/section>)/, (m, a, z) => a + c.sec.map(([b, sm, p], i) => `<div class="card sec-card" style="--c:${col[i % col.length]}"><span class="sec-dot"></span><b>${esc(b)}</b><small class="muted">${esc(sm)}</small><p>${esc(p)}</p></div>`).join('') + z);
  // FAQ: first answer + test-specific questions, in the page and in the FAQPage JSON-LD
  const first = 'A study tracker built for MCAT prep:', firstNew = `A study tracker built for ${c.what}:`;
  R(first, firstNew);
  html = html.replace(/(<details class="card"><summary>What is StudyHertz\?<\/summary><p>[^<]*<\/p><\/details>)/, (m) => m + c.faq.map(([q, a]) => `<details class="card"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join(''));
  html = html.replace(/(<script type="application\/ld\+json">)(\{"@context": "https:\/\/schema.org", "@type": "FAQPage"[\s\S]*?)(<\/script>)/, (m, a, j, z) => { const o = JSON.parse(j); o.mainEntity.splice(1, 0, ...c.faq.map(([q, t]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: t } }))); return a + JSON.stringify(o).replace(/</g, '\\u003c') + z; });
  R('Start tracking your MCAT hours today', `Start tracking your ${e.word} hours today`);
  R('<p>MCAT study tracking, built in the open.</p>', `<p>${esc(e.full)} study tracking, built in the open.</p>`);
  R('StudyHertz, the open-source MCAT study tracker', `StudyHertz, the open-source ${esc(e.full)} study tracker`);
  R(MCAT_DESC, esc(`StudyHertz is an open-source ${e.full} study tracker for ${e.what}. Focus timer, heatmap calendar and streaks. Start with a 30-day free trial.`));
  return html;
}
module.exports = { EXAMS, ORDER, slugFor, idFor, examHead, examBody };
