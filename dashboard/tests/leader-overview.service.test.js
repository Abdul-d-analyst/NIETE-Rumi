/**
 * bd-2434 — Leader "My Patch" overview (TDD, red-first). NIETE port of bd-2386.
 *
 * summarizePatch is a pure aggregation over getPatchTeachers' output — the KPIs
 * the My Patch home shows (headline counts + average score) and the focus list
 * (who needs attention: on-Rumi teachers with the lowest recent scores). No new
 * DB round-trip; it reuses the validated patch resolver.
 */

const { summarizePatch } = require('../services/leader-overview.service');

const PATCH = [
  { name: 'A', onRumi: true, coachingSessions: 3, lessonPlans: 7, lastScore: 71, lastSessionAt: '2026-07-20T10:00:00Z' },
  { name: 'B', onRumi: true, coachingSessions: 5, lessonPlans: 2, lastScore: 48, lastSessionAt: '2026-07-22T10:00:00Z' },
  { name: 'C', onRumi: true, coachingSessions: 1, lessonPlans: 0, lastScore: 90, lastSessionAt: '2026-07-10T10:00:00Z' },
  { name: 'D', onRumi: false, coachingSessions: 0, lessonPlans: 0, lastScore: null, lastSessionAt: null },
];

describe('summarizePatch', () => {
  it('computes headline KPIs over the whole patch', () => {
    const s = summarizePatch(PATCH);
    expect(s.totalTeachers).toBe(4);
    expect(s.onRumi).toBe(3);
    expect(s.notOnRumi).toBe(1);
    expect(s.totalCoachingSessions).toBe(9);   // 3+5+1+0
    expect(s.totalLessonPlans).toBe(9);        // 7+2+0+0
  });

  it('averages only the teachers who have a score (ignores nulls / off-Rumi)', () => {
    const s = summarizePatch(PATCH);
    // (71 + 48 + 90) / 3 = 69.67
    expect(s.avgLastScore).toBe(69.7);
    expect(s.scoredTeachers).toBe(3);
  });

  it('builds a focus list of the lowest-scoring teachers first', () => {
    const s = summarizePatch(PATCH, { focusLimit: 2 });
    expect(s.focus.map((t) => t.name)).toEqual(['B', 'A']);   // 48 then 71
    expect(s.focus).toHaveLength(2);
  });

  it('handles an empty patch without dividing by zero', () => {
    const s = summarizePatch([]);
    expect(s.totalTeachers).toBe(0);
    expect(s.avgLastScore).toBeNull();
    expect(s.focus).toEqual([]);
  });

  it('handles a patch where nobody has been coached yet', () => {
    const s = summarizePatch([{ name: 'X', onRumi: true, coachingSessions: 0, lessonPlans: 1, lastScore: null }]);
    expect(s.avgLastScore).toBeNull();
    expect(s.scoredTeachers).toBe(0);
    expect(s.focus).toEqual([]);   // no scores → nobody to flag
  });
});
