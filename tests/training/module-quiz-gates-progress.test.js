/**
 * bd-2390 — the module quiz must GATE progress and next-module delivery.
 *
 * Before this change `handleModuleDone` wrote the progress row on the button
 * tap and fired the quiz + the next module in parallel, so:
 *   - "completed" meant "tapped ▶ Next video", not "passed the check"
 *   - the quiz and the next video arrived at the same time
 *   - a failed module quiz had no retry (status was always 'passed')
 *
 * The contract now:
 *   1. Tapping ▶ Next video on a module WITH questions writes NO progress row
 *      and delivers NO next module — it only sends the quiz.
 *   2. Passing the quiz writes the progress row and then delivers next.
 *   3. Failing the quiz writes NO progress row and offers an immediate retry.
 *   4. A module with NO questions keeps the old behaviour (tap completes it),
 *      otherwise those modules would be uncompletable.
 *
 * Pass marks (NIETE team, confirmed against the historical data):
 *   - module quiz ("quick check")  → 100% for EVERY vendor
 *   - grand quiz (the level exam)  → 80% NIETE/TALEEMABAD, 70% BH/Oxbridge,
 *                                    from training_vendors.passing_pct
 *
 * The grand-quiz bar is exercised in tests/training/grand-quiz-passing-pct.test.js.
 */

let ContentDelivery;
let QuizDelivery;
let supabaseFrom;
let whatsappSend;
let whatsappButtons;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, isCount: false, mutation: null };

  const chain = {};
  const track = () => {
    if (record.mutation && !record._tracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._tracked = true;
    }
  };
  const finalize = () => {
    track();
    if (record.isCount) {
      const count = typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
      return { count, data: null, error: null };
    }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    track();
    if (record.isCount) {
      const count = typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
      return { count, data: null, error: null };
    }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows, error: null };
  };

  chain.select = jest.fn((_cols, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload }; return chain; });
  chain.upsert = jest.fn((payload, opts) => { record.mutation = { op: 'upsert', payload, opts }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.filter = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

function mutationsOn(table) {
  return (tableStates[table] && tableStates[table]._mutations) || [];
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(),
    getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));

  whatsappSend = jest.fn().mockResolvedValue(true);
  whatsappButtons = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: whatsappButtons,
  }));

  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
  }));

  ContentDelivery = require('../../bot/shared/services/training/content-delivery.service');
  QuizDelivery = require('../../bot/shared/services/training/quiz-delivery.service');
});

afterEach(() => jest.resetModules());

const USER = 'user-uuid-1';
const PHONE = '923001234567';

/** Catalog fixture. vendorKey drives the pass bar under test. */
function setupCatalog({
  moduleId = 42, courseId = 7, levelId = 3, vendorKey = 'TALEEMABAD',
  modulePassingPct = 100, examPassingPct = 80,
} = {}) {
  tableStates.training_modules = {
    rows: [{ id: moduleId, course_id: courseId, title: 'Module 1', order_index: 1 }],
  };
  tableStates.training_courses = { rows: [{ id: courseId, level_id: levelId, title: 'Course 1' }] };
  tableStates.training_levels = { rows: [{ id: levelId, name: 'Level 1', order_index: 0, vendor_id: 'vendor-1' }] };
  tableStates.training_vendors = {
    rows: [{
      id: 'vendor-1', key: vendorKey, name: vendorKey,
      module_passing_pct: modulePassingPct, passing_pct: examPassingPct,
      unlock_logic: 'chain',
    }],
  };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.teacher_training_assignments = { rows: [{ program_id: 'program-uuid-1' }] };
  tableStates.training_certificates = { rows: [] };
}

function setQuestionCount(n) {
  tableStates.training_questions = {
    count: n,
    rows: Array.from({ length: n }, (_, i) => ({
      id: 100 + i, training_module_id: 42, question_text: `Q${i + 1}`,
      options: ['A', 'B', 'C', 'D'], correct_option: '1', is_active: true, order_index: i,
    })),
  };
}

