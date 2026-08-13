'use strict';
/**
 * Video-quiz class report — bd-2335, redesigned bd-2473, i18n'd bd-2664.
 *
 * The teacher's copy of "how did my class do, and what do I do about it".
 * v2 (bd-2473) adopts the coaching hero-report visual system (navy hero,
 * Fraunces/Lexend, jewel-tone cards, gold accents — see
 * shared/services/coaching/report-v2/hero-report.template.js) instead of the
 * v1 flat white layout, so the report family reads as one product. Approved
 * mockup, built against real data (Razia / GPS Jhanda Chichi, Rawalpindi):
 * "06_Logs & Misc/Reports/Active/Video Quizzes - Jul 2026/report-redesign/".
 *
 * bd-2664: v2 shipped WITHOUT a Nastaliq font-face — every Urdu quiz (270 of
 * ~440 share codes, the majority) rendered as tofu boxes for the question
 * text, options, and explanations, and the chrome labels ("Worth reteaching",
 * "How each student did", etc.) stayed English regardless of the quiz's own
 * language. `quiz-report.template.js` (the sibling /quiz report this was
 * modeled on) and `hero-report.template.js` (the coaching report this v2
 * copied the VISUAL system from) both already solved this — this file just
 * hadn't inherited the fix. See the `PlayWriteReports` skill for the full
 * pattern (font embedding, RTL layout, chrome-string localisation, mixed-
 * script isolation) generalised across every Playwright-rendered report.
 *
 * language ('en' default; 'ur' fully localised chrome + RTL; 'pa-PK'/'sd-PK'
 * are also Perso-Arabic-script languages with no dedicated font asset in the
 * repo — they render RTL via the Nastaliq font + the Urdu chrome strings as
 * a documented approximation, which is a strict improvement over the
 * previous all-tofu/all-English state, not a claim of linguistic precision).
 *
 * Function signature is UNCHANGED except for the new optional `language`
 * key — video-quiz-report.service.js's call site adds one field, nothing
 * else moves.
 */

const fs = require('fs');
const path = require('path');
const { stripEmphasis, classLabel } = require('../utils/text-format');

let _assets = null;

function readBase64(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch { return ''; }
}

function assets() {
  if (!_assets) {
    _assets = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      fraunces: readBase64('fonts/Fraunces-Regular.ttf'),
      frauncesSemi: readBase64('fonts/Fraunces-SemiBold.ttf'),
      // bd-2664 — same asset quiz-report.template.js and hero-report.template.js
      // already embed. Without this @font-face, Urdu/Perso-Arabic text has no
      // glyphs to fall back to and Chromium renders empty tofu boxes.
      nastaliq: readBase64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      nastaliqBold: readBase64('fonts/NotoNastaliqUrdu-Bold.ttf'),
      // NIETE branding (2026-08-04, bd-2488): black-on-transparent N/ن
      // monogram from the niete-brand skill, for the light-background
      // footer lockup — replaces PK's Rumi mark for this fork.
      nieteMark: readBase64('assets/niete-mark-black-transparent.png'),
    };
  }
  return _assets;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Perso-Arabic-script (RTL) quiz languages the report currently ships for. */
const RTL_LANGS = new Set(['ur', 'pa-PK', 'sd-PK']);

/**
 * Chrome strings per language. 'pa-PK'/'sd-PK' fall back to 'ur' (see file
 * header) — documented approximation, not a claim of Punjabi/Sindhi accuracy.
 */
const CHROME = {
  en: {
    eyebrow: 'Class quiz results',
    forTeacher: (n) => `For <b>${esc(n)}</b>`,
    classResults: 'Class results',
    gradeLine: (g) => ` &middot; Grade ${esc(g)}`,
    classAverage: 'Class average',
    started: 'Started', finished: 'Finished', worthReteaching: 'Worth reteaching',
    worthReteachingHeading: 'Worth reteaching &mdash; most missed',
    gotWrong: (n, t) => `${n} of ${t} got this wrong`,
    mostChose: 'Most chose', correctAnswer: 'correct answer',
    explanation: 'Explanation:',
    howEachStudentDid: 'How each student did',
    notFinishedYet: 'Not finished yet:',
    forTomorrow: 'For tomorrow',
  },
  ur: {
    eyebrow: 'کلاس کوئز کے نتائج',
    forTeacher: (n) => `${esc(n)} <b>کے لیے</b>`,
    classResults: 'کلاس کے نتائج',
    gradeLine: (g) => ` &middot; جماعت ${esc(g)}`,
    classAverage: 'کلاس اوسط',
    started: 'شروع کیا', finished: 'مکمل کیا', worthReteaching: 'دوبارہ پڑھانا',
    worthReteachingHeading: 'دوبارہ پڑھانے کے قابل &mdash; سب سے زیادہ غلط',
    gotWrong: (n, t) => `${t} میں سے ${n} نے غلط جواب دیا`,
    mostChose: 'زیادہ تر نے چنا', correctAnswer: 'درست جواب',
    explanation: 'وضاحت:',
    howEachStudentDid: 'ہر طالب علم کی کارکردگی',
    notFinishedYet: 'ابھی مکمل نہیں کیا:',
    forTomorrow: 'کل کے لیے',
  },
};

