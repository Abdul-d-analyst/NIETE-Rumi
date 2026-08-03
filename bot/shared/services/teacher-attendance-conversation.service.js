/**
 * Teacher Attendance Conversation Service
 *
 * The principal-marks-teachers state machine — the WhatsApp mirror of the web
 * build. A principal is shown their school's teachers and marks who is
 * absent / on leave (everyone else present). Leave requires a leave_type
 * sub-step. On confirm it persists through the SAME backend as the web build,
 * via TeacherAttendanceService.persistMarkedAttendance() → one saveAttendance()
 * upsert per teacher. Web and WhatsApp therefore converge to identical Presence.
 *
 * Text-based "tap": the principal replies with teacher numbers (e.g. "2, 5L").
 * This ships the flow end-to-end over plain WhatsApp text with no new Meta Flow
 * asset. A Flow-screen tap UI can layer on later without changing this state
 * machine or the write path.
 *
 * The attendance repository is INJECTED by the caller (the handler passes
 * getAttendanceRepository(supabase); tests pass the in-memory Mock) so this
 * service carries no hard dependency on the dashboard tree or a live DB.
 */

const redisService = require('./cache/railway-redis.service');
const { logToFile } = require('../utils/logger');
const TeacherAttendanceService = require('./teacher-attendance.service');

const STATES = {
  IDLE: 'IDLE',
  AWAITING_MARKING: 'AWAITING_MARKING',
  AWAITING_LEAVE_TYPE: 'AWAITING_LEAVE_TYPE',
  AWAITING_VERIFICATION: 'AWAITING_VERIFICATION',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
};

const SESSION_TTL = 3600; // 1 hour

const t = (key, lang) => TeacherAttendanceService.t(key, lang);

class TeacherAttendanceConversationService {
  static getRedisKey(userId) {
    return `teacher-attendance:session:${userId}`;
  }

  static async getSessionState(userId) {
    try {
      const data = await redisService.get(this.getRedisKey(userId));
      if (!data) return null;
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      logToFile('Error getting teacher-attendance session', { userId, error: error.message });
      return null;
    }
  }

  static async saveSessionState(userId, session) {
    try {
      await redisService.set(this.getRedisKey(userId), session, SESSION_TTL);
      return true;
    } catch (error) {
      logToFile('Error saving teacher-attendance session', { userId, error: error.message });
      return false;
    }
  }

  static async clearSessionState(userId) {
    try {
      await redisService.delete(this.getRedisKey(userId));
      return true;
    } catch (error) {
      logToFile('Error clearing teacher-attendance session', { userId, error: error.message });
      return false;
    }
  }

  static async isInSession(userId) {
    return (await this.getSessionState(userId)) !== null;
  }

  static teacherDisplayName(teacher) {
    const name = [teacher.first_name, teacher.last_name].filter(Boolean).join(' ').trim();
    return name || teacher.phone_number || 'Teacher';
  }

  static generateMarkingMessage(teachers, lang = 'en') {
    const lines = ['*Teacher Attendance*', ''];
    teachers.forEach((tr, i) => lines.push(`${i + 1}. ${this.teacherDisplayName(tr)}`));
    lines.push('');
    if (lang === 'ur') {
      lines.push('غیر حاضر اساتذہ کے نمبر بھیجیں (مثلاً 2,5)۔');
      lines.push('چھٹی کے لیے نمبر کے ساتھ L لگائیں (مثلاً 3L)۔');
      lines.push('سب حاضر ہوں تو "all" بھیجیں۔');
    } else {
      lines.push('Reply with the numbers of teachers who are ABSENT (e.g. 2,5).');
      lines.push('Add L after a number for ON LEAVE (e.g. 3L).');
      lines.push('Reply "all" if everyone is present.');
    }
    return lines.join('\n');
  }

  /**
   * Parse the principal's marking reply.
   * @returns {{allPresent:boolean, absent:number[], leave:number[]}} (1-based) or {error}
   */
  static parseMarkingInput(input, teacherCount) {
    const raw = String(input || '').trim().toLowerCase();
    if (raw === '') return { error: 'empty' };
    if (['all', '0', 'sab hazir', 'سب حاضر', 'all present'].includes(raw)) {
      return { allPresent: true, absent: [], leave: [] };
    }
    const tokens = raw.split(/[\s,،]+/).filter(Boolean);
    const absent = [];
    const leave = [];
    for (const tok of tokens) {
      const m = tok.match(/^(\d+)\s*(l|leave|چھٹی)?$/i);
      if (!m) return { error: `unparsable:${tok}` };
      const n = parseInt(m[1], 10);
      if (isNaN(n) || n < 1 || n > teacherCount) return { error: `range:${tok}` };
      if (m[2]) leave.push(n);
      else absent.push(n);
    }
    return { allPresent: false, absent, leave };
  }

