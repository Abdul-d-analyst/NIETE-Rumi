/**
 * FEAT-106 #8 (bd-2372) — lesson-plan content validation.
 *
 * Irum (ICT, DC-9) sent an application/leave letter; it was accepted as a
 * lesson plan and "analysed" for ~20 minutes with no reply. The extraction
 * worker parses ANY document into the LP schema and marks it 'completed' —
 * there was no check that the document is actually a lesson plan.
 *
 * isLikelyLessonPlan() reads the parsed structured data and returns:
 *   true  — has enough lesson-plan signal (objectives / activities / assessment
 *           / subject / topic, or an explicit is_lesson_plan flag)
 *   false — clearly not a lesson plan (a letter, a form, blank prose)
 *   null  — cannot classify (no structured data extracted)
 */

const { isLikelyLessonPlan } = require('../../bot/shared/services/coaching/lesson-plan-classifier');

describe('FEAT-106 #8 — isLikelyLessonPlan', () => {
  it('flags a leave/application letter as NOT a lesson plan', () => {
    const leaveLetter = {
      objectives: [], activities: [], materials: [],
      assessment_methods: [], assessment_protocols: [],
      objectives_found: false, materials_found: false, assessment_found: false,
      subject: '', topic: '', is_lesson_plan: false,
    };
    expect(isLikelyLessonPlan(leaveLetter)).toBe(false);
  });

  it('recognises a real lesson plan', () => {
    const lp = {
      objectives: ['Students will add two-digit numbers'],
      activities: [{ title: 'warm-up' }],
      materials: ['counters'],
      assessment_methods: ['exit ticket'],
      objectives_found: true, materials_found: true, assessment_found: true,
      subject: 'Maths', topic: 'Addition', is_lesson_plan: true,
    };
    expect(isLikelyLessonPlan(lp)).toBe(true);
  });

  it('respects an explicit is_lesson_plan:false from the parser', () => {
    const oddballWithFlag = {
      objectives: ['something'], subject: 'General', topic: 'Notice',
      is_lesson_plan: false,
    };
    expect(isLikelyLessonPlan(oddballWithFlag)).toBe(false);
  });

  it('uses the heuristic when no explicit flag is present (letter → false)', () => {
    const letterNoFlag = {
      objectives: [], activities: [], materials: [], assessment_methods: [],
      subject: '', topic: '',
    };
    expect(isLikelyLessonPlan(letterNoFlag)).toBe(false);
  });

  it('uses the heuristic when no explicit flag is present (real LP → true)', () => {
    const lpNoFlag = {
      objectives: ['Identify nouns'], activities: [{ title: 'sort' }],
      subject: 'English', topic: 'Nouns',
    };
    expect(isLikelyLessonPlan(lpNoFlag)).toBe(true);
  });

  it('returns null when there is no structured data (cannot classify)', () => {
    expect(isLikelyLessonPlan(null)).toBeNull();
    expect(isLikelyLessonPlan(undefined)).toBeNull();
  });
});
