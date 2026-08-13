'use strict';
/**
 * bd-2473 — the teacher class report redesign, matching the coaching
 * hero-report visual system (navy hero, Fraunces/Lexend, jewel-tone cards)
 * per the approved mockup (06_Logs & Misc/Reports/Active/Video Quizzes -
 * Jul 2026/report-redesign/report_mockup_v1.html).
 *
 * The function SIGNATURE is unchanged (video-quiz-report.service.js's call
 * site is untouched) — this only tests the new markup/data-binding. Real
 * pixel appearance was verified by rendering + Read-tool review; this file
 * proves the template puts the right numbers and names in the right places,
 * with the new class names, so a future edit can't silently regress the
 * redesign back toward the old flat layout.
 */

const renderHtml = require('../../shared/templates/video-quiz-report.template');

const BASE = {
  topic: 'Classification of Animals: Insects and Worms',
  teacherName: 'Razia', grade: '5',
  started: 5, finished: 3, average: 74,
  students: [
    { student_name: 'Anum shazadi', student_class: '5', correct_answers: 11, total_questions_answered: 15, mastery_percentage: 73 },
    { student_name: 'Mehtab asghar', student_class: '5', correct_answers: 9, total_questions_answered: 15, mastery_percentage: 60 },
  ],
  hardest: [
    {
      question_text: 'Which is an example of an insect?', wrong: 6, total: 7,
      top_wrong_text: 'snake', correct_text: 'bees', misconception: null,
    },
  ],
  guidance: 'Start by counting legs together before naming any animal.',
  unfinished: ['Faizan waseem', 'Hassan ali'],
  generatedAt: '3 Aug 2026',
};

describe('bd-2473 — hero header (navy, Fraunces headline, hero score)', () => {
  test('topic renders as the hero headline', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="hero"/);
    expect(html).toMatch(/Classification of Animals: Insects and Worms/);
  });

  test('the class average is the big hero number', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="hscore"/);
    expect(html).toMatch(/74%/);
  });

  test('teacher name and grade appear in the "who" line', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/Razia/);
    expect(html).toMatch(/Grade 5/);
  });

  test('started/finished/worth-reteaching stat chips carry the real counts', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="stchip"[^]*?>5<\/div>[^]*?STARTED/i);
    expect(html).toMatch(/class="stchip"[^]*?>3<\/div>[^]*?FINISHED/i);
    expect(html).toMatch(/class="stchip"[^]*?>1<\/div>[^]*?WORTH RETEACHING/i);
  });
});

describe('bd-2473 — worth-reteaching moment cards', () => {
  test('renders a jewel-tone moment card with the wrong/correct pill pair', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="moment"/);
    expect(html).toMatch(/Which is an example of an insect\?/);
    expect(html).toMatch(/class="wrongpill">snake/);
    expect(html).toMatch(/class="rightpill">bees/);
  });

  test('with no hardest questions, no moment cards render (never an empty section)', () => {
    const html = renderHtml({ ...BASE, hardest: [] });
    expect(html).not.toMatch(/class="moment"/);
  });
});

describe('bd-2473 — roster with colored progress bars', () => {
  test('each student appears with name, class, and score', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="r-row"/);
    expect(html).toMatch(/Anum shazadi/);
    expect(html).toMatch(/11\/15/);
    expect(html).toMatch(/73%/);
  });

  test('band thresholds match the feature-wide 80/60 tier split (mastered/developing/needs_practice)', () => {
    const html = renderHtml(BASE);
    // 73% is "developing" tier feature-wide (scorecard badges use the same
    // 80/60 split) — mid, not strong, even though it's the class's best score.
    expect(html).toMatch(/Anum shazadi[^]*?band-mid/);
    expect(html).toMatch(/Mehtab asghar[^]*?band-mid/);
  });
});

describe('bd-2473 — guidance card and unfinished list', () => {
  test('the guidance paragraph renders inside the gold-accented "For tomorrow" card', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="try"/);
    expect(html).toMatch(/FOR TOMORROW/i);
    expect(html).toMatch(/Start by counting legs together/);
  });

  test('with no guidance, the card is omitted entirely', () => {
    const html = renderHtml({ ...BASE, guidance: null });
    expect(html).not.toMatch(/class="try"/);
  });

  test('unfinished students are listed by name', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/Faizan waseem/);
    expect(html).toMatch(/Hassan ali/);
  });
});

describe('bd-2473 — footer and font embedding', () => {
  test('the Rumi mark + generated date appear in the footer', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="foot"/);
    expect(html).toMatch(/3 Aug 2026/);
  });

  test('embeds Fraunces + Lexend as base64 — never trusts a system font', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/@font-face\{font-family:'Fraunces'/);
    expect(html).toMatch(/@font-face\{font-family:'Lexend'/);
  });
});

describe('bd-2473 — HTML escaping (unchanged contract)', () => {
  test('a student name with HTML-special characters is escaped', () => {
    const html = renderHtml({
      ...BASE,
      students: [{ student_name: '<script>x</script>', student_class: '5', correct_answers: 1, total_questions_answered: 1, mastery_percentage: 100 }],
    });
    expect(html).not.toMatch(/<script>x</);
    expect(html).toMatch(/&lt;script&gt;/);
  });
});

