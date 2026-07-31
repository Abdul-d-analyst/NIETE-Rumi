/**
 * bd-2387 — Leader "patch" resolver.
 *
 * A leader's patch is the set of teachers migrated into Rumi at `leader_teachers`
 * (keyed by leader_user_id = the portal session user id; teacher_phone_e164 is
 * the normalised PK number). Each patch teacher is LEFT JOINed to their Rumi
 * `users` row by phone, plus lifetime coaching/LP counts and the latest
 * completed session's analysis_data — so we can show an at-a-glance score.
 * Teachers not yet on Rumi still appear (onRumi:false) so a leader sees their
 * WHOLE patch, not just the active subset.
 *
 * The last score is normalised across frameworks in JS via getOverall (HOTS /
 * OECD / MEWAKA all store scores under different keys) — that logic can't live
 * in SQL because analysis_data is per-framework JSONB.
 *
 * `query` is injected (sig: (sql, params) => Promise<{rows}>) so this is
 * unit-testable without a live DB; production wires it to the pg pool.
 */

const { getOverall } = require('./coaching-frameworks.service');

// One round-trip. LATERALs return 0 / no rows for teachers with no Rumi user,
// so the LEFT JOINs yield 0 counts / null score for off-Rumi teachers.
const PATCH_TEACHERS_SQL = `
  SELECT
    lt.teacher_ext_id,
    lt.teacher_name,
    lt.teacher_phone_e164 AS phone,
    u.id                  AS rumi_user_id,
    u.first_name          AS rumi_first_name,
    COALESCE(cc.completed, 0) AS coaching_sessions,
    COALESCE(lpc.plans, 0)    AS lesson_plans,
    ls.analysis_data          AS last_analysis_data,
    ls.created_at             AS last_session_at
  FROM leader_teachers lt
  LEFT JOIN users u ON u.phone_number = lt.teacher_phone_e164
  LEFT JOIN LATERAL (
    SELECT count(*) AS completed
    FROM coaching_sessions c
    WHERE c.user_id = u.id AND c.status = 'completed'
  ) cc ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS plans
    FROM lesson_plans l
    WHERE l.user_id = u.id
  ) lpc ON true
  LEFT JOIN LATERAL (
    SELECT analysis_data, created_at
    FROM coaching_sessions c
    WHERE c.user_id = u.id AND c.status = 'completed' AND c.analysis_data IS NOT NULL
    ORDER BY c.created_at DESC
    LIMIT 1
  ) ls ON true
  WHERE lt.leader_user_id = $1
  ORDER BY lt.teacher_name ASC
`;

function shapeTeacher(r) {
  const onRumi = !!r.rumi_user_id;
  const overall = onRumi && r.last_analysis_data ? getOverall(r.last_analysis_data) : null;
  return {
    teacherExtId: r.teacher_ext_id || null,
    name: r.teacher_name || null,
    phone: r.phone || null,
    onRumi,
    rumiUserId: r.rumi_user_id || null,
    coachingSessions: Number(r.coaching_sessions) || 0,
    lessonPlans: Number(r.lesson_plans) || 0,
    lastSessionAt: r.last_session_at || null,
    // percentage is the framework-agnostic headline; null when never coached.
    lastScore: overall && overall.percentage != null ? overall.percentage : null,
  };
}

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: object[]}>} query
 * @param {string} leaderUserId  portal session user id (leader_teachers.leader_user_id)
 * @returns {Promise<object[]>}  shaped patch teachers, sorted by name
 */
async function getPatchTeachers(query, leaderUserId) {
  const { rows } = await query(PATCH_TEACHERS_SQL, [leaderUserId]);
  return (rows || []).map(shapeTeacher);
}

module.exports = { getPatchTeachers, PATCH_TEACHERS_SQL };
