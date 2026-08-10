/**
 * bd-2529 / BUG-141 port — Attendance fixes (conversation service)
 * TDD: red-first tests for the state-machine wiring fixes.
 *
 * Covers:
 *  - Fix A (#12): switchToTapFromVoice accepts AWAITING_VOICE_INPUT (was infinite loop)
 *  - Fix B (#5/#8): startAttendanceSession enters AWAITING_DATE_SELECTION first
 *  - Fix C2: chosen date threads through the session (selectedDate preserved)
 *  - Fix E (#14): once-daily -> full_day + skips AM/PM; twice-daily -> AWAITING_SESSION_TYPE
 *  - Fix #9: overwrite-confirm flow (opt-in replace of an already-marked day)
 */

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn()
};

const mockStudentListService = {
  getStudentListsByUser: jest.fn(),
  getStudentsByList: jest.fn(),
  getStudentListById: jest.fn()
};

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/student-list.service', () => mockStudentListService);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const AttendanceConversationService = require('../../bot/shared/services/attendance-conversation.service');

/** Grab the last object persisted via saveSessionState (redisService.set). */
function lastSaved() {
  const calls = mockRedis.set.mock.calls;
  return calls.length ? calls[calls.length - 1][1] : null;
}

describe('bd-2529 attendance conversation fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.delete.mockResolvedValue(true);
  });

  // ---------------------------------------------------------------------------
  // Fix A (#12) — voice -> tap switch
  // ---------------------------------------------------------------------------
  describe('switchToTapFromVoice (Fix A / #12)', () => {
    it('opens the Tap-to-Mark flow from AWAITING_VOICE_INPUT (no more loop)', async () => {
      const sessionState = {
        state: 'AWAITING_VOICE_INPUT',
        userId: 'u1',
        selectedListId: 'list-1',
        selectedClass: { id: 'list-1', class_name: 'Grade 4', section: 'A' }
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(sessionState));
      mockStudentListService.getStudentsByList.mockResolvedValue({
        data: [{ id: 's1', student_name: 'Zara' }, { id: 's2', student_name: 'Ahmed' }],
        error: null
      });

      const result = await AttendanceConversationService.switchToTapFromVoice('u1');

      expect(result.action).toBe('SEND_MARKING_FLOW');
      expect(result.students).toHaveLength(2);
      const saved = lastSaved();
      expect(saved.state).toBe('AWAITING_VERIFICATION');
      expect(saved.markingMethod).toBe('tap');
    });

    it('rejects with INVALID_STATE when not in AWAITING_VOICE_INPUT', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ state: 'AWAITING_MARKING_METHOD' }));
      const result = await AttendanceConversationService.switchToTapFromVoice('u1');
      expect(result.action).toBe('INVALID_STATE');
    });
  });

  // ---------------------------------------------------------------------------
  // Fix B (#5/#8) — date prompt fires first
  // ---------------------------------------------------------------------------
  describe('startAttendanceSession asks for the date first (Fix B)', () => {
    it('returns ASK_DATE_SELECTION and parks in AWAITING_DATE_SELECTION', async () => {
      const classList = [{ id: 'list-1', class_name: 'Grade 4', section: 'A', attendance_frequency: 'once' }];
      mockStudentListService.getStudentListsByUser.mockResolvedValue({ data: classList, error: null });

      const result = await AttendanceConversationService.startAttendanceSession('u1');

      expect(result.action).toBe('ASK_DATE_SELECTION');
      const saved = lastSaved();
      expect(saved.state).toBe('AWAITING_DATE_SELECTION');
      expect(saved.classList).toHaveLength(1);
    });

    it('keeps the fast path when a caller pre-supplies a date', async () => {
      const classList = [{ id: 'list-1', class_name: 'Grade 4', section: 'A', attendance_frequency: 'once' }];
      mockStudentListService.getStudentListsByUser.mockResolvedValue({ data: classList, error: null });

      const result = await AttendanceConversationService.startAttendanceSession('u1', { selectedDate: '2026-07-20' });

      expect(result.action).toBe('ASK_MARKING_METHOD');
    });
  });

  // ---------------------------------------------------------------------------
  // Fix C2 + E — chosen date threads through; once vs twice routing
  // ---------------------------------------------------------------------------
  describe('handleDateSelection threads the date + routes by frequency (Fix C2 / E)', () => {
    function isoDaysAgo(n) {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString().split('T')[0];
    }

    it('single once-daily class: yesterday threads through, goes straight to marking with full_day', async () => {
      const sessionState = {
        state: 'AWAITING_DATE_SELECTION',
        userId: 'u1',
        classList: [{ id: 'list-1', class_name: 'Grade 4', section: 'A', attendance_frequency: 'once' }]
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(sessionState));

      // "2" => yesterday
      const result = await AttendanceConversationService.handleDateSelection('u1', '2');

      expect(result.action).toBe('ASK_MARKING_METHOD');
      const saved = lastSaved();
      expect(saved.selectedDate).toBe(isoDaysAgo(1));      // C2: date threaded, not today
      expect(saved.sessionType).toBe('full_day');          // E: once -> full_day
      expect(saved.state).toBe('AWAITING_MARKING_METHOD');  // E: NOT AWAITING_SESSION_TYPE
    });

    it('single twice-daily class: enters AWAITING_SESSION_TYPE (AM/PM)', async () => {
      const sessionState = {
        state: 'AWAITING_DATE_SELECTION',
        userId: 'u1',
        classList: [{ id: 'list-1', class_name: 'Grade 4', section: 'A', attendance_frequency: 'twice' }]
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(sessionState));

      const result = await AttendanceConversationService.handleDateSelection('u1', '1');

      expect(result.action).toBe('ASK_SESSION_TYPE');
      expect(lastSaved().state).toBe('AWAITING_SESSION_TYPE');
    });

    it('multiple classes: asks for class selection, keeping the chosen date', async () => {
      const sessionState = {
        state: 'AWAITING_DATE_SELECTION',
        userId: 'u1',
        classList: [
          { id: 'list-1', class_name: 'Grade 4', section: 'A', attendance_frequency: 'once' },
          { id: 'list-2', class_name: 'Grade 5', section: null, attendance_frequency: 'once' }
        ]
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(sessionState));

      const result = await AttendanceConversationService.handleDateSelection('u1', '3');

      expect(result.action).toBe('ASK_CLASS_SELECTION');
      const saved = lastSaved();
      expect(saved.state).toBe('AWAITING_CLASS_SELECTION');
      expect(saved.selectedDate).toBe(isoDaysAgo(2));      // "3" => two days ago, threaded
    });
  });

  // ---------------------------------------------------------------------------
  // Fix #9 — overwrite an already-marked day (opt-in)
  // ---------------------------------------------------------------------------
  describe('overwrite confirm flow (Fix #9)', () => {
    it('storePendingOverwrite parks the records in AWAITING_OVERWRITE_CONFIRM', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ state: 'PROCESSING', userId: 'u1' }));
      await AttendanceConversationService.storePendingOverwrite('u1', {
        selectedListId: 'list-1',
        records: [{ studentId: 's1', status: 'absent' }]
      });
      const saved = lastSaved();
      expect(saved.state).toBe('AWAITING_OVERWRITE_CONFIRM');
      expect(saved.records).toHaveLength(1);
    });

    it('replies "overwrite" -> GENERATE_ATTENDANCE with overwrite:true', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({
        state: 'AWAITING_OVERWRITE_CONFIRM',
        userId: 'u1',
        records: [{ studentId: 's1', status: 'absent' }],
        selectedClass: { id: 'list-1', class_name: 'Grade 4' }
      }));

      const result = await AttendanceConversationService.handleOverwriteConfirm('u1', 'overwrite');

      expect(result.action).toBe('GENERATE_ATTENDANCE');
      expect(result.overwrite).toBe(true);
      expect(result.records).toHaveLength(1);
      expect(lastSaved().state).toBe('PROCESSING');
    });

    it('replies "cancel" -> keeps existing record and clears session', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({
        state: 'AWAITING_OVERWRITE_CONFIRM', userId: 'u1'
      }));

      const result = await AttendanceConversationService.handleOverwriteConfirm('u1', 'cancel');

      expect(result.action).toBe('SESSION_CANCELLED');
      expect(mockRedis.delete).toHaveBeenCalled();
    });

    it('rejects overwrite confirm from the wrong state', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ state: 'IDLE' }));
      const result = await AttendanceConversationService.handleOverwriteConfirm('u1', 'overwrite');
      expect(result.action).toBe('INVALID_STATE');
    });
  });
});
