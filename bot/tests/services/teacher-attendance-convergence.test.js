/**
 * Teacher Attendance — Convergence Tests (bd-2481, Phase 1)
 *
 * The non-negotiable: the WhatsApp principal channel and the TASK-133 web build
 * must produce IDENTICAL Presence numbers, because there is ONE write path.
 *
 * These tests drive the WhatsApp persistence adapter (persistMarkedAttendance)
 * through the SAME repository (getTeachersBySchool / saveAttendance /
 * getPresence / computePresence) the web build uses, and prove:
 *   1. a WhatsApp write and a web write for the same (teacher, date) converge to
 *      ONE row (the UNIQUE(teacher_id,date) upsert) — no parallel persistence,
 *   2. Presence computed after the WhatsApp write equals Presence computed the
 *      web way over the same rows,
 *   3. leave + leave_type (casual/sick/official) is captured and validated.
 */

// Use the real repository (in-memory Mock impl) — same code the web build runs.
const {
  MockAttendanceRepository,
  computePresence,
} = require('../../../dashboard/services/attendance-repository.service');

const TeacherAttendanceService = require('../../shared/services/teacher-attendance.service');

const SCHOOL = 'school-1';
const PRINCIPAL = 'principal-1';
const T1 = 'teacher-1';
const T2 = 'teacher-2';
const T3 = 'teacher-3';

function seedRepo() {
  return new MockAttendanceRepository({
    teachers: [
      { id: T1, first_name: 'Ayesha', role: 'teacher', school_id: SCHOOL, phone_number: '923001111111' },
      { id: T2, first_name: 'Bilal', role: 'teacher', school_id: SCHOOL, phone_number: '923002222222' },
      { id: T3, first_name: 'Carla', role: 'teacher', school_id: SCHOOL, phone_number: '923003333333' },
    ],
  });
}

describe('TeacherAttendanceService.persistMarkedAttendance', () => {
  it('writes one teacher_attendance_records row per teacher via saveAttendance', async () => {
    const repo = seedRepo();
    const result = await TeacherAttendanceService.persistMarkedAttendance({
      repository: repo,
      school_id: SCHOOL,
      date: '2026-08-03',
      marked_by_user_id: PRINCIPAL,
      records: [
        { teacher_id: T1, status: 'present' },
        { teacher_id: T2, status: 'absent' },
        { teacher_id: T3, status: 'leave', leave_type: 'sick' },
      ],
    });

    expect(result.saved).toBe(3);
    const rows = await repo.getAttendanceForSchool(SCHOOL, null, null);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.marked_by_user_id === PRINCIPAL)).toBe(true);
    const sick = rows.find((r) => r.teacher_id === T3);
    expect(sick.status).toBe('leave');
    expect(sick.leave_type).toBe('sick');
  });

  it('captures each leave_type (casual/sick/official)', async () => {
    const repo = seedRepo();
    await TeacherAttendanceService.persistMarkedAttendance({
      repository: repo,
      school_id: SCHOOL,
      date: '2026-08-03',
      marked_by_user_id: PRINCIPAL,
      records: [
        { teacher_id: T1, status: 'leave', leave_type: 'casual' },
        { teacher_id: T2, status: 'leave', leave_type: 'official' },
        { teacher_id: T3, status: 'leave', leave_type: 'sick' },
      ],
    });
    const rows = await repo.getAttendanceForSchool(SCHOOL, null, null);
    expect(rows.map((r) => r.leave_type).sort()).toEqual(['casual', 'official', 'sick']);
  });

  it('rejects status=leave with no leave_type (never silently drops the reason)', async () => {
    const repo = seedRepo();
    await expect(TeacherAttendanceService.persistMarkedAttendance({
      repository: repo,
      school_id: SCHOOL,
      date: '2026-08-03',
      marked_by_user_id: PRINCIPAL,
      records: [{ teacher_id: T1, status: 'leave' }],
    })).rejects.toThrow(/leave_type required/);
  });

  it('CONVERGENCE: a WhatsApp write and a web write for the same (teacher,date) upsert to one row', async () => {
    const repo = seedRepo();
    const date = '2026-08-03';

    // Web build marks T1 present.
    await repo.saveAttendance({
      teacher_id: T1, school_id: SCHOOL, date, status: 'present',
      leave_type: null, marked_by_user_id: 'web-admin',
    });

    // Principal later corrects T1 to leave/sick over WhatsApp — same (teacher,date).
    await TeacherAttendanceService.persistMarkedAttendance({
      repository: repo,
      school_id: SCHOOL,
      date,
      marked_by_user_id: PRINCIPAL,
      records: [{ teacher_id: T1, status: 'leave', leave_type: 'sick' }],
    });

    const rows = await repo.getAttendanceForTeacher(T1, null, null);
    expect(rows).toHaveLength(1);            // upsert on (teacher_id,date), not a 2nd row
    expect(rows[0].status).toBe('leave');    // last write wins
    expect(rows[0].leave_type).toBe('sick');
    expect(rows[0].marked_by_user_id).toBe(PRINCIPAL);
  });

  it('CONVERGENCE: Presence after the WhatsApp write equals the web-computed Presence', async () => {
    const repo = seedRepo();
    const date = '2026-08-03';

    await TeacherAttendanceService.persistMarkedAttendance({
      repository: repo,
      school_id: SCHOOL,
      date,
      marked_by_user_id: PRINCIPAL,
      records: [
        { teacher_id: T1, status: 'present' },
        { teacher_id: T2, status: 'absent' },
        { teacher_id: T3, status: 'leave', leave_type: 'casual' },
      ],
    });

    // Presence as the WhatsApp/portal endpoint would report it for T1.
    const presenceT1 = await repo.getPresence({ teacher_id: T1, start_date: date, end_date: date });

    // Presence as the web build computes it directly from the same rows.
    const webRowsT1 = await repo.getAttendanceForTeacher(T1, date, date);
    const webPresenceT1 = computePresence(webRowsT1);

    expect(presenceT1.present_days).toBe(webPresenceT1.present_days);
    expect(presenceT1.absent_days).toBe(webPresenceT1.absent_days);
    expect(presenceT1.leave_days).toBe(webPresenceT1.leave_days);
    expect(presenceT1.presence_pct).toBe(webPresenceT1.presence_pct);
    expect(presenceT1.presence_pct).toBe(100); // T1 present on the one working day
  });
});
