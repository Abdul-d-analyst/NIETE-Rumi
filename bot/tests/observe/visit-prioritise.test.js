/**
 * bd-2430 — visit-picker teacher ordering (ported from main-bot FEAT-116 bd-2329).
 * needScore = ½·supportNeed(1−avgScore) + ½·recencyNeed(days-since-visit/30 cap 1).
 * Lowest raw score is NEVER privileged on its own; never-visited teachers are
 * "new" (say hello), not "worst".
 */
const {
  orderTeachers, classify, needScore, RECENT_DAYS, SUPPORT_THRESHOLD,
} = require('../../shared/services/observe/assignment/prioritise');

const TODAY = '2026-07-31';

describe('prioritise (visit picker ordering)', () => {
  test('low-score + overdue tops the list', () => {
    const out = orderTeachers([
      { teacher_name: 'HighRecent', lastVisitAt: '2026-07-29', score: 0.9 },
      { teacher_name: 'LowOverdue', lastVisitAt: '2026-05-01', score: 0.3 },
      { teacher_name: 'MidRecent', lastVisitAt: '2026-07-28', score: 0.6 },
    ], { today: TODAY });
    expect(out[0].teacher_name).toBe('LowOverdue');
  });

  test('low-score never-visited outranks high-score recently-seen', () => {
    const out = orderTeachers([
      { teacher_name: 'HighSeen', lastVisitAt: '2026-07-29', score: 0.92 },
      { teacher_name: 'LowNew', lastVisitAt: null, score: 0.35 },
    ], { today: TODAY });
    expect(out[0].teacher_name).toBe('LowNew');
  });

  test('among never-visited, order collapses to score ascending; no-score last', () => {
    const out = orderTeachers([
      { teacher_name: 'NoScore', lastVisitAt: null, score: null },
      { teacher_name: 'High', lastVisitAt: null, score: 0.8 },
      { teacher_name: 'Low', lastVisitAt: null, score: 0.4 },
    ], { today: TODAY });
    expect(out.map((t) => t.teacher_name)).toEqual(['Low', 'NoScore', 'High']);
  });

  test('classify: never → new, <=21d → recent, older → due', () => {
    expect(classify({ lastVisitAt: null }, TODAY)).toBe('new');
    expect(classify({ lastVisitAt: '2026-07-20' }, TODAY)).toBe('recent');
    expect(classify({ lastVisitAt: '2026-06-01' }, TODAY)).toBe('due');
    expect(RECENT_DAYS).toBe(21);
  });

  test('needsSupport flag at the 0.6 threshold; rows keep band + lastVisitAt', () => {
    const out = orderTeachers([
      { teacher_name: 'A', lastVisitAt: '2026-07-01', score: 0.55 },
      { teacher_name: 'B', lastVisitAt: '2026-07-01', score: 0.75 },
    ], { today: TODAY });
    const a = out.find((t) => t.teacher_name === 'A');
    const b = out.find((t) => t.teacher_name === 'B');
    expect(SUPPORT_THRESHOLD).toBe(0.6);
    expect(a.needsSupport).toBe(true);
    expect(b.needsSupport).toBe(false);
    expect(a.priority).toBe('due');
    expect(a.lastVisitAt).toBe('2026-07-01');
  });

  test('accepts 0..100 scores; empty input → []', () => {
    const out = orderTeachers([
      { teacher_name: 'Pct', lastVisitAt: '2026-07-01', score: 55 },
    ], { today: TODAY });
    expect(out[0].needsSupport).toBe(true);
    expect(orderTeachers([], { today: TODAY })).toEqual([]);
    expect(typeof needScore).toBe('function');
  });
});
