/**
 * bd-2430 — two-clean-sources invariant at the trend layer: the Support Brief's
 * trend must be the teacher's OWN AI-coaching only. Once the visit picker binds
 * leader observations to the teacher's user_id, loadTrendData would mix both —
 * unless the caller opts into teacherOwnOnly (adds `.is('observation_type', null)`).
 * Default behavior (hero report) is unchanged.
 */
const calls = [];

jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const filters = [];
    calls.push(filters);
    const api = {
      select: () => api,
      eq: (c, v) => { filters.push(['eq', c, v]); return api; },
      is: (c, v) => { filters.push(['is', c, v]); return api; },
      order: () => api,
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    return api;
  },
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { loadTrendData } = require('../../shared/services/coaching/coaching-trend.service');

describe('loadTrendData observation_type filtering', () => {
  beforeEach(() => { calls.length = 0; });

  test('default: NO observation_type filter (hero report unchanged)', async () => {
    await loadTrendData('u1');
    expect(calls[0].some(([op, col]) => op === 'is' && col === 'observation_type')).toBe(false);
  });

  test('teacherOwnOnly: filters observation_type IS NULL', async () => {
    await loadTrendData('u1', { teacherOwnOnly: true });
    expect(calls[0]).toContainEqual(['is', 'observation_type', null]);
  });
});
