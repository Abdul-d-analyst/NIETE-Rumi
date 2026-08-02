/**
 * bd-2490 — the portal serves CONTENT; every assessment happens on WhatsApp.
 *
 * WHY
 * ---
 * The portal's exam UI renders answers as one radio per option. A capstone
 * paper is free text (`options: []`), so a Beacon House teacher saw eight
 * questions, no inputs, a counter stuck at 0/8 and a dead Submit button. The
 * module-quiz surface has its own history of diverging from the bot — its own
 * pass rule (bd-2483), its own progress writes (bd-2450), its own eligibility
 * proxy (bd-2447), each fixed separately after each drifted.
 *
 * Rather than rebuild free-text support and keep two assessment engines in
 * step forever, the portal stops assessing. It keeps what it is good at —
 * videos, PDFs, progress, past results — and hands every quiz to the bot,
 * which already owns grading, scoring, cooldowns and certificates.
 *
 * WHAT STAYS WORKING (deliberately, asserted below)
 *   - module content: video / audio / PDF
 *   - completing a module that has NO quiz (nothing to assess)
 *   - the exam status card, so the UI can render the redirect
 *
 * WHAT REFUSES
 *   - handing over a module quiz paper, or accepting answers for one
 *   - handing over a level exam paper, or accepting answers for one
 *
 * THE GATE IS THE API, NOT THE BUTTON
 * -----------------------------------
 * Hiding the CTA is not enough. #77 shipped precisely this bug in reverse — a
 * '🔒 Locked' label with no server-side check, which started the exam anyway
 * when tapped. A session cookie and curl must hit the same wall the button
 * does, so these tests drive the ROUTES, not the UI.
 */

let supabaseFrom;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, orderCol: null, orderDir: null };
  const chain = {};
  const rowsNow = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter(r => val.in.includes(r[col]));
      } else if (!col.includes('.')) {
        // Honour .eq() as well as .in(). The older portal harnesses treat eq as
        // a no-op, which quietly makes every fixture row visible to every
        // query — that is how a module with no quiz still looked like it had
        // one here, and it is the same gap that let a stale
        // .eq('quiz_kind','grand') filter go untested for months.
        //
        // Compared loosely on purpose: Postgres coerces '101' to 101, and some
        // routes pass req.params through unparsed. Strict equality would make
        // this fixture reject rows the real database returns.
        rows = rows.filter(r => (r[col] === val)
          || (r[col] != null && val != null && String(r[col]) === String(val)));
      }
    }
    return rows;
  };
  const finalize = () => state.error ? { data: null, error: state.error } : { data: rowsNow()[0] || null, error: null };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = rowsNow();
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[record.orderCol] < b[record.orderCol] ? -dir : a[record.orderCol] > b[record.orderCol] ? dir : 0));
    }
    return { data: rows, error: null };
  };
  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach(m => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts && opts.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.insert = jest.fn(() => { inserted.push(tableName); return chain; });
  chain.update = jest.fn(() => chain);
  chain.upsert = jest.fn(() => { upserted.push(tableName); return chain; });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (res, rej) => Promise.resolve(finalizeMany()).then(res, rej);
  return chain;
}

