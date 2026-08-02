/**
 * FEAT-106 CHANGE 4 (bd-2346) — the hero feedback-card CHROME (fixed labels: the
 * "celebration" eyebrow, section labels, "one thing to try next class") must render
 * in English regardless of the report language, while the LLM-generated BODY
 * (affirmation, moment, strength/horizon copy) stays in the teacher's language and
 * the layout stays RTL for ur/ar.
 *
 * Hammad's spec (Notion FEAT-106, 2026-07-24): "the feedback card heading must be
 * English ... source the eyebrow/label strings from CHROME.en; body/affirmation
 * stays in vm.language."
 */

const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

// A minimal Urdu view-model with an Urdu affirmation body + a next-step callout.
function urduVm() {
  return {
    language: 'ur',
    teacherName: 'Sana',
    topic: 'ریاضی',
    date: '2026-07-29',
    score: { overall: 82, marks: 41, max: 50 },
    groups: [{ name: 'وضاحت', score: 8, max: 10, pct: 80 }],
    tryNext: 'اگلی کلاس میں طلبہ سے سوال پوچھیں', // Urdu next-step BODY (stays localised)
    trend: [],
    narrative: {
      affirmation: 'آپ نے آج بہت اچھا پڑھایا', // Urdu BODY — must remain Urdu
      identity: 'آپ ایک محتاط استاد ہیں',
      moments: [{ quote: 'شاباش', why: 'اچھا لمحہ' }],
      strength_name: 'واضح ہدایات',
      strength_note: 'آپ کی ہدایات واضح تھیں',
      horizon_title: 'مزید سوالات',
      horizon_note: 'مزید کھلے سوالات کریں',
    },
  };
}

describe('FEAT-106 CHANGE 4 — hero-report chrome forced English', () => {
  const html = buildHeroReportHtml(urduVm());

  it('renders the English CHROME eyebrow + section labels even for an Urdu report', () => {
    expect(html).toContain('A celebration of your teaching'); // celebrate eyebrow
    expect(html).toContain('One thing to try next class');    // trynext label
    expect(html).toContain('Your strength');                  // strength label
    expect(html).toContain('Your next horizon');              // horizon label
  });

  it('does NOT render the Urdu CHROME labels', () => {
    expect(html).not.toContain('آپ کی تدریس کا جشن');           // ur celebrate
    expect(html).not.toContain('اگلی کلاس میں آزمانے کے لیے ایک بات'); // ur trynext label
  });

  it('keeps the LLM-generated BODY in Urdu (affirmation + next-step text)', () => {
    expect(html).toContain('آپ نے آج بہت اچھا پڑھایا'); // Urdu affirmation stays
    expect(html).toContain('اگلی کلاس میں طلبہ سے سوال پوچھیں'); // Urdu tryNext body stays
  });

  it('keeps the layout RTL for an Urdu report (only the chrome is English)', () => {
    expect(html).toContain('dir="rtl"');
  });
});