  /**
   * Start a principal's teacher-attendance session.
   */
  static async startSession(userId, { user, repository, date } = {}) {
    try {
      if (!user || !user.school_id) {
        return {
          action: 'NO_SCHOOL',
          message: 'Your account isn\'t linked to a school yet, so I can\'t load its teachers. Please contact your NIETE coordinator.',
        };
      }
      const teachers = await repository.getTeachersBySchool(user.school_id);
      if (!teachers || teachers.length === 0) {
        return {
          action: 'NO_TEACHERS',
          message: 'No teachers are registered under your school yet. Once they register, you\'ll be able to mark their attendance here.',
        };
      }

      const lang = user.preferred_language || 'en';
      const session = {
        userId,
        state: STATES.AWAITING_MARKING,
        startedAt: new Date().toISOString(),
        date: date || new Date().toISOString().split('T')[0],
        school_id: user.school_id,
        marked_by_user_id: user.id,
        lang,
        teachers: teachers.map((tr) => ({ teacher_id: tr.id, name: this.teacherDisplayName(tr) })),
        statusByIndex: {},   // { "1": "present" | "absent" | "leave" }
        leaveTypeByIndex: {}, // { "3": "sick" }
        leaveQueue: [],
        leaveCursor: 0,
      };
      await this.saveSessionState(userId, session);

      return {
        action: 'ASK_MARKING',
        message: this.generateMarkingMessage(teachers, lang),
      };
    } catch (error) {
      logToFile('Error starting teacher-attendance session', { userId, error: error.message });
      return { action: 'ERROR', message: 'Sorry, something went wrong loading your teachers. Please try again.' };
    }
  }

  static async handleMarkingInput(userId, input, { repository } = {}) {
    const session = await this.getSessionState(userId);
    if (!session || session.state !== STATES.AWAITING_MARKING) {
      return { action: 'INVALID_STATE', message: 'Say "attendance" to start marking teacher attendance.' };
    }

    const parsed = this.parseMarkingInput(input, session.teachers.length);
    if (parsed.error) {
      return {
        action: 'INVALID_SELECTION',
        message: t('invalid_marking', session.lang) === 'invalid_marking'
          ? `Please reply with teacher numbers (1-${session.teachers.length}), e.g. "2,5" for absent or "3L" for leave, or "all".`
          : t('invalid_marking', session.lang),
      };
    }

    const statusByIndex = {};
    for (let i = 1; i <= session.teachers.length; i++) statusByIndex[i] = 'present';
    parsed.absent.forEach((n) => { statusByIndex[n] = 'absent'; });
    parsed.leave.forEach((n) => { statusByIndex[n] = 'leave'; });

    session.statusByIndex = statusByIndex;
    session.leaveQueue = parsed.leave.slice();
    session.leaveCursor = 0;
    session.leaveTypeByIndex = {};

    if (session.leaveQueue.length > 0) {
      session.state = STATES.AWAITING_LEAVE_TYPE;
      await this.saveSessionState(userId, session);
      return { action: 'ASK_LEAVE_TYPE', message: this._leaveTypePrompt(session) };
    }

    session.state = STATES.AWAITING_VERIFICATION;
    await this.saveSessionState(userId, session);
    return { action: 'VERIFY', message: this._verificationMessage(session) };
  }

  static _leaveTypePrompt(session) {
    const idx = session.leaveQueue[session.leaveCursor];
    const name = session.teachers[idx - 1].name;
    const head = session.lang === 'ur'
      ? `${name} کی چھٹی کی قسم؟`
      : `Leave type for ${name}?`;
    return `${head}\n${t('leave_type_prompt', session.lang)}`;
  }

