/**
 * bd-2455 — Leader "Observations" resolver.
 *
 * Surfaces the coach's /observe world on the portal in one payload:
 *   upcoming        — observation_schedules status='upcoming' (date-ordered,
 *                     overdue-flagged), the same rows the bot's "My schedule"
 *                     screen lists.
 *   pendingDebriefs — the bot's exact listPendingDebriefs semantics
 *                     (observer_review_complete + debrief_status='pending').
 *   completed       — past observations: terminal status, or review-complete
 *                     with the debrief done. In-flight ('confirmed', queue
 *                     states) and 'failed' rows appear in NEITHER list.
 *
 * Teacher identity on a session is its OWNER (user_id — the visit picker binds
 * the observed teacher as owner). A legacy unbound capture is owned by the
 * observer; its name is returned null so the UI never labels the coach as the
 * observed teacher.
 *
 * `query` is injected ((sql, params) => Promise<{rows}>) like every leader-*
 * service, so this is unit-testable without a live DB.
 */

const { getOverall } = require('./coaching-frameworks.service');

const UPCOMING_SQL = `
  SELECT id, teacher_name, school_name, school_ext_id, teacher_ext_id,
         scheduled_for, scheduled_slot, created_at
  FROM observation_schedules
  WHERE leader_user_id = $1 AND status = 'upcoming'
  ORDER BY scheduled_for ASC, created_at ASC
`;

const SESSIONS_SQL = `
  SELECT c.id, c.created_at, c.status, c.debrief_status, c.analysis_data,
         c.report_pdf_url, c.user_id, c.observer_user_id,
         u.first_name AS teacher_first_name
  FROM coaching_sessions c
  LEFT JOIN users u ON u.id = c.user_id
  WHERE c.observer_user_id = $1 AND c.observation_type = 'leader_observation'
  ORDER BY c.created_at DESC
`;

function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function shapeSchedule(r, today) {
  const scheduledFor = isoDay(r.scheduled_for);
  return {
    id: r.id,
    teacherName: r.teacher_name || null,
    schoolName: r.school_name || null,
    schoolExtId: r.school_ext_id || null,
    teacherExtId: r.teacher_ext_id || null,
    scheduledFor,
    scheduledSlot: r.scheduled_slot || null,
    overdue: !!(scheduledFor && today && scheduledFor < today),
  };
}

function shapeSession(r) {
  const overall = r.analysis_data ? getOverall(r.analysis_data) : null;
  // A legacy unbound capture is owned by the observer — never show the coach's
  // own name as the observed teacher.
  const selfOwned = r.user_id && r.observer_user_id && r.user_id === r.observer_user_id;
  return {
    id: r.id,
    createdAt: r.created_at || null,
    teacherName: selfOwned ? null : (r.teacher_first_name || null),
    teacherUserId: selfOwned ? null : (r.user_id || null),
    status: r.status,
    debriefStatus: r.debrief_status || null,
    score: overall && overall.percentage != null ? overall.percentage : null,
    reportPdfUrl: r.report_pdf_url || null,
  };
}

function isPendingDebrief(r) {
  return r.status === 'observer_review_complete' && r.debrief_status === 'pending';
}

function isCompleted(r) {
  if (r.status === 'completed') return true;
  return r.status === 'observer_review_complete' && r.debrief_status !== 'pending';
}

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: object[]}>} query
 * @param {string} leaderUserId portal session user id
 * @param {{today?: string}} opts today as YYYY-MM-DD (defaults to now, UTC)
 * @returns {Promise<{upcoming: object[], pendingDebriefs: object[], completed: object[]}>}
 */
async function getLeaderObservations(query, leaderUserId, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  try {
    const [schedules, sessions] = await Promise.all([
      query(UPCOMING_SQL, [leaderUserId]),
      query(SESSIONS_SQL, [leaderUserId]),
    ]);
    const rows = sessions.rows || [];
    return {
      upcoming: (schedules.rows || []).map((r) => shapeSchedule(r, today)),
      pendingDebriefs: rows.filter(isPendingDebrief).map(shapeSession),
      completed: rows.filter(isCompleted).map(shapeSession),
    };
  } catch (error) {
    // The portal home must render even when this panel can't — degrade, never throw.
    console.error('leader-observations: resolver failed:', error.message);
    return { upcoming: [], pendingDebriefs: [], completed: [] };
  }
}

module.exports = { getLeaderObservations };
