/**
 * bd-2529 / BUG-141 port — Leave is a first-class status in the generator.
 *
 * Ported from the main bot's bd-2340 fix bundle (Patch 4). The v1 status set is
 * Present / Absent / Leave — "Late" is deliberately NOT surfaced.
 *
 * Before this fix NIETE-Rumi collapsed every non-present status to "A", so a
 * teacher who marked a child on approved leave saw them reported as absent in
 * the Excel sheet and in the monthly matrix.
 */

const AttendanceGeneratorService = require('../../bot/shared/services/attendance-generator.service');

describe('bd-2529 — generator treats leave as its own status', () => {
  describe('getStatusDisplay', () => {
    it('renders leave as L, not A', () => {
      expect(AttendanceGeneratorService.getStatusDisplay('leave')).toBe('L');
    });

    it('accepts the "excused" synonym', () => {
      expect(AttendanceGeneratorService.getStatusDisplay('excused')).toBe('L');
    });

    it('is case-insensitive, like the present/absent branches', () => {
      expect(AttendanceGeneratorService.getStatusDisplay('LEAVE')).toBe('L');
    });

    it('still renders present and absent unchanged', () => {
      expect(AttendanceGeneratorService.getStatusDisplay('present')).toBe('P');
      expect(AttendanceGeneratorService.getStatusDisplay('absent')).toBe('A');
    });

    it('leaves an unknown status as ?', () => {
      expect(AttendanceGeneratorService.getStatusDisplay('banana')).toBe('?');
    });
  });

  describe('calculateSummaryStats', () => {
    const records = [
      { status: 'present' },
      { status: 'present' },
      { status: 'absent' },
      { status: 'leave' },
    ];

    it('reports a leave count', () => {
      const stats = AttendanceGeneratorService.calculateSummaryStats(records);
      expect(stats.leave).toBe(1);
    });

    it('does not fold leave into the absent count', () => {
      const stats = AttendanceGeneratorService.calculateSummaryStats(records);
      expect(stats.absent).toBe(1);
    });

    it('keeps total and present intact', () => {
      const stats = AttendanceGeneratorService.calculateSummaryStats(records);
      expect(stats.total).toBe(4);
      expect(stats.present).toBe(2);
    });
  });

  describe('prepareAttendanceRows', () => {
    it('writes L into the row for a student on leave', () => {
      const rows = AttendanceGeneratorService.prepareAttendanceRows([
        { rollNumber: 1, studentName: 'Ayesha', fatherName: 'Bilal', status: 'leave' },
      ]);
      expect(rows[0][3]).toBe('L');
    });
  });

  describe('buildAttendanceMatrix — the monthly sheet', () => {
    // This is the path that actually reached the head teacher: the monthly
    // matrix used to hardcode "present ? P : A", so a leave day was reported
    // as an absence for the whole month.
    const students = [{ id: 'stu-1', student_name: 'Ayesha', roll_number: 1 }];
    const sessions = [
      {
        session_date: '2026-08-03',
        attendance_records: [{ student_id: 'stu-1', status: 'leave' }],
      },
      {
        session_date: '2026-08-04',
        attendance_records: [{ student_id: 'stu-1', status: 'absent' }],
      },
    ];

    it('keeps a leave day as L rather than collapsing it to A', () => {
      const matrix = AttendanceGeneratorService.buildAttendanceMatrix(students, sessions);
      expect(matrix['stu-1'].days[3]).toBe('L');
    });

    it('still records a genuine absence as A', () => {
      const matrix = AttendanceGeneratorService.buildAttendanceMatrix(students, sessions);
      expect(matrix['stu-1'].days[4]).toBe('A');
    });
  });
});
