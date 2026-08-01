/**
 * bd-2447 — "Ready for exam" must mean every module is passed.
 *
 * The level card read "5/5 courses ✓ · Ready for exam" for a teacher who had
 * passed almost none of the level's modules. The cause was a phase-1 proxy
 * that outlived its phase: `loadVisibleLevelsWithProgress` counted a course as
 * complete when ANY ONE of its modules had a progress row —
 *
 *     const coursesStarted = lvCourses.filter(c => (progressByCourse.get(c.id) || 0) > 0);
 *     ...
 *     else if (coursesStarted.length === lvCourses.length) state = 'ready_for_quiz';
 *
 * — and then shipped that count out as `courses_completed`, which
 * levelProgressLine renders as "N/N courses ✓". One module done in each of 5
 * courses produced "5/5 courses ✓ · Ready for exam" off 5 modules out of 60.
 *
 * The proxy's own comment said it stood in "until the module-completion path
 * is wired". bd-2390 wired it: a teacher_training_progress row now means the
 * module's quick check was PASSED (or the module had no quiz), so "all modules
 * have progress rows" is exactly "all modules passed".
 *
 * Contract:
 *   1. A course is complete when EVERY active module under it is done.
 *   2. A level is ready_for_quiz only when every course is complete.
 *   3. courses_completed reports completed courses, not started ones.
 *   4. loadGrandQuizState uses the SAME rule — the two were deliberately kept
 *      aligned to stop HOME and LEVEL_DETAIL contradicting each other, and
 *      that alignment has to survive the tightening.
 *   5. A course with no active modules is not counted either way: counting it
 *      as incomplete would strand the level forever, counting it as complete
 *      would hand out a free pass.
 *
 * Not in scope: an already-certified level stays certified. `passedAttempt` is
 * checked before the ready rule in the state ladder, so a teacher who really
 * sat and passed the exam is untouched by this change (asserted below).
 */

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, orderCol: null, orderDir: null };
  const chain = {};
  const applyFilters = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) out = out.filter(r => val.in.includes(r[col]));
      else if (!col.includes('.')) out = out.filter(r => r[col] === val);
    }
    return out;
  };
  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = applyFilters(typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
    if (record.isCount) return { count: rows.length, data: null, error: null };
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = applyFilters(typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []));
    if (record.isCount) return { count: rows.length, data: null, error: null };
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };
  chain.select = jest.fn((_cols, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

const VENDOR = 'v-niete';
const UID = 'u1';
const LEVEL = 3;

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  supabaseFrom = jest.fn((t) => makeChain(t));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  }));
});

afterEach(() => jest.resetModules());

/**
 * One NIETE level with `courses` courses of `modulesPerCourse` modules each.
 * `doneModuleIds` is exactly what the teacher has passed.
 *
 * Module ids are deterministic: course c (1-based), module m (1-based) →
 * c * 100 + m. So course 1 owns 101, 102 …; course 2 owns 201, 202 …
 */
function seed({ courses = 5, modulesPerCourse = 4, doneModuleIds = [], extraCourses = [] } = {}) {
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: [LEVEL] }] };
  tableStates.training_vendors = {
    rows: [{ id: VENDOR, key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', has_grand_quiz: true, passing_pct: 80 }],
  };
  tableStates.training_levels = {
    rows: [{ id: LEVEL, name: 'Skilled Practitioner', order_index: 0, vendor_id: VENDOR, is_active: true, cpd_level: null }],
  };

  const courseRows = [];
  const moduleRows = [];
  for (let c = 1; c <= courses; c++) {
    courseRows.push({ id: c, level_id: LEVEL, is_active: true, title: `Course ${c}`, order_index: c });
    for (let m = 1; m <= modulesPerCourse; m++) {
      moduleRows.push({ id: c * 100 + m, course_id: c, is_active: true, title: `Module ${c}.${m}`, order_index: m });
    }
  }
  for (const ec of extraCourses) courseRows.push({ ...ec, level_id: LEVEL, is_active: true });

  tableStates.training_courses = { rows: courseRows };
  tableStates.training_modules = { rows: moduleRows };
  tableStates.teacher_training_progress = {
    rows: doneModuleIds.map(id => ({
      user_id: UID, module_id: id,
      module: { course_id: moduleRows.find(m => m.id === id)?.course_id },
    })),
  };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [{ id: 7, level_id: LEVEL, quiz_type: 'grand_quiz', is_active: true }] };
  tableStates.training_questions = { rows: [] };
}

/** Every module of every course — a genuinely finished level. */
function allModules(courses = 5, modulesPerCourse = 4) {
  const ids = [];
  for (let c = 1; c <= courses; c++) for (let m = 1; m <= modulesPerCourse; m++) ids.push(c * 100 + m);
  return ids;
}

/** The first module of each course — the exact shape that produced the bug. */
function oneModulePerCourse(courses = 5) {
  return Array.from({ length: courses }, (_, i) => (i + 1) * 100 + 1);
}

