/**
 * bd-2408 — the coach-the-coach card re-suggested a move the officer already
 * performed (R20, Khadija: "I already asked the teacher to devise the action
 * plan, but Rumi gave me the same suggestion").
 *
 * Confirmed (per handover + code): the debrief transcript IS fed and the
 * 7-behaviour officer rubric IS judged (buildCoachFeedbackPromptI18n) — so this
 * is a rubric-ACCURACY false-negative: the "try" move restated a behaviour the
 * rubric judged TRUE (elicited_if_then). Fix: the prompt now pins "try" to a
 * rubric key judged FALSE and forbids re-suggesting a TRUE behaviour.
 *
 * This guard asserts the constraint is present in the prompt (behavioural
 * validation of the LLM output is a separate live eval against the R20
 * transcript — flaky/keyed, not run in CI).
 * Created: 2026-07-30
 */
const {
  buildCoachFeedbackPromptI18n,
  RUBRIC_KEYS,
} = require('../../shared/services/observe/observe-coach-feedback');

describe('bd-2408 · coach-feedback "try" must not re-suggest a performed behaviour', () => {
  const prompt = buildCoachFeedbackPromptI18n('FO: ... Mwalimu: ...', { foName: 'Khadija' }, 'ur');

  it('pins the "try" move to a rubric key judged FALSE and forbids re-suggesting a TRUE one', () => {
    expect(prompt).toMatch(/rubric key you judged FALSE/i);
    expect(prompt).toMatch(/NEVER suggest a behaviour you judged TRUE/i);
  });

  it('names the elicited_if_then false-negative explicitly (the R20 case)', () => {
    expect(prompt).toContain('elicited_if_then');
    expect(prompt).toMatch(/do NOT tell them to "ask the teacher to name the step/i);
  });

  it('still exposes the officer rubric keys (elicited_if_then present)', () => {
    expect(RUBRIC_KEYS).toContain('elicited_if_then');
  });
});
