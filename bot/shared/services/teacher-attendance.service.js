/**
 * Teacher Attendance Service (bd-2481, Phase 1)
 *
 * The WhatsApp principal channel's write path. A principal marks their school's
 * teachers (present / absent / leave + leave_type) and this service persists the
 * result through the SAME TASK-133 backend the web build uses — the injected
 * attendance repository (getTeachersBySchool / saveAttendance / getPresence).
 *
 * There is exactly ONE write path: saveAttendance() upserts on
 * UNIQUE(teacher_id, date). No parallel persistence, so web and WhatsApp
 * converge to identical Presence numbers (see the convergence tests).
 *
 * The repository is INJECTED (not required here) so:
 *   - unit tests use the in-memory MockAttendanceRepository, and
 *   - the handler passes getAttendanceRepository(supabase) at call time,
 * keeping the bot free of a hard cross-tree dependency on the dashboard.
 */

const VALID_STATUSES = ['present', 'absent', 'leave'];
const VALID_LEAVE_TYPES = ['casual', 'sick', 'official'];

/**
 * Bilingual (EN/Urdu) strings for the teacher-attendance channel. i18n is
 * net-new for this flow (the student flow was hardcoded English). Keyed by
 * language code; falls back to English (the deliberate floor).
 */
const STRINGS = {
  en: {
    leave_type_prompt: 'What type of leave?\n1. Casual\n2. Sick\n3. Official',
    leave_type_casual: 'Casual',
    leave_type_sick: 'Sick',
    leave_type_official: 'Official',
    status_present: 'Present',
    status_absent: 'Absent',
    status_leave: 'On leave',
    saved: 'Teacher attendance saved.',
    invalid_leave_type: 'Please reply 1 (Casual), 2 (Sick), or 3 (Official).',
  },
  ur: {
    leave_type_prompt: 'چھٹی کی قسم؟\n1. اتفاقی\n2. بیماری\n3. سرکاری',
    leave_type_casual: 'اتفاقی',
    leave_type_sick: 'بیماری',
    leave_type_official: 'سرکاری',
    status_present: 'حاضر',
    status_absent: 'غیر حاضر',
    status_leave: 'چھٹی پر',
    saved: 'اساتذہ کی حاضری محفوظ ہو گئی۔',
    invalid_leave_type: 'براہ کرم 1 (اتفاقی)، 2 (بیماری)، یا 3 (سرکاری) جواب دیں۔',
  },
};

class TeacherAttendanceService {
  /**
   * Resolve a bilingual string. Falls back to English.
   * @param {string} key
   * @param {string} [lang='en']
   */
  static t(key, lang = 'en') {
    const table = STRINGS[lang] || STRINGS.en;
    return (table && table[key]) || STRINGS.en[key] || key;
  }

  /**
   * Map a leave-type selection ('1'|'2'|'3' or a name) to a canonical value.
   * @returns {string|null} 'casual' | 'sick' | 'official' | null (unrecognised)
   */
  static parseLeaveType(input) {
    if (input == null) return null;
    const s = String(input).trim().toLowerCase();
    if (['1', 'casual', 'اتفاقی'].includes(s)) return 'casual';
    if (['2', 'sick', 'بیماری'].includes(s)) return 'sick';
    if (['3', 'official', 'سرکاری'].includes(s)) return 'official';
    if (VALID_LEAVE_TYPES.includes(s)) return s;
    return null;
  }

  /**
   * Persist a principal's marked attendance for their school's teachers.
   * One saveAttendance() upsert per teacher — the single write path.
   *
   * @param {Object} args
   * @param {Object} args.repository - attendance repository (injected)
   * @param {string} args.school_id
   * @param {string} args.date - ISO date (YYYY-MM-DD)
   * @param {string} args.marked_by_user_id - the principal's user id
   * @param {Array<{teacher_id, status, leave_type?}>} args.records
   * @returns {Promise<{saved:number, rows:Array}>}
   */
  static async persistMarkedAttendance({ repository, school_id, date, marked_by_user_id, records }) {
    if (!repository) throw new Error('persistMarkedAttendance requires a repository.');
    if (!school_id || !date || !marked_by_user_id) {
      throw new Error('persistMarkedAttendance requires school_id, date, marked_by_user_id.');
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('persistMarkedAttendance requires a non-empty records array.');
    }

    const rows = [];
    for (const rec of records) {
      if (!rec || !rec.teacher_id) {
        throw new Error('Each record requires a teacher_id.');
      }
      if (!VALID_STATUSES.includes(rec.status)) {
        throw new Error(`Invalid status: ${rec.status}. Must be one of ${VALID_STATUSES.join(', ')}.`);
      }
      // saveAttendance re-validates status/leave_type and throws when
      // status='leave' has no leave_type — surface that (never silently drop).
      const row = await repository.saveAttendance({
        teacher_id: rec.teacher_id,
        school_id,
        date,
        status: rec.status,
        leave_type: rec.status === 'leave' ? (rec.leave_type || null) : null,
        marked_by_user_id,
      });
      rows.push(row);
    }

    return { saved: rows.length, rows };
  }
}

TeacherAttendanceService.VALID_STATUSES = VALID_STATUSES;
TeacherAttendanceService.VALID_LEAVE_TYPES = VALID_LEAVE_TYPES;
TeacherAttendanceService.STRINGS = STRINGS;

module.exports = TeacherAttendanceService;