/**
 * Wrap Latin-script runs in an explicit LTR span so mixed Urdu+English text
 * doesn't get visually scrambled by the browser's bidi algorithm — same
 * technique as hero-report.template.js's wrapLatin(), including the same
 * fix (bd-2225 there): split on tags AND HTML entities FIRST so a wrap never
 * lands inside a tag or splits an entity like `&amp;` into `&<span>amp</span>;`.
 * No-ops for LTR reports.
 */
function wrapLatin(html, rtl) {
  if (!rtl) return html;
  return html.split(/(<[^>]+>|&[a-zA-Z]+;|&#\d+;)/).map((seg) => (
    seg.startsWith('<') || (seg.startsWith('&') && seg.endsWith(';'))
  ) ? seg
    : seg.replace(/[A-Za-z][A-Za-z'’.\-]*(?:[\s\-][A-Za-z'’.\-]+)*/g, (m) => `<span class="ltr">${m}</span>`)).join('');
}

/** Progress-bar band, matching the coaching hero-report's domain-bar palette. */
function band(pct) {
  if (pct >= 80) return 'band-strong';
  if (pct >= 60) return 'band-mid';
  return 'band-low';
}

function renderVideoQuizReportHtml(d) {
  const a = assets();
  const {
    topic = 'Video quiz', teacherName = '', grade = '',
    started = 0, finished = 0, average = 0,
    students = [], hardest = [], guidance = null, unfinished = [],
    generatedAt = '', language = 'en',
  } = d || {};

  const RTL = RTL_LANGS.has(language);
  // pa-PK/sd-PK have no dedicated chrome translation (see file header) — fall
  // back to Urdu, the closest available Perso-Arabic-script chrome set.
  const C = CHROME[language] || (RTL ? CHROME.ur : CHROME.en);
  // T() = untrusted content (escape THEN isolate Latin runs). L() = trusted,
  // developer-authored chrome HTML that may already contain real tags/entities
  // (&mdash;, <b>) — those must NOT be re-escaped, only Latin-isolated.
  const T = (s) => wrapLatin(esc(s), RTL);
  const L = (s) => wrapLatin(s, RTL);

  const missedCards = hardest.map((h, i) => {
    const chose = h.top_wrong_text ? `
      <div class="chose"><span class="lbl">${L(C.mostChose)}</span>
        <span class="wrongpill">${T(h.top_wrong_text)}</span>
        <span class="arrow">${RTL ? '&larr;' : '&rarr;'}</span>
        <span class="lbl">${L(C.correctAnswer)}</span>
        <span class="rightpill">${T(h.correct_text || '')}</span></div>` : '';
    const why = h.misconception ? `
      <div class="why"><b>${L(C.explanation)}</b> ${T(h.misconception)}</div>` : '';
    return `
      <div class="moment">
        <div class="mhead"><div class="num">${i + 1}</div><div class="m-q">${T(h.question_text)}</div></div>
        <div class="mstat">${L(C.gotWrong(h.wrong, h.total))}</div>
        ${chose}${why}
      </div>`;
  }).join('');

  const rosterRows = students.map((s) => {
    const pct = s.mastery_percentage || 0;
    return `
      <div class="r-row">
        <div class="r-name">${T(s.student_name || 'Unnamed')}<div class="cls">${T(classLabel(s.student_class))}</div></div>
        <div class="pbar"><div class="pfill ${band(pct)}" style="width:${pct}%"></div></div>
        <div class="r-score">${s.correct_answers || 0}/${s.total_questions_answered || 0} &middot; ${pct}%</div>
      </div>`;
  }).join('');

  const notFinished = unfinished.length ? `
    <div class="unfin"><b>${L(C.notFinishedYet)}</b> ${T(unfinished.join(RTL ? '، ' : ', '))}</div>` : '';

  const guidanceBlock = guidance ? `
    <div class="try">
      <div class="label">${L(C.forTomorrow)}</div>
      <div class="try-text">${T(stripEmphasis(guidance))}</div>
    </div>` : '';

  const headFam = RTL ? `'NastaliqUrdu',serif` : `'Fraunces',serif`;
  const bodyFam = RTL ? `'NastaliqUrdu',serif` : `'Lexend',sans-serif`;
  const dir = RTL ? 'rtl' : 'ltr';

  return `<!doctype html><html dir="${dir}" lang="${language}"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend}) format('truetype')}
@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${a.lexendBold}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:400;src:url(data:font/ttf;base64,${a.fraunces}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:600;src:url(data:font/ttf;base64,${a.frauncesSemi}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold}) format('truetype')}
body{background:#eef1f7;font-family:${bodyFam}}
.report{width:794px;margin:0 auto;background:#fff;color:#1c2438}
/* bd-2664 — Latin runs isolated inside RTL text (proper nouns, stray English
   words) render in their own script + direction, matching hero-report. */
/* bd-2664: unicode-bidi:isolate alone does NOT force LTR — it only isolates
   the run from surrounding context, then still resolves direction from the
   INHERITED direction property, which under html dir=rtl is rtl. A
   multi-run string like a date ("13 Aug 2026" — digits/letters are separate
   bidi runs) then visually reorders (observed: "Aug 2026 13"). direction:ltr
   forces the isolate's own base direction, independent of the RTL ancestor. */
.ltr{font-family:'Lexend',sans-serif;font-weight:600;unicode-bidi:isolate;direction:ltr}

.hero{position:relative;min-height:230px;overflow:hidden;background:#0c1a4e;padding:30px 42px 26px}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(12,26,78,.5),rgba(12,26,78,.45) 45%,rgba(12,26,78,.92))}
.hero>*{position:relative;z-index:1}
.eyebrow{font-size:12px;letter-spacing:${RTL ? '0' : '.2em'};${RTL ? '' : 'text-transform:uppercase;'}color:#9db0ff;font-weight:700}
.herotop{display:flex;justify-content:space-between;align-items:flex-start;margin-top:10px}
.hero h1{font-family:${headFam};font-size:${RTL ? '24px' : '26px'};line-height:${RTL ? '1.9' : '1.2'};font-weight:600;color:#fff;max-width:490px}
.hscore{text-align:${RTL ? 'left' : 'right'};flex-shrink:0;margin-${RTL ? 'right' : 'left'}:20px}
.hscore .p{font-family:'Lexend';font-weight:700;font-size:46px;color:#fff;letter-spacing:-.02em;line-height:1;direction:ltr}
.hscore .s{font-family:${RTL ? bodyFam : `'Lexend'`};font-size:11.5px;color:#bcc8ff;margin-top:5px;letter-spacing:.05em;${RTL ? '' : 'text-transform:uppercase;'}}
.who{margin-top:16px;font-size:14px;color:#dfe5ff;${RTL ? 'line-height:2;' : ''}}
.who b{color:#fff}
.statrow{display:flex;gap:10px;margin-top:18px}
.stchip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:11px;padding:9px 14px}
.stchip .n{font-family:'Lexend';font-weight:700;font-size:19px;color:#fff;direction:ltr}
.stchip .l{font-family:${RTL ? bodyFam : `'Lexend'`};font-size:${RTL ? '11.5px' : '10.5px'};color:#9db0ff;${RTL ? '' : 'text-transform:uppercase;'}letter-spacing:.08em;margin-top:1px}

.body{padding:26px 42px 6px}
.label{font-size:${RTL ? '12.5px' : '11px'};letter-spacing:${RTL ? '0' : '.14em'};${RTL ? '' : 'text-transform:uppercase;'}color:#0c1a4e;opacity:.55;font-weight:700;margin-bottom:14px}

.moment{background:#f7f9ff;border-radius:14px;padding:16px 18px;margin-bottom:12px}
.mhead{display:flex;gap:10px;align-items:flex-start}
.num{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#0c1a4e;color:#fff;font-size:12px;font-weight:700;
     display:flex;align-items:center;justify-content:center;font-family:'Lexend'}
.m-q{font-family:${headFam};font-size:16px;line-height:${RTL ? '1.9' : '1.4'};color:#26304d;font-weight:600}
.mstat{font-size:12px;color:#6a748f;margin:8px 34px 10px}
.chose{margin:0 34px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}
.lbl{color:#6a748f}
.wrongpill{background:#fff4d6;color:#9a6b00;font-weight:700;padding:3px 10px;border-radius:12px}
.rightpill{background:#e2f6ea;color:#0f7a3d;font-weight:700;padding:3px 10px;border-radius:12px}
.arrow{color:#b7bfd6}
.why{margin:8px 34px 0;font-size:12px;line-height:${RTL ? '1.9' : '1.5'};color:#374151;background:#fff;border-radius:8px;padding:8px 10px}

.roster{margin-top:22px}
.r-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #eef0f6}
.r-row:last-child{border-bottom:none}
.r-name{width:190px;font-size:13.5px;font-weight:600;color:#26304d}
.r-name .cls{font-weight:400;color:#8a93ad;font-size:11.5px}
.pbar{flex:1;height:8px;border-radius:5px;background:#e7ebf3;overflow:hidden}
.pfill{height:100%;border-radius:5px}
.r-score{width:110px;text-align:${RTL ? 'left' : 'right'};font-family:'Lexend';font-weight:700;font-size:13px;color:#0c1a4e;direction:ltr}
.band-strong{background:#3aa775}.band-mid{background:#e0a52e}.band-low{background:#dd7a5c}

.unfin{margin-top:16px;background:#faf9f7;border:1px dashed #e2e0d8;border-radius:10px;padding:12px 16px;font-size:12.5px;color:#7a7360;line-height:${RTL ? '1.9' : 'normal'}}
.unfin b{color:#4a4636}

.try{margin:24px 42px 0;background:linear-gradient(135deg,#0c1a4e,#1b2f7a);color:#fff;border-radius:16px;padding:20px 24px}
.try .label{color:#9db0ff;opacity:1;margin-bottom:7px}
.try-text{font-family:${headFam};font-size:16.5px;line-height:${RTL ? '1.9' : '1.5'}}

.foot{display:flex;align-items:center;justify-content:space-between;padding:20px 42px 28px;margin-top:20px;border-top:1px solid #eef0f6;color:#8a93ad;font-size:12px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:#0c1a4e;font-size:14px;font-family:'Lexend'}
/* The mark is a 2.6:1 lockup — set width ONLY and let height follow, or the
   dots and smile get crushed (rumi-brand). Matches hero-report's .brand img. */
.brand img{width:30px;height:auto;display:block}
</style></head><body>
<div class="report">

  <div class="hero">
    <div class="eyebrow">${L(C.eyebrow)}</div>
    <div class="herotop">
      <h1>${T(topic)}</h1>
      <div class="hscore"><div class="p">${average}%</div><div class="s">${L(C.classAverage)}</div></div>
    </div>
    <div class="who">${teacherName ? L(C.forTeacher(teacherName)) : L(C.classResults)}${grade ? L(C.gradeLine(grade)) : ''}</div>
    <div class="statrow">
      <div class="stchip"><div class="n">${started}</div><div class="l">${L(C.started)}</div></div>
      <div class="stchip"><div class="n">${finished}</div><div class="l">${L(C.finished)}</div></div>
      <div class="stchip"><div class="n">${hardest.length}</div><div class="l">${L(C.worthReteaching)}</div></div>
    </div>
  </div>

  <div class="body">
    ${hardest.length ? `<div class="label">${L(C.worthReteachingHeading)}</div>${missedCards}` : ''}

    ${students.length ? `<div class="roster">
      <div class="label">${L(C.howEachStudentDid)}</div>
      ${rosterRows}
    </div>` : ''}

    ${notFinished}
  </div>

  ${guidanceBlock}

  <div class="foot">
    <div class="brand">${a.nieteMark ? `<img src="data:image/png;base64,${a.nieteMark}" alt="NIETE">` : ''}NIETE</div>
    <div class="ltr" style="font-family:'Lexend',sans-serif">${esc(generatedAt)}</div>
  </div>

</div>
</body></html>`;
}

module.exports = renderVideoQuizReportHtml;