function loadLevel() {
  const ep = require('../../bot/shared/routes/teacher-training-endpoint');
  return ep.loadVisibleLevelsWithProgress(UID).then(ls => ls.find(l => l.id === LEVEL));
}

describe('bd-2447 — a level is ready for the exam only when every module is passed', () => {
  test('the reported bug: 1 module done in each of 5 courses is NOT ready for exam', async () => {
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: oneModulePerCourse(5) });

    const lv = await loadLevel();

    expect(lv.state).not.toBe('ready_for_quiz');
    expect(lv.state).toBe('in_progress');
  });

  test('the reported bug: that teacher does not read "5/5 courses"', async () => {
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: oneModulePerCourse(5) });

    const lv = await loadLevel();

    // 5 courses touched, 0 finished.
    expect(lv.courses_completed).toBe(0);
    expect(lv.courses_total).toBe(5);
  });

  test('a course is complete only when ALL of its modules are done', async () => {
    // Course 1 fully done (101-104), course 2 one short (201-203 of 4).
    seed({ courses: 2, modulesPerCourse: 4, doneModuleIds: [101, 102, 103, 104, 201, 202, 203] });

    const lv = await loadLevel();

    expect(lv.courses_completed).toBe(1);
    expect(lv.state).toBe('in_progress');
  });

  test('one module short of the whole level is still not ready', async () => {
    const done = allModules(5, 4).slice(0, -1);
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: done });

    const lv = await loadLevel();

    expect(lv.state).toBe('in_progress');
    expect(lv.courses_completed).toBe(4);
  });

  test('every module done DOES make the level ready for the exam', async () => {
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: allModules(5, 4) });

    const lv = await loadLevel();

    expect(lv.state).toBe('ready_for_quiz');
    expect(lv.courses_completed).toBe(5);
    expect(lv.pct_complete).toBe(100);
  });

  test('no modules done at all still reads not_started', async () => {
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: [] });

    const lv = await loadLevel();

    expect(lv.state).toBe('not_started');
    expect(lv.courses_completed).toBe(0);
  });

  test('a course with no active modules is excluded, not treated as complete', async () => {
    // Course 9 is empty. If it counted as complete the level would go ready
    // on a free pass; if it counted as incomplete the level could never be
    // finished at all. It should simply not be in the denominator.
    seed({
      courses: 2, modulesPerCourse: 3,
      doneModuleIds: allModules(2, 3),
      extraCourses: [{ id: 9, title: 'Empty course', order_index: 9 }],
    });

    const lv = await loadLevel();

    expect(lv.courses_total).toBe(2);
    expect(lv.courses_completed).toBe(2);
    expect(lv.state).toBe('ready_for_quiz');
  });

  test('an already-certified level is untouched by the stricter rule', async () => {
    // Passed the real exam, but barely any modules have progress rows — the
    // shape a migrated teacher can be in. Certification must survive.
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: [101] });
    tableStates.training_assessment_attempts.rows.push({
      user_id: UID, level_id: LEVEL, quiz_kind: 'grand', grand_quiz_id: 7,
      training_module_id: null, status: 'passed', is_passed: true,
      cooldown_until: null, completed_at: '2026-07-31T15:00:00Z',
    });

    const lv = await loadLevel();

    expect(lv.state).toBe('certified');
  });
});

describe('bd-2447 — LEVEL_DETAIL agrees with HOME', () => {
  test('the exam gate stays locked when only one module per course is done', async () => {
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: oneModulePerCourse(5) });
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');

    const gate = await ep.loadGrandQuizState(UID, LEVEL);

    expect(gate.cta).toMatch(/locked/i);
  });

  test('the exam gate opens once every module is done', async () => {
    seed({ courses: 5, modulesPerCourse: 4, doneModuleIds: allModules(5, 4) });
    const ep = require('../../bot/shared/routes/teacher-training-endpoint');

    const gate = await ep.loadGrandQuizState(UID, LEVEL);

    expect(gate.cta).not.toMatch(/locked/i);
    expect(gate.cta).toMatch(/start exam/i);
  });

  test('HOME and LEVEL_DETAIL never disagree across a spread of progress', async () => {
    // The alignment bug this pairing exists to prevent: whatever the rule is,
    // ready_for_quiz on HOME and an unlocked gate on LEVEL_DETAIL must be the
    // same condition.
    const spreads = [[], [101], oneModulePerCourse(3), allModules(3, 3).slice(0, -1), allModules(3, 3)];
    for (const done of spreads) {
      jest.resetModules();
      seed({ courses: 3, modulesPerCourse: 3, doneModuleIds: done });
      const ep = require('../../bot/shared/routes/teacher-training-endpoint');
      const lv = (await ep.loadVisibleLevelsWithProgress(UID)).find(l => l.id === LEVEL);
      const gate = await ep.loadGrandQuizState(UID, LEVEL);

      const homeReady = lv.state === 'ready_for_quiz';
      const detailReady = !/locked/i.test(gate.cta);
      expect({ done: done.length, homeReady, detailReady })
        .toEqual({ done: done.length, homeReady: detailReady, detailReady });
    }
  });
});
