/**
 * bd-2529 (BUG-141 port) / BUG-141 — Attendance delivery: persist leave_count (Patch 5) +
 * opt-in overwrite of an already-marked day (Patch 7a). TDD: red-first.
 */

const mockAttendanceGenerator = {
  createExcelBuffer: jest.fn(),
  createMonthlyRegisterBufferFromData: jest.fn(),
  formatFileName: jest.fn(),
  formatMonthlyFileName: jest.fn(),
  formatDateForDisplay: jest.fn()
};
const mockWhatsAppService = { sendDocument: jest.fn(), sendDocumentFromUrl: jest.fn() };
const mockConversationService = { clearSessionState: jest.fn() };
const mockR2 = { uploadBuffer: jest.fn(), getSignedUrl: jest.fn() };
const mockSupabase = { from: jest.fn() };

jest.mock('../../bot/shared/services/attendance-generator.service', () => mockAttendanceGenerator);
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsAppService);
jest.mock('../../bot/shared/services/attendance-conversation.service', () => mockConversationService);
jest.mock('../../bot/shared/storage/r2', () => mockR2);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp' }));
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  unlinkSync: jest.fn()
}));

const AttendanceDeliveryService = require('../../bot/shared/services/attendance-delivery.service');

/** Build a chainable checkExistingSession result: select().eq().eq().eq().single() */
function checkExistingChain(resolved) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue(resolved)
          })
        })
      })
    })
  };
}

describe('bd-2529 (BUG-141 port) delivery leave_count + overwrite', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('leave_count persistence (Patch 5)', () => {
    it('includes leave_count in the attendance_sessions insert', async () => {
      const records = [
        { status: 'present' }, { status: 'present' },
        { status: 'absent' }, { status: 'leave' }
      ];
      const sessionData = { selectedListId: 'list-1', records };

      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: 'session-1' }, error: null })
      });

      let sessCalls = 0;
      mockSupabase.from.mockImplementation((table) => {
        if (table === 'attendance_sessions') {
          sessCalls++;
          if (sessCalls === 1) return checkExistingChain({ data: null, error: { code: 'PGRST116' } });
          return { insert: mockInsert };
        }
        // attendance_records insert
        return { insert: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ data: [], error: null }) }) };
      });

      const res = await AttendanceDeliveryService.saveToDatabase('u1', sessionData, 'url', { sessionType: 'full_day' });

      expect(res.sessionId).toBe('session-1');          // fresh day still saves first try
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        present_count: 2, absent_count: 1, leave_count: 1
      }));
    });
  });

  describe('opt-in overwrite (Patch 7a)', () => {
    const existing = { id: 'old-1', total_students: 3, present_count: 3, absent_count: 0 };

    it('without overwrite flag: still blocks with isDuplicate (safety intact)', async () => {
      mockSupabase.from.mockImplementation((table) => {
        if (table === 'attendance_sessions') return checkExistingChain({ data: existing, error: null });
        return {};
      });

      const res = await AttendanceDeliveryService.saveToDatabase(
        'u1',
        { selectedListId: 'list-1', records: [{ status: 'present' }] },
        'url',
        { sessionType: 'full_day' }
      );

      expect(res.isDuplicate).toBe(true);
    });

    it('with overwrite:true: deletes old records, updates the session, re-inserts, returns updated', async () => {
      const deleteEq = jest.fn().mockResolvedValue({ error: null });
      const updateEq = jest.fn().mockResolvedValue({ error: null });
      const recordsInsert = jest.fn().mockResolvedValue({ error: null });
      const recordsDelete = jest.fn().mockReturnValue({ eq: deleteEq });
      const sessionUpdate = jest.fn().mockReturnValue({ eq: updateEq });

      let sessCalls = 0;
      mockSupabase.from.mockImplementation((table) => {
        if (table === 'attendance_sessions') {
          sessCalls++;
          if (sessCalls === 1) return checkExistingChain({ data: existing, error: null });
          return { update: sessionUpdate };
        }
        // attendance_records: delete().eq() then insert()
        return { delete: recordsDelete, insert: recordsInsert };
      });

      const records = [
        { studentId: 's1', studentName: 'A', status: 'present' },
        { studentId: 's2', studentName: 'B', status: 'leave' }
      ];
      const res = await AttendanceDeliveryService.saveToDatabase(
        'u1',
        { selectedListId: 'list-1', records, overwrite: true, markingMethod: 'tap' },
        'url',
        { sessionType: 'full_day' }
      );

      expect(res.updated).toBe(true);
      expect(recordsDelete).toHaveBeenCalled();
      expect(deleteEq).toHaveBeenCalledWith('session_id', 'old-1');
      expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
        leave_count: 1, was_manually_edited: true
      }));
      expect(recordsInsert).toHaveBeenCalled();
    });
  });
});
