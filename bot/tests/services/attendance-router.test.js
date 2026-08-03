/**
 * Attendance Router Service Tests
 *
 * TDD for bd-2481 Phase 1 — the role-routing fork for the "attendance"/"حاضری"
 * keyword. This is the highest-risk piece of the feature: if it is wrong, a
 * principal ends up marking students (or a teacher ends up in the teacher-
 * marking flow). The invariant under test:
 *
 *   principal  -> principal marks TEACHERS
 *   teacher    -> teacher marks STUDENTS  (the existing flow)
 *   both       -> ASK "teachers or students?"  (never silently pick one)
 *
 * A principal must NEVER be silently routed into the student-marking flow.
 */

const AttendanceRouterService = require('../../shared/services/attendance-router.service');

const { ACTOR, resolveAttendanceActor, isPrincipal } = AttendanceRouterService;

describe('AttendanceRouterService.resolveAttendanceActor', () => {
  describe('teacher -> student flow', () => {
    it('routes a teacher (role="teacher") to the student-marking flow', () => {
      const result = resolveAttendanceActor({ role: 'teacher' });
      expect(result.actor).toBe(ACTOR.TEACHER_MARKS_STUDENTS);
      expect(result.isPrincipal).toBe(false);
    });

    it('routes a user with no role set to the student-marking flow (safe default)', () => {
      expect(resolveAttendanceActor({}).actor).toBe(ACTOR.TEACHER_MARKS_STUDENTS);
      expect(resolveAttendanceActor({ role: null }).actor).toBe(ACTOR.TEACHER_MARKS_STUDENTS);
      expect(resolveAttendanceActor(null).actor).toBe(ACTOR.TEACHER_MARKS_STUDENTS);
    });

    it('does not treat an unrelated role as principal', () => {
      expect(resolveAttendanceActor({ role: 'admin' }).actor).toBe(ACTOR.TEACHER_MARKS_STUDENTS);
    });
  });

  describe('principal -> teacher flow', () => {
    it('routes a principal (role="principal") to the teacher-marking flow', () => {
      const result = resolveAttendanceActor({ role: 'principal' });
      expect(result.actor).toBe(ACTOR.PRINCIPAL_MARKS_TEACHERS);
      expect(result.isPrincipal).toBe(true);
    });

    it('is case- and whitespace-insensitive on the role value', () => {
      expect(resolveAttendanceActor({ role: 'Principal' }).actor).toBe(ACTOR.PRINCIPAL_MARKS_TEACHERS);
      expect(resolveAttendanceActor({ role: '  PRINCIPAL ' }).actor).toBe(ACTOR.PRINCIPAL_MARKS_TEACHERS);
    });

    it('NEVER silently routes a principal into the student flow', () => {
      // The core safety invariant. Regardless of secondary signals, a principal
      // is either sent to the teacher flow or asked — never to students silently.
      const result = resolveAttendanceActor({ role: 'principal' });
      expect(result.actor).not.toBe(ACTOR.TEACHER_MARKS_STUDENTS);
    });
  });

  describe('both -> ask', () => {
    it('asks when a principal ALSO has their own student classes', () => {
      const result = resolveAttendanceActor(
        { role: 'principal' },
        { hasStudentClasses: true }
      );
      expect(result.actor).toBe(ACTOR.ASK);
      expect(result.isPrincipal).toBe(true);
    });

    it('does not ask a plain teacher who has classes (no ambiguity)', () => {
      const result = resolveAttendanceActor(
        { role: 'teacher' },
        { hasStudentClasses: true }
      );
      expect(result.actor).toBe(ACTOR.TEACHER_MARKS_STUDENTS);
    });
  });

  describe('isPrincipal helper', () => {
    it('is true only for the principal role', () => {
      expect(isPrincipal({ role: 'principal' })).toBe(true);
      expect(isPrincipal({ role: 'teacher' })).toBe(false);
      expect(isPrincipal({})).toBe(false);
      expect(isPrincipal(null)).toBe(false);
    });
  });
});