let inserted; let upserted;

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke(method, path, { userId = 'user-1', params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const req = { session: { portalUserId: userId, id: 's1' }, params, query: {}, body, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const h of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = h(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

const UID = 'user-1';
const VENDOR = 'v1';
const LEVEL = 18;
const PLAIN_MODULE = 101;     // order 1, no questions — still completable here
const QUIZZED_MODULE = 102;   // order 2, has questions

function seed(quizType = 'capstone') {
  tableStates.training_vendors = { rows: [{ id: VENDOR, key: 'V', name: 'V', unlock_logic: 'all_modules', has_grand_quiz: true, passing_pct: 70, module_passing_pct: 70 }] };
  tableStates.training_levels = { rows: [{ id: LEVEL, name: 'English', order_index: 1, vendor_id: VENDOR, is_active: true }] };
  tableStates.teacher_training_assignments = { rows: [{ user_id: UID, program_id: 'p1', is_active: true }] };
  tableStates.training_program_scopes = { rows: [{ program_id: 'p1', vendor_id: VENDOR, level_ids: null }] };
  tableStates.training_courses = { rows: [{ id: 1, level_id: LEVEL, is_active: true, title: 'C1', order_index: 1 }] };
  tableStates.training_modules = { rows: [
    { id: PLAIN_MODULE, course_id: 1, is_active: true, title: 'M1', order_index: 1, source_media_url: 'https://x/d.pdf' },
    { id: QUIZZED_MODULE, course_id: 1, is_active: true, title: 'M2', order_index: 2, video_url: 'https://x/v.mp4' },
  ] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_assessment_attempts = { rows: [] };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.training_certificates = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [{ id: 30, level_id: LEVEL, quiz_type: quizType, is_active: true }] };
  tableStates.training_questions = {
    rows: Array.from({ length: 3 }, (_, i) => ({
      id: 900 + i, grand_quiz_id: 30, training_module_id: QUIZZED_MODULE,
      question_text: `Q${i + 1}`, order_index: i, is_active: true,
      options: quizType === 'capstone' ? [] : ['a', 'b'], correct_option: quizType === 'capstone' ? '' : '1',
    })),
  };
}

beforeEach(() => {
  jest.resetModules();
  // The production default. The four portal quiz suites open a test seam to
  // exercise the retained grading logic; this one must never see it.
  delete process.env.PORTAL_ASSESSMENTS_TEST_ENABLE;
  tableStates = {}; inserted = []; upserted = [];
  supabaseFrom = jest.fn(t => makeChain(t));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn() }));
  require('../fixtures/delegate-training-to-bot').installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_r, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

const ASSESSMENT_ROUTES = [
  ['get', '/training/module/:id/questions', { params: { id: String(QUIZZED_MODULE) } }],
  ['post', '/training/module/:id/quiz-attempts', { params: { id: String(QUIZZED_MODULE) }, body: { answers: [{ question_id: 900, chosen_option: '1' }] } }],
  ['get', '/training/level/:id/grand-quiz/questions', { params: { id: String(LEVEL) } }],
  ['post', '/training/level/:id/grand-quiz/attempts', { params: { id: String(LEVEL) }, body: { answers: [{ question_id: 900, chosen_option: '1' }] } }],
];

describe('bd-2490 — every assessment route refuses and points at WhatsApp', () => {
  it.each(ASSESSMENT_ROUTES)('%s %s refuses', async (method, path, opts) => {
    seed();
    const { statusCode, payload } = await invoke(method, path, opts);
    expect(statusCode).toBe(409);
    expect(payload.code).toBe('whatsapp_only');
  });

  it.each(ASSESSMENT_ROUTES)('%s %s tells the teacher where to go', async (method, path, opts) => {
    seed();
    const { payload } = await invoke(method, path, opts);
    expect(String(payload.error).toLowerCase()).toContain('whatsapp');
  });

  it('refuses an MCQ module quiz too — this is not capstone-specific', async () => {
    seed('grand_quiz');
    const { statusCode, payload } = await invoke('post', '/training/module/:id/quiz-attempts', {
      params: { id: String(QUIZZED_MODULE) }, body: { answers: [{ question_id: 900, chosen_option: '1' }] },
    });
    expect(statusCode).toBe(409);
    expect(payload.code).toBe('whatsapp_only');
  });

  it('writes NOTHING when it refuses — no attempt, no answers, no progress', async () => {
    seed();
    await invoke('post', '/training/module/:id/quiz-attempts', {
      params: { id: String(QUIZZED_MODULE) }, body: { answers: [{ question_id: 900, chosen_option: '1' }] },
    });
    expect(inserted).toHaveLength(0);
    expect(upserted).toHaveLength(0);
  });

  it('never leaks the paper in the refusal body', async () => {
    seed('grand_quiz');
    const { payload } = await invoke('get', '/training/level/:id/grand-quiz/questions', { params: { id: String(LEVEL) } });
    expect(payload.questions).toBeUndefined();
  });
});

describe('bd-2490 — the block is the DEFAULT, not an opt-in', () => {
  it('refuses with no environment variable set at all', () => {
    // If the default ever flips to open, every teacher gets a quiz form the
    // portal cannot grade — and the four suites that open the test seam would
    // still pass, so only this assertion would catch it.
    expect(process.env.PORTAL_ASSESSMENTS_TEST_ENABLE).toBeUndefined();
    const src = require('fs').readFileSync(require.resolve('../../dashboard/routes/portal.routes'), 'utf8');
    expect(src).toContain("process.env.PORTAL_ASSESSMENTS_TEST_ENABLE !== '1'");
  });
});

describe('bd-2490 — content still works', () => {
  it('serves module content', async () => {
    seed();
    const { statusCode } = await invoke('get', '/training/module/:id', { params: { id: String(PLAIN_MODULE) } });
    expect(statusCode).toBe(200);
  });

  it('still lists levels', async () => {
    seed();
    const { statusCode } = await invoke('get', '/training/levels', {});
    expect(statusCode).toBe(200);
  });

  it('reports whatsapp_only ONLY when the exam is actually sittable', async () => {
    seed();
    tableStates.teacher_training_progress = { rows: [
      { user_id: UID, module_id: PLAIN_MODULE }, { user_id: UID, module_id: QUIZZED_MODULE },
    ] };  // level complete -> the bot's gate says ready
    const { statusCode, payload } = await invoke('get', '/training/level/:id/grand-quiz', { params: { id: String(LEVEL) } });
    expect(statusCode).toBe(200);
    expect(payload.grand_quiz.state).toBe('whatsapp_only');
  });

  /**
   * Regression: the first cut returned 'whatsapp_only' ahead of every other
   * state, so a teacher with unfinished coursework was told to go and take the
   * exam on WhatsApp — where the bot would refuse her. Sending someone to
   * another surface for nothing is worse than the dead form this replaced.
   */
  it('still says courses_incomplete when the coursework is not done', async () => {
    seed();   // no progress at all
    const { payload } = await invoke('get', '/training/level/:id/grand-quiz', { params: { id: String(LEVEL) } });
    expect(payload.grand_quiz.state).toBe('courses_incomplete');
  });

  it('refuses the paper even in a state that is not whatsapp_only', async () => {
    // The redirect card is display; the API is the gate, and it does not
    // consult eligibility before refusing.
    seed();
    const { statusCode, payload } = await invoke('get', '/training/level/:id/grand-quiz/questions', { params: { id: String(LEVEL) } });
    expect(statusCode).toBe(409);
    expect(payload.code).toBe('whatsapp_only');
  });

  it('still completes a module that has NO quiz — there is nothing to assess', async () => {
    seed();
    const { statusCode } = await invoke('post', '/training/module/:id/complete', { params: { id: String(PLAIN_MODULE) } });
    expect(statusCode).toBe(200);
  });
});
