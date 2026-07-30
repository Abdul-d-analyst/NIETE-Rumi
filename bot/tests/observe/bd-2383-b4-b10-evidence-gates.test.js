/**
 * bd-2383 — B4 (Prior Knowledge) & B10 (Lesson Closure) named-evidence gates.
 *
 * The bd-2370 re-score showed the global scoring-discipline rule fixed the
 * generic-able indicators (Questioning 37%→4%, Differentiation 30%→4%) but
 * did NOT bite B4 (96% Proficient+) or B10 (89%) — the model credits ANY
 * warm-up / that the lesson closed at all. Naveera R4: Proficient needs the
 * teacher restating 2+ NAMED concepts; Highly Effective a STUDENT restating/
 * applying. These are per-indicator aiDetectionMethod gates, not another
 * global sentence.
 *
 * This asserts both gates exist and are injected into the FICO system prompt.
 * (Whether they actually move the scores is confirmed by re-running the bd-2370
 * rescore harness over the 27 real sessions — a keyed LLM eval, not CI.)
 * Created: 2026-07-30
 */
const fico = require('../../shared/services/coaching/frameworks/fico-framework');

describe('bd-2383 · B4/B10 named-evidence gates', () => {
  const { domains } = fico.getScoringConstants();
  const byId = {};
  for (const section of Object.values(domains)) {
    for (const ind of section.indicators) byId[ind.id] = ind;
  }

  it('B4 has a named-evidence aiDetectionMethod (2+ named concepts / student recall)', () => {
    expect(byId.B4).toBeTruthy();
    expect(byId.B4.aiDetectionMethod).toBeTruthy();
    expect(byId.B4.aiDetectionMethod).toMatch(/TWO OR MORE NAMED concepts/);
    expect(byId.B4.aiDetectionMethod).toMatch(/do NOT score above 2/i);
  });

  it('B10 rejects a closed "did you understand?" check as consolidation', () => {
    expect(byId.B10).toBeTruthy();
    expect(byId.B10.aiDetectionMethod).toBeTruthy();
    expect(byId.B10.aiDetectionMethod).toMatch(/samajh aa gayi/i);
    expect(byId.B10.aiDetectionMethod).toMatch(/TWO OR MORE NAMED key points/);
  });

  it('both gates are injected into the FICO system prompt', () => {
    const prompt = fico.getSystemPrompt();
    expect(prompt).toContain('AI Detection Method:');
    // the B4 + B10 gate phrasing reaches the prompt the model actually sees
    expect(prompt).toMatch(/TWO OR MORE NAMED concepts/);
    expect(prompt).toMatch(/not consolidation/);
  });
});