  static async handleLeaveTypeInput(userId, input) {
    const session = await this.getSessionState(userId);
    if (!session || session.state !== STATES.AWAITING_LEAVE_TYPE) {
      return { action: 'INVALID_STATE', message: 'Say "attendance" to start marking teacher attendance.' };
    }
    const leaveType = TeacherAttendanceService.parseLeaveType(input);
    if (!leaveType) {
      return { action: 'INVALID_SELECTION', message: t('invalid_leave_type', session.lang) };
    }
    const idx = session.leaveQueue[session.leaveCursor];
    session.leaveTypeByIndex[idx] = leaveType;
    session.leaveCursor += 1;

    if (session.leaveCursor < session.leaveQueue.length) {
      await this.saveSessionState(userId, session);
      return { action: 'ASK_LEAVE_TYPE', message: this._leaveTypePrompt(session) };
    }

    session.state = STATES.AWAITING_VERIFICATION;
    await this.saveSessionState(userId, session);
    return { action: 'VERIFY', message: this._verificationMessage(session) };
  }

  static _buildRecords(session) {
    return session.teachers.map((tr, i) => {
      const n = i + 1;
      const status = session.statusByIndex[n] || 'present';
      const rec = { teacher_id: tr.teacher_id, status };
      if (status === 'leave') rec.leave_type = session.leaveTypeByIndex[n];
      return rec;
    });
  }

  static _verificationMessage(session) {
    const recs = this._buildRecords(session);
    const present = recs.filter((r) => r.status === 'present').length;
    const absent = recs.filter((r) => r.status === 'absent');
    const leave = recs.filter((r) => r.status === 'leave');
    const lines = [
      '*Confirm Teacher Attendance*',
      '',
      `✅ Present: ${present}`,
      `❌ Absent: ${absent.length}`,
      `🏖️ On leave: ${leave.length}`,
      '',
    ];
    session.teachers.forEach((tr, i) => {
      const n = i + 1;
      const st = session.statusByIndex[n];
      if (st === 'absent') lines.push(`❌ ${tr.name}`);
      else if (st === 'leave') lines.push(`🏖️ ${tr.name} (${session.leaveTypeByIndex[n]})`);
    });
    if (absent.length === 0 && leave.length === 0) lines.push('Everyone present ✅');
    lines.push('');
    lines.push(session.lang === 'ur'
      ? 'محفوظ کرنے کے لیے "yes"، دوبارہ کے لیے "edit"، منسوخ کے لیے "cancel"۔'
      : 'Reply "yes" to save, "edit" to redo, or "cancel".');
    return lines.join('\n');
  }

  static async handleVerification(userId, input, { repository } = {}) {
    const session = await this.getSessionState(userId);
    if (!session || session.state !== STATES.AWAITING_VERIFICATION) {
      return { action: 'INVALID_STATE', message: 'Say "attendance" to start marking teacher attendance.' };
    }
    const resp = String(input || '').trim().toLowerCase();

    if (['cancel', 'no', 'stop', 'منسوخ', 'نہیں'].some((k) => resp.includes(k))) {
      await this.clearSessionState(userId);
      return { action: 'CANCELLED', message: 'Cancelled. Say "attendance" to start again.' };
    }

    if (['edit', 'change', 'redo', 'ایڈٹ', 'تبدیلی'].some((k) => resp.includes(k))) {
      session.state = STATES.AWAITING_MARKING;
      await this.saveSessionState(userId, session);
      const teachers = session.teachers.map((tr) => ({ first_name: tr.name }));
      return { action: 'ASK_MARKING', message: this.generateMarkingMessage(teachers, session.lang) };
    }

    if (['yes', 'confirm', 'ok', 'save', 'ہاں', 'جی', 'ٹھیک'].some((k) => resp.includes(k))) {
      try {
        session.state = STATES.PROCESSING;
        await this.saveSessionState(userId, session);
        const records = this._buildRecords(session);
        await TeacherAttendanceService.persistMarkedAttendance({
          repository,
          school_id: session.school_id,
          date: session.date,
          marked_by_user_id: session.marked_by_user_id,
          records,
        });
        await this.clearSessionState(userId);
        return {
          action: 'SAVED',
          message: session.lang === 'ur' ? t('saved', 'ur') : t('saved', 'en'),
          records,
        };
      } catch (error) {
        logToFile('Error persisting teacher attendance', { userId, error: error.message });
        // Roll session back to verification so the principal can retry.
        session.state = STATES.AWAITING_VERIFICATION;
        await this.saveSessionState(userId, session);
        return { action: 'ERROR', message: 'Sorry, saving failed. Reply "yes" to try again or "cancel".' };
      }
    }

    return {
      action: 'INVALID_SELECTION',
      message: 'Reply "yes" to save, "edit" to redo, or "cancel".',
    };
  }
}

TeacherAttendanceConversationService.STATES = STATES;

module.exports = TeacherAttendanceConversationService;
