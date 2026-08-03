/**
 * Teacher Attendance Conversation Service Tests (bd-2481, Phase 1)
 *
 * The principal-marks-teachers state machine. Text-based tap: a principal is
 * shown their school's teachers and marks who is absent / on leave; everyone
 * else is present. Leave requires a leave_type sub-step (AWAITING_LEAVE_TYPE).
 * On confirm it persists through the SAME TASK-133 backend (injected repo).
 */

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
jest.mock('../../shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { MockAttendanceRepository } = require('../../../dashboard/services/attendance-repository.service');
const Svc = require('../../shared/services/teacher-attendance-conversation.service');

const SCHOOL = 'school-1';
const PRINCIPAL = { id: 'principal-1', school_id: SCHOOL, role: 'principal' };

function seedRepo() {
  return new MockAttendanceRepository({
    teachers: [
      { id: 't1', first_name: 'Ayesha', last_name: 'Khan', role: 'teacher', school_id: SCHOOL, phone_number: '923001111111' },
      { id: 't2', first_name: 'Bilal', last_name: 'Ahmed', role: 'teacher', school_id: SCHOOL, phone_number: '923002222222' },
      { id: 't3', first_name: 'Carla', last_name: 'Dsouza', role: 'teacher', school_id: SCHOOL, phone_number: '923003333333' },
    ],
  });
}

// Helper: capture whatever the service last wrote to Redis so the next call sees it.
function wireRedis() {
  let stored = null;
  mockRedis.get.mockImplementation(async () => stored);
  mockRedis.set.mockImplementation(async (_k, v) => { stored = v; return true; });
  mockRedis.delete.mockImplementation(async () => { stored = null; return true; });
  return () => stored;
}

describe('TeacherAttendanceConversationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exports its states', () => {
    expect(Svc.STATES.AWAITING_MARKING).toBe('AWAITING_MARKING');
    expect(Svc.STATES.AWAITING_LEAVE_TYPE).toBe('AWAITING_LEAVE_TYPE');
    expect(Svc.STATES.AWAITING_VERIFICATION).toBe('AWAITING_VERIFICATION');
  });

  describe('startSession', () => {
    it('loads the school teachers and asks the principal to mark', async () => {
      wireRedis();
      const repo = seedRepo();
      const res = await Svc.startSession(PRINCIPAL.id, { user: PRINCIPAL, repository: repo });
      expect(res.action).toBe('ASK_MARKING');
      expect(res.message).toContain('Ayesha');
      expect(res.message).toContain('3'); // three teachers numbered
    });

    it('errors cleanly when the principal has no school linked', async () => {
      wireRedis();
      const repo = seedRepo();
      const res = await Svc.startSession(PRINCIPAL.id, { user: { id: 'p', role: 'principal' }, repository: repo });
      expect(res.action).toBe('NO_SCHOOL');
    });

    it('handles a school with no teachers', async () => {
      wireRedis();
      const repo = new MockAttendanceRepository({ teachers: [] });
      const res = await Svc.startSession(PRINCIPAL.id, { user: PRINCIPAL, repository: repo });
      expect(res.action).toBe('NO_TEACHERS');
    });
  });

  describe('parseMarkingInput', () => {
    it('marks everyone present on "all"', () => {
      const r = Svc.parseMarkingInput('all', 3);
      expect(r.absent).toEqual([]);
      expect(r.leave).toEqual([]);
      expect(r.allPresent).toBe(true);
    });

    it('parses absent numbers', () => {
      const r = Svc.parseMarkingInput('1, 3', 3);
      expect(r.absent.sort()).toEqual([1, 3]);
      expect(r.leave).toEqual([]);
    });

    it('parses leave with an L suffix', () => {
      const r = Svc.parseMarkingInput('2L', 3);
      expect(r.leave).toEqual([2]);
      expect(r.absent).toEqual([]);
    });

    it('rejects out-of-range numbers', () => {
      const r = Svc.parseMarkingInput('9', 3);
      expect(r.error).toBeTruthy();
    });
  });

  describe('full flow: absent + leave -> leave_type -> confirm -> persist', () => {
    it('persists all three teachers with converged Presence', async () => {
      const getStored = wireRedis();
      const repo = seedRepo();

      await Svc.startSession(PRINCIPAL.id, { user: PRINCIPAL, repository: repo, date: '2026-08-03' });

      // t1 present (unmarked), t2 absent, t3 leave.
      let res = await Svc.handleMarkingInput(PRINCIPAL.id, '2, 3L', { repository: repo });
      expect(res.action).toBe('ASK_LEAVE_TYPE'); // t3 needs a leave type
      expect(getStored().state).toBe(Svc.STATES.AWAITING_LEAVE_TYPE);

      // Leave type for t3 = sick
      res = await Svc.handleLeaveTypeInput(PRINCIPAL.id, '2'); // 2 = Sick
      expect(res.action).toBe('VERIFY');
      expect(getStored().state).toBe(Svc.STATES.AWAITING_VERIFICATION);

      // Confirm -> persist
      res = await Svc.handleVerification(PRINCIPAL.id, 'yes', { repository: repo });
      expect(res.action).toBe('SAVED');

      const rows = await repo.getAttendanceForSchool(SCHOOL, null, null);
      expect(rows).toHaveLength(3);
      const byId = Object.fromEntries(rows.map((r) => [r.teacher_id, r]));
      expect(byId.t1.status).toBe('present');
      expect(byId.t2.status).toBe('absent');
      expect(byId.t3.status).toBe('leave');
      expect(byId.t3.leave_type).toBe('sick');
      expect(rows.every((r) => r.marked_by_user_id === PRINCIPAL.id)).toBe(true);
    });

    it('cancel aborts without writing', async () => {
      wireRedis();
      const repo = seedRepo();
      await Svc.startSession(PRINCIPAL.id, { user: PRINCIPAL, repository: repo });
      await Svc.handleMarkingInput(PRINCIPAL.id, 'all', { repository: repo });
      const res = await Svc.handleVerification(PRINCIPAL.id, 'cancel', { repository: repo });
      expect(res.action).toBe('CANCELLED');
      const rows = await repo.getAttendanceForSchool(SCHOOL, null, null);
      expect(rows).toHaveLength(0);
    });
  });
});