/** An attempt row mid-flight, ready for gradeAttempt. */
function setAttempt({ id = 'attempt-uuid-1', totalQuestions = 5, correct = 5, kind = 'training_module' } = {}) {
  tableStates.training_assessment_attempts = {
    rows: [{
      id, user_id: USER, quiz_kind: kind, grand_quiz_id: null,
      training_module_id: 42, level_id: 3, program_id: 'program-uuid-1',
      total_questions: totalQuestions, status: 'in_progress',
    }],
  };
  tableStates.training_assessment_answers = {
    rows: Array.from({ length: totalQuestions }, (_, i) => ({ is_correct: i < correct })),
  };
  return id;
}

describe('bd-2390 — module quiz gates progress + next module', () => {
  test('tapping Next video on a module WITH questions does not write progress', async () => {
    setupCatalog();
    setQuestionCount(5);

    await ContentDelivery.handleModuleDone(USER, 42, PHONE);

    const writes = mutationsOn('teacher_training_progress')
      .filter(m => m.op === 'upsert' || m.op === 'insert');
    expect(writes).toHaveLength(0);
  });

  test('tapping Next video on a module WITH questions does not deliver the next module', async () => {
    setupCatalog();
    setQuestionCount(5);

    await ContentDelivery.handleModuleDone(USER, 42, PHONE);

    // The old behaviour announced "marked done. Loading next module…".
    const said = whatsappSend.mock.calls.map(c => String(c[1])).join('\n');
    expect(said).not.toMatch(/Loading next module/i);
    expect(said).not.toMatch(/marked done/i);
  });

  test('a module with NO questions still completes on tap (otherwise uncompletable)', async () => {
    setupCatalog();
    setQuestionCount(0);

    await ContentDelivery.handleModuleDone(USER, 42, PHONE);

    const writes = mutationsOn('teacher_training_progress')
      .filter(m => m.op === 'upsert' || m.op === 'insert');
    expect(writes.length).toBeGreaterThan(0);
  });

  test('passing the module quiz (NIETE, 100%) writes the progress row', async () => {
    setupCatalog({ vendorKey: 'TALEEMABAD', modulePassingPct: 100 });
    setQuestionCount(5);
    const attemptId = setAttempt({ totalQuestions: 5, correct: 5 }); // perfect — NIETE's bar

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const writes = mutationsOn('teacher_training_progress')
      .filter(m => m.op === 'upsert' || m.op === 'insert');
    expect(writes.length).toBeGreaterThan(0);
  });

  test('NIETE module quiz at 80% FAILS — the module bar is 100, not the exam bar', async () => {
    // Guards the exact confusion this change corrects: 80 is the NIETE
    // LEVEL-EXAM bar; their module quick-checks require every answer right.
    setupCatalog({ vendorKey: 'TALEEMABAD', modulePassingPct: 100, examPassingPct: 80 });
    setQuestionCount(5);
    const attemptId = setAttempt({ totalQuestions: 5, correct: 4 }); // 80%

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const writes = mutationsOn('teacher_training_progress')
      .filter(m => m.op === 'upsert' || m.op === 'insert');
    expect(writes).toHaveLength(0);
    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    expect(updates[updates.length - 1].payload.is_passed).toBe(false);
  });

  test('failing the module quiz writes NO progress row', async () => {
    setupCatalog({ vendorKey: 'TALEEMABAD', modulePassingPct: 100 });
    setQuestionCount(100);
    const attemptId = setAttempt({ totalQuestions: 100, correct: 79 });

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const writes = mutationsOn('teacher_training_progress')
      .filter(m => m.op === 'upsert' || m.op === 'insert');
    expect(writes).toHaveLength(0);
  });

  test('failing offers an immediate retry button (no cooldown)', async () => {
    setupCatalog({ vendorKey: 'TALEEMABAD', modulePassingPct: 100 });
    setQuestionCount(5);
    const attemptId = setAttempt({ totalQuestions: 5, correct: 2 });

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const buttonIds = whatsappButtons.mock.calls
      .flatMap(c => (c[1]?.buttons || []).map(b => b.id));
    expect(buttonIds.some(id => /retry|try_again/i.test(String(id)))).toBe(true);

    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    expect(updates.length).toBeGreaterThan(0);
    // No cooldown for module quizzes — retry is immediate.
    expect(updates[updates.length - 1].payload.cooldown_until).toBeFalsy();
  });

  test('a failed module attempt is recorded as failed, not passed', async () => {
    setupCatalog({ vendorKey: 'TALEEMABAD', modulePassingPct: 100 });
    setQuestionCount(5);
    const attemptId = setAttempt({ totalQuestions: 5, correct: 2 });

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    const last = updates[updates.length - 1].payload;
    expect(last.status).toBe('failed');
    expect(last.is_passed).toBe(false);
  });

  test('Beacon House module quiz passes at 70% where NIETE would fail', async () => {
    setupCatalog({ vendorKey: 'BEACONHOUSE', modulePassingPct: 70, examPassingPct: 70 });
    setQuestionCount(10);
    const attemptId = setAttempt({ totalQuestions: 10, correct: 7 }); // 70%

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    const last = updates[updates.length - 1].payload;
    expect(last.is_passed).toBe(true);
    expect(last.status).toBe('passed');
  });

  test('Oxbridge module quiz passes at 70%', async () => {
    setupCatalog({ vendorKey: 'OXBRIDGE', modulePassingPct: 70, examPassingPct: 70 });
    setQuestionCount(10);
    const attemptId = setAttempt({ totalQuestions: 10, correct: 7 });

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    expect(updates[updates.length - 1].payload.is_passed).toBe(true);
  });

  test('a lookup failure falls back to the strictest bar (100), never an easier pass', async () => {
    setupCatalog({ vendorKey: 'TALEEMABAD', modulePassingPct: 100 });
    setQuestionCount(10);
    tableStates.training_vendors = { rows: [] }; // vendor row missing
    const attemptId = setAttempt({ totalQuestions: 10, correct: 9 }); // 90%

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    expect(updates[updates.length - 1].payload.is_passed).toBe(false);
  });
});

