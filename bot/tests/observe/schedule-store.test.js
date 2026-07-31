/**
 * bd-2441 — observation-schedule store (red-first).
 * One ACTIVE schedule per coach×school×teacher (re-scheduling updates in
 * place); ascending-date listing puts overdue rows first naturally, each
 * flagged; markDone targets only the matching upcoming row; off-Rumi teachers
 * (name-slug ext ids) round-trip; malformed dates rejected.
 */
const mockRows = [];
let mockIdSeq = 1;

function mockChain(table) {
  const state = { filters: [], patch: null, insert: null };
  const api = {
    select: () => api,
    eq: (c, v) => { state.filters.push([c, v]); return api; },
    order: () => api,
    update: (patch) => { state.patch = patch; return api; },
    insert: (row) => {
      const r = { id: `os-${mockIdSeq++}`, status: 'upcoming', ...row };
      mockRows.push(r);
      return { select: () => ({ single: () => Promise.resolve({ data: r, error: null }) }) };
    },
    then: (res, rej) => {
      let out = mockRows.filter((r) => state.filters.every(([c, v]) => r[c] === v));
      if (state.patch) { out.forEach((r) => Object.assign(r, state.patch)); }
      return Promise.resolve({ data: out, error: null }).then(res, rej);
    },
  };
  return api;
}
jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockChain(t) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Store = require('../../shared/services/observe/observe-schedule.service');

const L = 'coach-1';

beforeEach(() => { mockRows.length = 0; mockIdSeq = 1; });

describe('saveSchedule', () => {
  test('inserts a new upcoming row with all fields', async () => {
    const row = await Store.saveSchedule(L, {
      school_ext_id: 'niete:401', teacher_ext_id: '923331234567',
      teacher_name: 'Abid Ullah', school_name: 'IMCB Bhara Kau',
      date: '2026-08-06', slot: '08:30',
    });
    expect(row.scheduled_for).toBe('2026-08-06');
    expect(row.scheduled_slot).toBe('08:30');
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0].status).toBe('upcoming');
  });

  test('re-scheduling the same teacher UPDATES the active row (no dupes)', async () => {
    await Store.saveSchedule(L, { school_ext_id: 'niete:401', teacher_ext_id: 't1', teacher_name: 'A', school_name: 'S', date: '2026-08-06', slot: '08:30' });
    await Store.saveSchedule(L, { school_ext_id: 'niete:401', teacher_ext_id: 't1', teacher_name: 'A', school_name: 'S', date: '2026-08-10', slot: '10:00' });
    const active = mockRows.filter((r) => r.status === 'upcoming');
    expect(active).toHaveLength(1);
    expect(active[0].scheduled_for).toBe('2026-08-10');
    expect(active[0].scheduled_slot).toBe('10:00');
  });

  test('off-Rumi name-slug teacher_ext_id round-trips', async () => {
    const row = await Store.saveSchedule(L, { school_ext_id: 'niete:401', teacher_ext_id: 'name:no-phone', teacher_name: 'No Phone', school_name: 'S', date: '2026-08-06', slot: '08:30' });
    expect(row.teacher_ext_id).toBe('name:no-phone');
  });

  test('malformed date rejected', async () => {
    await expect(Store.saveSchedule(L, { school_ext_id: 's', teacher_ext_id: 't', date: 'tomorrow', slot: '08:30' }))
      .rejects.toThrow(/date/i);
    await expect(Store.saveSchedule(L, { school_ext_id: 's', teacher_ext_id: 't', date: '2026-13-45', slot: '08:30' }))
      .rejects.toThrow(/date/i);
  });
});

describe('listUpcoming / countUpcoming', () => {
  test('overdue rows sort first (ascending date) and carry the overdue flag', async () => {
    await Store.saveSchedule(L, { school_ext_id: 's1', teacher_ext_id: 'future', teacher_name: 'F', school_name: 'S', date: '2099-01-01', slot: '08:30' });
    await Store.saveSchedule(L, { school_ext_id: 's1', teacher_ext_id: 'past', teacher_name: 'P', school_name: 'S', date: '2020-01-01', slot: '08:30' });
    const list = await Store.listUpcoming(L);
    expect(list[0].teacher_ext_id).toBe('past');
    expect(list[0].overdue).toBe(true);
    expect(list[1].overdue).toBe(false);
    expect(await Store.countUpcoming(L)).toBe(2);
  });

  test('done rows are excluded', async () => {
    await Store.saveSchedule(L, { school_ext_id: 's1', teacher_ext_id: 't1', teacher_name: 'A', school_name: 'S', date: '2026-08-06', slot: '08:30' });
    await Store.markDone(L, 't1', 's1', 'sess-9');
    expect(await Store.listUpcoming(L)).toHaveLength(0);
    expect(await Store.countUpcoming(L)).toBe(0);
  });
});

describe('markDone', () => {
  test('flips ONLY the matching upcoming row and stamps session_id', async () => {
    await Store.saveSchedule(L, { school_ext_id: 's1', teacher_ext_id: 't1', teacher_name: 'A', school_name: 'S', date: '2026-08-06', slot: '08:30' });
    await Store.saveSchedule(L, { school_ext_id: 's1', teacher_ext_id: 't2', teacher_name: 'B', school_name: 'S', date: '2026-08-07', slot: '09:00' });
    await Store.markDone(L, 't1', 's1', 'sess-42');
    const t1 = mockRows.find((r) => r.teacher_ext_id === 't1');
    const t2 = mockRows.find((r) => r.teacher_ext_id === 't2');
    expect(t1.status).toBe('done');
    expect(t1.session_id).toBe('sess-42');
    expect(t2.status).toBe('upcoming');
  });

  test('falls back to teacher-only match when school is missing; never throws', async () => {
    await Store.saveSchedule(L, { school_ext_id: 's1', teacher_ext_id: 't1', teacher_name: 'A', school_name: 'S', date: '2026-08-06', slot: '08:30' });
    await Store.markDone(L, 't1', null, 'sess-7');
    expect(mockRows[0].status).toBe('done');
    await expect(Store.markDone(L, 'nonexistent', null, 'x')).resolves.not.toThrow();
  });

  test('SLOTS covers 07:30..13:30 half-hours', () => {
    expect(Store.SLOTS[0]).toBe('07:30');
    expect(Store.SLOTS[Store.SLOTS.length - 1]).toBe('13:30');
    expect(Store.SLOTS).toHaveLength(13);
  });
});
