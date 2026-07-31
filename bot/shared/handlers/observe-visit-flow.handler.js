'use strict';
/**
 * bd-2430/bd-2431 — the observe-visit Flow endpoint handler (NIETE port of
 * main-bot FEAT-116 bd-2298/bd-2301).
 *
 * One coherent Flow: SELECT_SCHOOL → SELECT_TEACHER → BRIEF. Reached only when
 * an ICT coach types /observe with OBSERVE_VISIT_FLOW_ID set AND has a
 * leader_schools assignment (gated upstream in observe-command.handler).
 *
 * `handle(userId, action, screen, screenData, flowToken, user)`:
 *   INIT / SELECT_SCHOOL      → SELECT_SCHOOL, data.items = schools (with dueCount)
 *   data_exchange step=school → SELECT_TEACHER, data.items = prioritised teachers
 *   data_exchange step=teacher→ BRIEF, native text fields (no PNG — ~10s budget)
 *   data_exchange step=back / action BACK on BRIEF → SELECT_TEACHER (refreshed)
 *   complete step=start       → bind the teacher + arm awaiting_audio (terminal —
 *                               the capture prompt is sent by flow-response.handler).
 *
 * NIETE delta vs upstream (bd-2431): TEACHER-LIST PAGINATION. 106 of the 410
 * ICT schools have >20 teachers (max 160) and Meta's NavigationList hard-caps
 * at 20 items — Rawalpindi never hit this. A page holds PAGE_SIZE=18 teachers
 * plus Prev/Next rows whose payload re-enters step='school' with `page`.
 * Page 0 holds the head of the need-sorted list, so the highest-need teachers
 * are always on the first screen.
 *
 * NO `version` field ever appears in a response (bd-215). flowToken = coach
 * user.id (bare UUID — colons would trip the loose token detectors).
 */

const LeaderSource = require('../services/observe/assignment/leader-source');
const ObserveState = require('../services/observe/observe-state.service');
const { buildBriefViewModel } = require('../services/observe/observe-brief-card');
const { getObserveArm } = require('../services/observe/observe-gate');
const { logToFile } = require('../utils/logger');

// bd-2331 (CRITICAL, inherited from the main bot): Meta's NavigationList
// renderer FAILS on Arabic/Urdu script in an item's `description`/`metadata`
// (the flow throws "Something went wrong"). School/teacher names in the ICT
// roster are Latin govt data; ALL picker chrome below is English/Latin. The
// BRIEF screen is TextBody components (not a NavigationList) and renders Urdu
// fine — it stays in the coach's language via buildBriefViewModel.
const PICKER_LANG = 'en';

// Picker chrome (en only — see PICKER_LANG above; Urdu here would crash the list).
const SCHOOL_TAP = 'Tap to see teachers';
const TEACHERS_WORD = 'teachers';
const DUE_WORD = 'due for a visit';
const NEEDS_SUPPORT = 'Needs support';
const LAST_VISITED = 'Last visited';
const NOT_VISITED = 'Not yet visited';
const NEXT_LABEL = 'Next page ➡';
const PREV_LABEL = '⬅ Previous page';
const MORE_TEACHERS = 'more teachers';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// bd-2431: 18 data rows + up to 2 nav rows = 20, the NavigationList hard cap.
const PAGE_SIZE = 18;

const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length <= n ? t : t.slice(0, n - 1) + '…'; };

/** "12 Jun" — Latin only (NavigationList chrome). '' on an unparseable date. */
function fmtVisitDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * The teacher-row metadata: "Needs support" (low average score) + "Last visited
 * <date>" / "Not yet visited" — joined for the NavigationList metadata (≤80).
 */
function teacherMeta(t) {
  const parts = [];
  if (t.needsSupport) parts.push(NEEDS_SUPPORT);
  const dateStr = t.lastVisitAt ? fmtVisitDate(t.lastVisitAt) : '';
  parts.push(t.lastVisitAt && dateStr ? `${LAST_VISITED} ${dateStr}` : NOT_VISITED);
  return parts.join(' · ');
}