// bd-2664 — Urdu quizzes (270 of ~440 real share codes) rendered as tofu
// boxes: no Nastaliq @font-face was embedded, and every chrome label stayed
// English regardless of the quiz's own language. Fixed by porting the
// language-aware pattern already proven in hero-report.template.js.
describe('bd-2664 — Urdu report is fully localised + RTL', () => {
  const UR_BASE = {
    topic: 'چھوٹی یے اور بڑی یے کی آوازیں',
    teacherName: 'مہام', grade: 'Prep',
    started: 8, finished: 6, average: 79,
    students: [
      { student_name: 'زینب بی بی', student_class: 'Nursery', correct_answers: 9, total_questions_answered: 10, mastery_percentage: 90 },
    ],
    hardest: [{
      question_text: 'لفظ "آزادی" میں یے کی آواز کیا بتائی گئی؟', wrong: 4, total: 8,
      top_wrong_text: 'ی', correct_text: 'ای', misconception: 'بچے آخر کی آواز الجھا دیتے ہیں۔',
    }],
    guidance: 'وہ سمجھتے ہیں یے ہمیشہ ایک جیسی آواز دیتی ہے۔ بورڈ پر آزادی اور یرقان لکھیں۔ اب آپ خود بتائیں کون سی آواز ہے؟',
    unfinished: ['محمد ولید'],
    generatedAt: '5 Aug 2026',
    language: 'ur',
  };

  test('the <html> tag carries dir="rtl" lang="ur"', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
  });

  test('embeds the Nastaliq font as base64 — the actual bug (tofu boxes)', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu'/);
    // the base64 payload itself must be non-empty, not just the @font-face rule
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{100,}/);
  });

  test('chrome labels are translated, not left in English', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/کلاس کوئز کے نتائج/); // "Class quiz results"
    expect(html).toMatch(/ہر طالب علم کی کارکردگی/); // "How each student did"
    expect(html).toMatch(/کل کے لیے/); // "For tomorrow"
    expect(html).not.toMatch(/Class quiz results/);
    expect(html).not.toMatch(/Worth reteaching/);
    expect(html).not.toMatch(/How each student did/);
  });

  test('an HTML entity in a translated chrome string is not double-escaped', () => {
    // worthReteachingHeading contains a real &mdash; — must render as the
    // entity, never as literal text "&amp;mdash;" (the double-escape bug).
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/دوبارہ پڑھانے کے قابل &mdash; سب سے زیادہ غلط/);
    expect(html).not.toMatch(/&amp;mdash;/);
  });

  test('the teacher-name lockup keeps its real <b> tag, not an escaped one', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/مہام <b>کے لیے<\/b>/);
    expect(html).not.toMatch(/&lt;b&gt;/);
  });

  test('real Urdu question/option/explanation content passes through verbatim', () => {
    const html = renderHtml(UR_BASE);
    // the source quote is a real " character — esc() correctly turns it into
    // &quot;, so the assertion matches the ESCAPED form, not the raw string.
    expect(html).toMatch(/لفظ &quot;آزادی&quot; میں یے کی آواز کیا بتائی گئی؟/);
    expect(html).toMatch(/class="wrongpill">ی</);
    expect(html).toMatch(/class="rightpill">ای</);
    expect(html).toMatch(/بچے آخر کی آواز الجھا دیتے ہیں۔/);
  });

  test('the guidance paragraph renders in Urdu inside the "کل کے لیے" card', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/class="try"/);
    expect(html).toMatch(/وہ سمجھتے ہیں یے ہمیشہ ایک جیسی آواز دیتی ہے۔/);
  });

  test('a student name with HTML-special characters is still escaped in RTL mode', () => {
    const html = renderHtml({
      ...UR_BASE,
      students: [{ student_name: '<script>x</script>', student_class: 'Nursery', correct_answers: 1, total_questions_answered: 1, mastery_percentage: 100 }],
    });
    // wrapLatin() correctly isolates "script"/"x" as Latin runs (each becomes
    // its own <span class="ltr">), so the entities are no longer contiguous —
    // assert the dangerous raw tag is gone and both escaped entities exist,
    // rather than requiring an exact adjacent substring.
    expect(html).not.toMatch(/<script>x</);
    expect(html).toMatch(/&lt;/);
    expect(html).toMatch(/&gt;/);
    expect(html).toMatch(/<span class="ltr">script<\/span>/);
  });

  test('a stray Latin word inside Urdu content is isolated in an .ltr span', () => {
    const html = renderHtml({ ...UR_BASE, topic: 'Science کا سبق' });
    expect(html).toMatch(/<span class="ltr">Science<\/span>/);
  });

  // Caught by rendering the REAL bd-2664 verification PDF and reading it:
  // the footer date "13 Aug 2026" visually painted as "Aug 2026 13" under
  // <html dir="rtl"> because unicode-bidi:isolate alone doesn't force LTR —
  // it still resolves direction from the inherited (rtl) `direction`
  // property. A text-matching test can't see the bug (raw HTML order is
  // unchanged, only paint order); this locks in the actual fix so a future
  // edit can't silently drop it.
  test('the .ltr isolation class forces its own LTR base direction', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/\.ltr\{[^}]*direction:ltr/);
  });

  test('the footer date is wrapped in the LTR-forcing class, not a bare isolate', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/<div class="ltr" style="font-family:'Lexend',sans-serif">5 Aug 2026<\/div>/);
  });

  test('default language (no field passed) stays English/LTR — no regression', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Worth reteaching/);
  });
});
