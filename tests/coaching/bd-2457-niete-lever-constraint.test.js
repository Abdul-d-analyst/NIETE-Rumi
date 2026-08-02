/**
 * bd-2457 (NIETE port) — constrain the /observe debrief step-3 "lever question".
 *
 * Ported from the main bot (hyasin270/whatsapp-ai-bot). Origin: Silverleaf FO Kelvin
 * flagged that step 3 of the observe debrief guide reads as an abstract meta-question
 * about how to design questions instead of a simple reflection prompt. Root cause: the
 * lever field's prompt spec was an unconstrained placeholder. NIETE's affected
 * frameworks are FICO (primary, focus strings rendered in the teacher's language) and
 * the ported MEWAKA (Kiswahili). NIETE has no TPAD.
 */

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const mewaka = require('../../bot/shared/services/coaching/frameworks/mewaka-framework');

const TRANSCRIPT = 'Teacher: Good morning class. Today we will read a story...';
const promptFor = (fw) => fw.buildAnalysisPrompt(TRANSCRIPT, {});

describe('bd-2457 NIETE §FICO — lever spec constrained', () => {
  const p = promptFor(fico);
  test('bare placeholder gone', () => {
    expect(p).not.toMatch(/"lever_question":\s*"<one reflective question that helps the teacher self-coach on this focus>"/);
  });
  test('observer→teacher, first-order, anti-meta, length cap', () => {
    expect(p).toMatch(/OBSERVER asks the TEACHER|observer asks the teacher/i);
    expect(p).toMatch(/own lesson/i);
    expect(p).toMatch(/NOT a question about how to design questions/i);
    expect(p).toMatch(/15 words/);
  });
  test('focus block intact', () => {
    expect(p).toMatch(/"try_this_tomorrow"/);
    expect(p).toMatch(/"rationale"/);
  });
});

describe('bd-2457 NIETE §MEWAKA — lever spec constrained (Kiswahili)', () => {
  const p = promptFor(mewaka);
  test('bare placeholder gone', () => {
    expect(p).not.toMatch(/"lever_question_sw":\s*"<reflective question>"/);
  });
  test('officer→teacher, first-order, anti-meta, length cap', () => {
    expect(p).toMatch(/AFISA/);
    expect(p).toMatch(/MWALIMU/);
    expect(p).toMatch(/SIYO swali kuhusu jinsi ya kuunda maswali/);
    expect(p).toMatch(/kumi na tano/);
  });
  test('focus block intact', () => {
    expect(p).toMatch(/"try_this_tomorrow_sw"/);
  });
});