function schoolItem(s) {
  const metaParts = [`${s.teacherCount} ${TEACHERS_WORD}`];
  if (s.dueCount > 0) metaParts.push(`${s.dueCount} ${DUE_WORD}`);
  return {
    id: String(s.school_ext_id),
    'main-content': {
      title: clip(s.school_name || 'School', 30),
      description: clip(SCHOOL_TAP, 30),
      metadata: clip(metaParts.join(' · '), 80),
    },
    'on-click-action': { name: 'data_exchange', payload: { step: 'school', school_ext_id: String(s.school_ext_id) } },
  };
}

function teacherItem(t, schoolExtId) {
  const mc = {
    title: clip(t.teacher_name || 'Teacher', 30),
    metadata: clip(teacherMeta(t), 80),
  };
  // NIETE roster carries a LEVEL (PRIMARY/MIDDLE/HIGH/…), not a grade.
  const desc = t.level || (t.grade != null && t.grade !== '' ? `Grade ${t.grade}` : null);
  if (desc) mc.description = clip(String(desc), 20);
  return {
    id: String(t.teacher_ext_id),
    'main-content': mc,
    'on-click-action': {
      name: 'data_exchange',
      payload: { step: 'teacher', teacher_ext_id: String(t.teacher_ext_id), school_ext_id: String(schoolExtId) },
    },
  };
}

/** bd-2431 — a Prev/Next NavigationList row re-entering step='school' with `page`. */
function pageNavItem(schoolExtId, page, isNext, remaining) {
  return {
    id: `page:${page}`,
    'main-content': {
      title: clip(isNext ? NEXT_LABEL : PREV_LABEL, 30),
      metadata: clip(isNext ? `${remaining} ${MORE_TEACHERS}` : ' ', 80),
    },
    'on-click-action': {
      name: 'data_exchange',
      payload: { step: 'school', school_ext_id: String(schoolExtId), page },
    },
  };
}

async function schoolsScreen(userId) {
  const schools = await LeaderSource.listSchools(userId);
  return { screen: 'SELECT_SCHOOL', data: { items: schools.map((s) => schoolItem(s)) } };
}

async function teachersScreen(userId, schoolExtId, page = 0) {
  const teachers = await LeaderSource.listTeachers(userId, schoolExtId);
  const p = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 0;
  const start = p * PAGE_SIZE;
  const slice = teachers.slice(start, start + PAGE_SIZE);
  const items = slice.map((t) => teacherItem(t, schoolExtId));
  if (p > 0) items.unshift(pageNavItem(schoolExtId, p - 1, false, 0));
  const remaining = teachers.length - (start + slice.length);
  if (remaining > 0) items.push(pageNavItem(schoolExtId, p + 1, true, remaining));
  // Remember school + page so the system BACK (refresh_on_back) returns HERE.
  try { await ObserveState.setState(userId, 'awaiting_pick', { schoolExtId, page: p }); } catch (_) {}
  return {
    screen: 'SELECT_TEACHER',
    data: { items, school_ext_id: String(schoolExtId || '') },
  };
}

async function briefScreen(userId, screenData) {
  const teacherExtId = screenData && (screenData.teacher_ext_id || screenData.teacher_ext);
  const schoolExtId = screenData && screenData.school_ext_id;
  const brief = await LeaderSource.buildBrief(userId, teacherExtId, schoolExtId);
  // Native Flow text — NO PNG render: the ~10s data_exchange window must never
  // launch a renderer. Fields map 1:1 onto the BRIEF screen's text components.
  const vm = buildBriefViewModel({
    teacher: brief.teacher,
    trend: brief.trend,
    strength: brief.strengthLabel,
    growth: brief.growthLabel,
    moves: brief.moves,
    noData: brief.noData,
  });
  // Keep the page so BACK from BRIEF lands on the same teacher page.
  let page = 0;
  try { const st = await ObserveState.getState(userId); page = (st && st.page) || 0; } catch (_) {}
  try { await ObserveState.setState(userId, 'brief_shown', { schoolExtId, teacherExtId, page }); } catch (_) {}
  return {
    screen: 'BRIEF',
    data: {
      teacher_name: vm.teacher_name,
      subtitle: vm.subtitle,
      strength_text: vm.strength_text,
      growth_text: vm.growth_text,
      moves_intro: vm.moves_intro,
      moves_text: vm.moves_text,
      trend_text: vm.trend_text,
      debrief_reminder: vm.debrief_reminder,
      guidance_text: vm.guidance_text,
      teacher_ext_id: String(teacherExtId || ''),
      school_ext_id: String(schoolExtId || ''),
    },
  };
}

