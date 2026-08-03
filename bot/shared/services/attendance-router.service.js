/**
 * Attendance Router Service
 *
 * Role-routing fork for the "attendance"/"حاضری" keyword (bd-2481, Phase 1).
 *
 * The SAME keyword means different things depending on who sends it:
 *   - a teacher marks their STUDENTS  (the existing student-attendance flow)
 *   - a principal marks their school's TEACHERS  (the new channel, wired to the
 *     TASK-133 teacher_attendance_records backend via saveAttendance())
 *
 * This module owns ONLY the decision of which flow to enter. It is a pure
 * function so the highest-risk behaviour in the feature can be unit-tested
 * exhaustively. The safety invariant it guarantees:
 *
 *   A principal is NEVER silently routed into the student-marking flow.
 *
 * A principal who ALSO runs their own class(es) is genuinely ambiguous, so we
 * ask ("teachers or students?") rather than guess. The caller supplies whether
 * the user has student classes (an async lookup it already performs).
 */

const ACTOR = {
  PRINCIPAL_MARKS_TEACHERS: 'principal_marks_teachers',
  TEACHER_MARKS_STUDENTS: 'teacher_marks_students',
  ASK: 'ask'
};

/**
 * Is this user a principal? Free-text `users.role` (VARCHAR) — normalise before
 * comparing so 'Principal' / '  PRINCIPAL ' all count.
 * @param {Object|null} user
 * @returns {boolean}
 */
function isPrincipal(user) {
  return !!user
    && typeof user.role === 'string'
    && user.role.trim().toLowerCase() === 'principal';
}

/**
 * Decide which attendance flow the keyword should enter.
 *
 * @param {Object|null} user - the user record (needs `.role`)
 * @param {Object} [opts]
 * @param {boolean} [opts.hasStudentClasses=false] - does this user own student
 *        classes? Only consulted for principals (disambiguates "both").
 * @returns {{ actor: string, isPrincipal: boolean }}
 */
function resolveAttendanceActor(user, { hasStudentClasses = false } = {}) {
  if (isPrincipal(user)) {
    // Principal who also teaches their own class(es) -> ambiguous, ask.
    if (hasStudentClasses) {
      return { actor: ACTOR.ASK, isPrincipal: true };
    }
    return { actor: ACTOR.PRINCIPAL_MARKS_TEACHERS, isPrincipal: true };
  }

  // Teachers — and any non-principal / unset role — mark students. This is the
  // safe default: the student flow is what exists today and cannot expose
  // teacher data. A principal never reaches this branch silently.
  return { actor: ACTOR.TEACHER_MARKS_STUDENTS, isPrincipal: false };
}

module.exports = {
  ACTOR,
  isPrincipal,
  resolveAttendanceActor
};