describe('bd-2390 — grand quiz (level exam) uses the vendor exam bar', () => {
  test('NIETE grand quiz passes at 80% (was hardcoded to 100%)', async () => {
    setupCatalog({ vendorKey: 'TALEEMABAD', examPassingPct: 80 });
    const attemptId = setAttempt({ totalQuestions: 10, correct: 8, kind: 'grand' });
    tableStates.training_assessment_attempts.rows[0].grand_quiz_id = 9;
    tableStates.training_assessment_attempts.rows[0].training_module_id = null;

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    const last = updates[updates.length - 1].payload;
    expect(last.is_passed).toBe(true);
    expect(last.status).toBe('passed');
  });

  test('NIETE grand quiz fails below 80%', async () => {
    setupCatalog({ vendorKey: 'TALEEMABAD', examPassingPct: 80 });
    const attemptId = setAttempt({ totalQuestions: 10, correct: 7, kind: 'grand' }); // 70%
    tableStates.training_assessment_attempts.rows[0].grand_quiz_id = 9;
    tableStates.training_assessment_attempts.rows[0].training_module_id = null;

    await QuizDelivery.gradeAttempt(attemptId, PHONE);

    const updates = mutationsOn('training_assessment_attempts').filter(m => m.op === 'update');
    const last = updates[updates.length - 1].payload;
    expect(last.is_passed).toBe(false);
    expect(last.status).toBe('failed');
    // Level exams keep their cooldown — unlike module quizzes.
    expect(last.cooldown_until).toBeTruthy();
  });
});