/**
 * "Start observation" completion — bind the chosen teacher and arm
 * awaiting_audio. Returns the bound teacher so flow-response.handler can send
 * the capture prompt. Never throws.
 */
async function bindAndStart(userId, screenData, user) {
  const teacherExtId = screenData && (screenData.teacher_ext_id || screenData.teacher_ext);
  const schoolExtId = screenData && screenData.school_ext_id;
  let teacher = null;
  try {
    teacher = await LeaderSource.resolveTeacher(userId, teacherExtId, schoolExtId);
  } catch (err) {
    logToFile('observe-visit: resolveTeacher failed', { userId, teacherExtId, error: err.message });
  }
  const arm = user ? getObserveArm(user) : 'functional';
  await ObserveState.setState(userId, 'awaiting_audio', {
    arm,
    boundTeacher: teacher, // { teacher_ext_id, teacher_name, phone_e164, user_id, preferred_language } | null
  });
  logToFile('🔭 observe-visit: teacher bound, awaiting_audio', {
    userId, teacherExtId, boundUserId: teacher && teacher.user_id,
  });
  return { action: 'bound', boundTeacher: teacher };
}

/** Recover {schoolExtId, page} from state when the payload lacks them. */
async function rememberedPick(userId, screenData) {
  let schoolExtId = screenData && screenData.school_ext_id;
  let page = screenData && screenData.page;
  if (!schoolExtId || page == null) {
    try {
      const st = await ObserveState.getState(userId);
      if (!schoolExtId) schoolExtId = st && st.schoolExtId;
      if (page == null) page = st && st.page;
    } catch (_) {}
  }
  return { schoolExtId, page: page || 0 };
}

/**
 * @param {string} userId    coach user.id (from flow_token)
 * @param {string} action    'INIT' | 'data_exchange' | 'BACK' | 'complete' | 'ping'
 * @param {string} screen    current screen id
 * @param {object} screenData decrypted screen payload
 * @param {string} flowToken raw flow token
 * @param {object} [user]    coach users row (optional — for the observe arm on bind)
 */
async function handle(userId, action, screen, screenData = {}, flowToken = '', user = null) {
  const step = screenData && screenData.step;
  logToFile('observe-visit flow', { userId, action, screen, step });

  if (action === 'INIT' || action === 'init') {
    return schoolsScreen(userId);
  }

  if (action === 'BACK') {
    // bd-2365 (upstream): `screen` is the screen being LEFT. BACK from the
    // teacher list returns to the SCHOOL picker; BACK from BRIEF returns to
    // the (refreshed) teacher list — same school, SAME PAGE (bd-2431).
    // Requires refresh_on_back:true on both picker screens in the Flow JSON.
    if (screen === 'SELECT_TEACHER') return schoolsScreen(userId);
    const { schoolExtId, page } = await rememberedPick(userId, screenData);
    return teachersScreen(userId, schoolExtId, page);
  }

  if (action === 'complete') {
    return bindAndStart(userId, screenData, user);
  }

  if (action === 'data_exchange') {
    // step='school' serves BOTH the school tap (page 0) and the Prev/Next rows
    // (explicit `page`) — the nav rows re-enter here by design (bd-2431).
    if (step === 'school') return teachersScreen(userId, screenData.school_ext_id, screenData.page || 0);
    if (step === 'teacher') return briefScreen(userId, screenData);
    if (step === 'start') return bindAndStart(userId, screenData, user);
    if (step === 'back') {
      const { schoolExtId, page } = await rememberedPick(userId, screenData);
      return teachersScreen(userId, schoolExtId, page);
    }
    if (!step || screen === 'SELECT_SCHOOL') return schoolsScreen(userId);
  }

  logToFile('observe-visit: unknown action/step', { action, step, screen });
  return schoolsScreen(userId);
}

module.exports = {
  handle,
  // exported for tests / reuse:
  schoolItem,
  teacherItem,
  schoolsScreen,
  teachersScreen,
  briefScreen,
  bindAndStart,
  PAGE_SIZE,
};
