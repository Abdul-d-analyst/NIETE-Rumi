/**
 * bd-2430 — the native-text Support Brief view model (ported invariants):
 * never a bare score/percent; 3-tier band chain only with >=2 points; honest
 * no-data variant; guidance footnote ALWAYS; Urdu → RTL.
 */
const { buildBriefViewModel, BANDS } = require('../../shared/services/observe/observe-brief-card');

const MOVES = [
  { areaKey: 'student_engagement', text: 'Watch who answers.' },
  { areaKey: 'lesson_plan_fidelity', text: 'Open the plan together.' },
  { areaKey: 'teacher_subject_knowledge', text: 'Ask for one worked example.' },
];

describe('buildBriefViewModel', () => {
  test('empty trend → first-visit copy, no trend chain, footnote present', () => {
    const vm = buildBriefViewModel({ teacher: { teacher_name: 'Abid' }, trend: [], moves: MOVES });
    expect(vm.showTrend).toBe(false);
    expect(vm.firstVisit).toBe(true);
    expect(vm.guidance_text.length).toBeGreaterThan(0);
    expect(vm.moves_text).toMatch(/^1\. /);
  });

  test('one point → getting-started copy', () => {
    const vm = buildBriefViewModel({ teacher: {}, trend: [{ date: '2026-07', pct: 50 }], moves: MOVES });
    expect(vm.showTrend).toBe(false);
    expect(vm.firstVisit).toBe(false);
  });

  test('>=2 points → band arrow chain with session count, and NO bare percentage anywhere', () => {
    const vm = buildBriefViewModel({
      teacher: { teacher_name: 'Abid' },
      trend: [{ date: '2026-05', pct: 30 }, { date: '2026-07', pct: 70 }],
      strength: 'x', growth: 'y', moves: MOVES,
    });
    expect(vm.showTrend).toBe(true);
    expect(vm.trend_text).toContain('→');
    expect(vm.trend_text).toContain(BANDS.emerging.en);
    expect(vm.trend_text).toContain(BANDS.proficient.en);
    expect(JSON.stringify(vm)).not.toMatch(/\d{1,3}%/);
  });

  test('noData → honest lines, no fabricated strength', () => {
    const vm = buildBriefViewModel({ teacher: {}, trend: [], moves: MOVES, noData: true });
    expect(vm.noData).toBe(true);
    expect(vm.strength_text).toMatch(/No coaching data|ℹ️/);
    expect(vm.firstVisit).toBe(true);
  });

  test('Urdu leader → RTL + Urdu chrome', () => {
    const vm = buildBriefViewModel({
      teacher: { teacher_name: 'Abid', preferred_language: 'ur' },
      trend: [{ pct: 30 }, { pct: 70 }], strength: 'س', growth: 'ن', moves: MOVES,
    });
    expect(vm.rtl).toBe(true);
    expect(/[؀-ۿ]/.test(vm.moves_intro)).toBe(true);
    expect(vm.trend_text).toContain(BANDS.proficient.ur);
  });

  test('unsupported language clamps to en (NIETE offers ur/en only)', () => {
    const vm = buildBriefViewModel({ teacher: { preferred_language: 'sw' }, trend: [], moves: MOVES });
    expect(vm.lang).toBe('en');
  });
});
