/**
 * bd-2345 — FICO V3 adoption (37 indicators, B/C/D/F).
 *
 * Prod was running a reduced FICO v2.0 (26 indicators) that did NOT match the
 * canonical "Coaching Framework" sheet the coaches were trained on. The codes
 * even meant different things (prod C4 = "Student Agency"; canonical C4 =
 * "Equitable Participation"). Four ICT coaches independently reported the
 * scoring as too lenient — crediting the PRESENCE of a move, not its effect.
 *
 * This pins the V3 structure + the global scoring-discipline rule so a future
 * edit can't silently drift back to the thin rubric.
 *
 * Section E (11 ASER-style assessment indicators) is deliberately EXCLUDED — it
 * is one-on-one reading/numeracy testing, not observable from a lesson recording.
 */

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const fico = require('../../shared/services/coaching/frameworks/fico-framework');

describe('bd-2345 — FICO V3 structure', () => {
  test('version is 3.0 and 37 indicators across B/C/D/F, max 148', () => {
    expect(fico.version).toBe('3.0');
    const c = fico.getScoringConstants();
    expect(c.totalIndicators).toBe(37);
    expect(fico.maxMarks).toBe(148);
  });

  test('section sizes match the canonical sheet: B10 C12 D7 F8', () => {
    const sp = fico.getSystemPrompt();
    const count = (sec) => (sp.match(new RegExp(`\\b${sec}\\d+ \\*\\*`, 'g')) || []).length;
    expect(count('B')).toBe(10);
    expect(count('C')).toBe(12);
    expect(count('D')).toBe(7);
    expect(count('F')).toBe(8);
  });

  test('C1 is Bloom-aligned questioning (the canonical indicator, not prod v2.0)', () => {
    const sp = fico.getSystemPrompt();
    expect(sp).toMatch(/C1 \*\*Quality Questioning/);
    // and the level-3 bar the coaches asked for is present verbatim from V3
    expect(sp).toMatch(/Open-ended questions dominate/i);
  });

  test('no Section E indicators leak into the observation prompt', () => {
    const sp = fico.getSystemPrompt();
    expect(sp).not.toMatch(/\bE\d+ \*\*/);
  });

  test('the prompt never renders an undefined AI Detection Method', () => {
    expect(fico.getSystemPrompt()).not.toMatch(/AI Detection Method: undefined/);
  });
});

describe('bd-2345 — global scoring discipline (the leniency fix)', () => {
  const sp = fico.getSystemPrompt();
  test('3+ requires evidence of EFFECT, not just presence', () => {
    expect(sp).toMatch(/SCORING DISCIPLINE/);
    expect(sp).toMatch(/cap the score at 2/i);
    expect(sp).toMatch(/NEVER infer/i);
  });
  test('a closed compliance check cannot reach Proficient on its own', () => {
    expect(sp).toMatch(/compliance check/i);
    expect(sp).toMatch(/samajh aa gayi/i);
  });
  test('questioning indicators require Bloom classification + open-ended majority', () => {
    expect(sp).toMatch(/Bloom/i);
    expect(sp).toMatch(/50%/);
  });
});

describe('bd-2345 — scoring math holds after the resize', () => {
  test('all-3 across 37 indicators = 111/148 = 75%', () => {
    const bysec = { B: 'lesson_plan_fidelity', C: 'high_leverage_practices', D: 'student_engagement', F: 'teacher_subject_knowledge' };
    const ids = (fico.getSystemPrompt().match(/\b([BCDF]\d+) \*\*/g) || []).map((x) => x.trim().split(' ')[0]);
    const analysis = { domains: {} };
    Object.values(bysec).forEach((s) => { analysis.domains[s] = { indicators: [] }; });
    ids.forEach((id) => analysis.domains[bysec[id[0]]].indicators.push({ id, score: 3 }));
    const scored = fico.computeScores(analysis);
    expect(scored.scores.overall_max_marks).toBe(148);
    expect(scored.scores.overall_marks).toBe(111);
    expect(scored.scores.overall_percentage).toBe(75);
    // per-section maxes: B40 C48 D28 F32
    expect(scored.domains.lesson_plan_fidelity.domain_max).toBe(40);
    expect(scored.domains.high_leverage_practices.domain_max).toBe(48);
    expect(scored.domains.student_engagement.domain_max).toBe(28);
    expect(scored.domains.teacher_subject_knowledge.domain_max).toBe(32);
  });
});
