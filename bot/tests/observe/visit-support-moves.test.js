/**
 * bd-2430 — leader-directed support moves for NIETE (FICO sections).
 * Moves are watch-for/suggest coaching moves for the COACH, not teacher to-dos.
 * Language: ur/en only (NIETE market — Rule 20 / bd-2405: never Kiswahili).
 */
const {
  buildMoves, openingTips, MOVE_LIBRARY, OPENING_TIPS, FICO_AREAS, KNOWN_AREAS,
} = require('../../shared/services/observe/observe-support-moves');

describe('FICO move library', () => {
  test('covers all four FICO sections with >=2 moves in en + ur', () => {
    expect(FICO_AREAS).toEqual([
      'lesson_plan_fidelity', 'high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge',
    ]);
    for (const area of FICO_AREAS) {
      expect(MOVE_LIBRARY[area].length).toBeGreaterThanOrEqual(2);
      for (const m of MOVE_LIBRARY[area]) {
        expect(m.text.en).toBeTruthy();
        expect(m.text.ur).toBeTruthy();
        expect(/[؀-ۿ]/.test(m.text.ur)).toBe(true);
      }
    }
    // KNOWN_AREAS is what leader-source uses to accept analysis domain keys
    for (const a of FICO_AREAS) expect(KNOWN_AREAS).toContain(a);
  });

  test('3-4 moves, weakest area first, in the leader language', async () => {
    const moves = await buildMoves({ preferred_language: 'ur' }, { gaps: [], weakestArea: 'student_engagement' });
    expect(moves.length).toBeGreaterThanOrEqual(3);
    expect(moves.length).toBeLessThanOrEqual(4);
    expect(moves[0].areaKey).toBe('student_engagement');
    expect(moves.every((m) => /[؀-ۿ]/.test(m.text))).toBe(true);
  });

  test('FICO indicator gap ids (B4, C2, f1) map to their sections', async () => {
    const moves = await buildMoves({ preferred_language: 'en' }, { gaps: ['B4', 'f1'] });
    expect(moves[0].areaKey).toBe('lesson_plan_fidelity');
    expect(moves[1].areaKey).toBe('teacher_subject_knowledge');
  });

  test('unknown language floors to English; never empty', async () => {
    const moves = await buildMoves({ preferred_language: 'xx' }, {});
    expect(moves.length).toBeGreaterThanOrEqual(3);
    expect(moves.every((m) => typeof m.text === 'string' && m.text.length > 0)).toBe(true);
  });

  test('opening tips: 4 first-visit tips en + ur', () => {
    expect(OPENING_TIPS).toHaveLength(4);
    expect(openingTips('ur').every((t) => /[؀-ۿ]/.test(t.text))).toBe(true);
    expect(openingTips('en').every((t) => t.areaKey === 'opening')).toBe(true);
  });
});
