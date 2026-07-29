/**
 * FEAT-106 #9 (bd-2373) — plain-language jargon in the action card + report.
 *
 * Sara (ICT, DC-2) couldn't parse an action card that said "scaffolding" /
 * "extension" — coach-jargon teachers don't use. simplifyPedagogyJargon()
 * glosses true coach-jargon inline the first time it appears, in the teacher's
 * own language (English gloss for en, Urdu gloss for ur), leaving the terms
 * teachers actually say (open-ended questions, wait time) untouched.
 */

const { simplifyPedagogyJargon } = require('../../bot/shared/services/coaching/pedagogy-jargon');

describe('FEAT-106 #9 — simplifyPedagogyJargon', () => {
  it('glosses "scaffolding" in English', () => {
    const out = simplifyPedagogyJargon('Next class, use scaffolding for the word problem.', 'en');
    expect(out).toMatch(/scaffolding \([^)]+\)/i);
  });

  it('glosses "extension" in English', () => {
    const out = simplifyPedagogyJargon('Give an extension to the fast finishers.', 'en');
    expect(out).toMatch(/extension \([^)]+\)/i);
  });

  it('glosses the English jargon term with an Urdu gloss on the ur path', () => {
    const urdu = 'اگلی کلاس میں scaffolding استعمال کریں۔';
    const out = simplifyPedagogyJargon(urdu, 'ur');
    // term stays English (code-switch rule); gloss is in Urdu parens
    expect(out).toContain('scaffolding (');
    expect(out).toMatch(/[؀-ۿ]/); // contains Urdu script in the gloss
  });

  it('does NOT gloss terms teachers actually say (open-ended questions, wait time)', () => {
    const text = 'Next class, add wait time after open-ended questions.';
    expect(simplifyPedagogyJargon(text, 'en')).toBe(text);
  });

  it('glosses only the FIRST occurrence of a term', () => {
    const out = simplifyPedagogyJargon('Use scaffolding; more scaffolding helps.', 'en');
    expect(out.match(/scaffolding \(/gi)).toHaveLength(1);
  });

  it('is idempotent — re-running does not double-gloss', () => {
    const once = simplifyPedagogyJargon('Use scaffolding here.', 'en');
    const twice = simplifyPedagogyJargon(once, 'en');
    expect(twice).toBe(once);
  });

  it('handles empty / null input safely', () => {
    expect(simplifyPedagogyJargon('', 'en')).toBe('');
    expect(simplifyPedagogyJargon(null, 'en')).toBe(null);
  });
});
