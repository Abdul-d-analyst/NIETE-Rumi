/**
 * bd-2461 — the portal's LP render must enqueue through the bot, and must never
 * claim success when it did not.
 *
 * Before: the endpoint required the bot's queue service into the dashboard
 * process. That throws (the queue driver needs aws-sdk v2; the dashboard only
 * has the v3 @aws-sdk/* packages), the throw was swallowed by `catch (_) {}`,
 * and it fell through to writing a `pending` row that nothing consumes — while
 * answering `202 { queued: true }`. The UI turned that into "Ready in about 2
 * minutes." 21 orphan rows accumulated; a live trigger confirmed it, returning
 * `"fallback": true` and never being picked up in four minutes of polling.
 *
 * After: the portal POSTs to the bot's internal API — the same pattern
 * password-reset already uses in production, with MAIN_BOT_URL and
 * INTERNAL_API_KEY already provisioned on the portal service. The enqueue
 * stays in the bot's process where its dependencies live.
 *
 * Contract:
 *   1. Enqueue goes over HTTP to MAIN_BOT_URL with the shared key.
 *   2. A failure is surfaced as a failure. No `queued: true`, and NO orphan
 *      row left behind for someone to find two days later.
 *   3. The dashboard no longer needs bot code in-process for this path.
 *   4. The already-cached fast path is untouched.
 */

let supabaseFrom;
let tableStates;
let inserts;   // [{ table, row }]  — every .insert() call captured for shape assertions
let upserts;   // [{ table, row, opts }]  — every .upsert() call

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, rangeArgs: null };
  const chain = {};

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[record.orderCol], bv = b[record.orderCol];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }
    return { data: rows, error: null };
  };

  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn((a, b) => { record.rangeArgs = [a, b]; return chain; });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.insert = jest.fn((rowOrRows) => {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    for (const r of rows) inserts.push({ table: tableName, row: r });
    // Support .insert(...).select().single() chain returning first row with an id
    const returned = { ...(rows[0] || {}) };
    if (returned.id == null) returned.id = state.newId || 'generated-id';
    const insertChain = {
      select: jest.fn(() => insertChain),
      single: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      maybeSingle: jest.fn(async () => ({ data: returned, error: state.insertError || null })),
      then: (resolve, reject) => Promise.resolve({ data: state.insertError ? null : returned, error: state.insertError || null }).then(resolve, reject),
    };
    return insertChain;
  });
  chain.upsert = jest.fn((row, opts) => {
    upserts.push({ table: tableName, row, opts });
    const upsertChain = {
      select: jest.fn(() => upsertChain),
      single: jest.fn(async () => ({ data: row, error: null })),
      then: (resolve, reject) => Promise.resolve({ data: row, error: null }).then(resolve, reject),
    };
    return upsertChain;
  });
  chain.update = jest.fn(() => ({ eq: jest.fn(() => ({ then: (r) => Promise.resolve({ data: null, error: null }).then(r) })) }));
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods[method] && p === path) return layer.route.stack.map(s => s.handle);
  }
  return null;
}

async function invoke({ userId, params = {}, body = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', '/training/module/:id/quiz-attempts');
  if (!stack) throw new Error('Route POST /training/module/:id/quiz-attempts not found');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query: {},
    method: 'POST',
    path: `/training/module/${params.id}/quiz-attempts`,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };

  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => resolve(), () => resolve());
      } else if (advanced === false) {
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

// A canonical 3-question module used by most happy-path tests.
function seedThreeQuestionModule({ moduleId = 42, courseId = 7, levelId = 1, programId = 'prog-1' } = {}) {
  tableStates.training_questions = {
    rows: [
      { id: 101, training_module_id: moduleId, question_text: 'Q1', options: [{ text: 'a' }, { text: 'b' }], correct_option: '1', order_index: 0, is_active: true },
      { id: 102, training_module_id: moduleId, question_text: 'Q2', options: [{ text: 'a' }, { text: 'b' }], correct_option: '2', order_index: 1, is_active: true },
      { id: 103, training_module_id: moduleId, question_text: 'Q3', options: [{ text: 'a' }, { text: 'b' }], correct_option: '1', order_index: 2, is_active: true },
    ],
  };
  tableStates.training_modules = {
    rows: [{ id: moduleId, course_id: courseId, title: 'M', is_active: true }],
  };
  tableStates.training_courses = {
    rows: [{ id: courseId, level_id: levelId, title: 'C' }],
  };
  tableStates.training_levels = {
    rows: [
      // Level 1 has no previous, so it's never "locked" in the state map.
      { id: levelId, name: 'L1', order_index: 0, is_active: true },
    ],
  };
  tableStates.teacher_training_assignments = {
    rows: [{ program_id: programId, user_id: 'user-1', is_active: true }],
  };
  tableStates.training_assessment_attempts = {
    // Empty by default — no in-progress row, no history
    rows: [],
    newId: 'attempt-uuid-1',
  };
  tableStates.training_assessment_answers = { rows: [] };
  tableStates.teacher_training_progress = { rows: [] };
  tableStates.training_grand_quizzes = { rows: [] };
}

let axiosPost;

beforeEach(() => {
  jest.resetModules();
  process.env.MAIN_BOT_URL = 'https://bot.example.test';
  process.env.INTERNAL_API_KEY = 'shared-secret-key';
  axiosPost = jest.fn().mockResolvedValue({ data: { success: true, requestId: 'request-uuid-1' } });
  jest.doMock('axios', () => ({ post: axiosPost, get: jest.fn(), create: jest.fn(() => ({ post: axiosPost, get: jest.fn() })) }), { virtual: true });

  tableStates = {};
  inserts = [];
  upserts = [];

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  jest.doMock('pg', () => ({ Pool: jest.fn(() => ({ query: jest.fn(), on: jest.fn() })) }), { virtual: true });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());


const BOT_URL = 'https://bot.example.test';
const KEY = 'shared-secret-key';

function seedLp({ uuid = 'lp-uuid-1', cachedEn = null, cachedUr = null } = {}) {
  tableStates.curriculum_lp_ast = {
    rows: [{
      source_lp_uuid: uuid, chapter_title: 'Chapter 1', topic: 'Memory Lane Topic',
      publisher: 'NBF', pdf_r2_key_en: cachedEn, pdf_r2_key_ur: cachedUr,
    }],
  };
  tableStates.users = { rows: [{ id: 'user-1', phone_number: '923001234567' }] };
  tableStates.lesson_plan_requests = { rows: [], newId: 'orphan-row-id' };
}

const progressInserts = () => inserts.filter(i => i.table === 'lesson_plan_requests');

async function render(uuid = 'lp-uuid-1', body = { language: 'en' }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = (() => {
    for (const layer of routes.stack) {
      if (!layer.route) continue;
      if ((layer.route.methods || {}).post && layer.route.path === '/curriculum/lp/:source_lp_uuid/render') {
        return layer.route.stack.map(s => s.handle);
      }
    }
    return null;
  })();
  if (!stack) throw new Error('render route not found');
  const req = {
    session: { portalUserId: 'user-1', id: 's1' },
    params: { source_lp_uuid: uuid }, body, query: {},
    method: 'POST', path: `/curriculum/lp/${uuid}/render`, ip: '127.0.0.1',
    headers: { host: 'portal.example.com' }, get: () => 'portal.example.com', protocol: 'https',
  };
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const h of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const m = h(req, res, () => { advanced = true; resolve(); });
      if (m && typeof m.then === 'function') m.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

describe('bd-2461 — the portal enqueues over the bot internal API', () => {
  it('POSTs to MAIN_BOT_URL with the shared key', async () => {
    seedLp();

    await render();

    expect(axiosPost).toHaveBeenCalled();
    const [url, body, config] = axiosPost.mock.calls[0];
    expect(url).toBe(`${BOT_URL}/api/internal/queue-lesson-plan`);
    expect(config.headers['x-api-key']).toBe(KEY);
    expect(body).toMatchObject({ sourceLpUuid: 'lp-uuid-1', userId: 'user-1', language: 'en' });
  });

  it('uses a 10s timeout, matching the existing internal call', async () => {
    seedLp();
    await render();
    expect(axiosPost.mock.calls[0][2].timeout).toBe(10000);
  });

  it('returns the bot\'s requestId on success', async () => {
    seedLp();

    const { statusCode, payload } = await render();

    expect(statusCode).toBe(202);
    expect(payload).toMatchObject({ success: true, queued: true, requestId: 'request-uuid-1' });
  });

  it('does not require the bot queue service into the dashboard process', async () => {
    seedLp();
    await render();
    // The old path wrote the row itself; the bot owns that now.
    expect(progressInserts()).toHaveLength(0);
  });
});

describe('bd-2461 — a failed enqueue is reported, not hidden', () => {
  it('does NOT answer queued:true when the bot call fails', async () => {
    seedLp();
    axiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { statusCode, payload } = await render();

    expect(payload.queued).not.toBe(true);
    expect(payload.success).toBe(false);
    expect(statusCode).toBeGreaterThanOrEqual(500);
  });

  it('leaves NO orphan pending row behind when the bot call fails', async () => {
    // The whole bug: a row nothing would ever consume, plus a cheerful 202.
    seedLp();
    axiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await render();

    expect(progressInserts()).toHaveLength(0);
  });

  it('reports a failure when the bot answers without a requestId', async () => {
    seedLp();
    axiosPost.mockResolvedValueOnce({ data: { success: false } });

    const { payload } = await render();

    expect(payload.queued).not.toBe(true);
  });
});

describe('bd-2461 — untouched behaviour', () => {
  it('still fast-paths an already-cached PDF without calling the bot', async () => {
    seedLp({ cachedEn: 'r2/key/en.pdf' });

    const { payload } = await render('lp-uuid-1', { language: 'en' });

    expect(payload).toMatchObject({ alreadyAvailable: true });
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('still 404s an unknown lesson plan', async () => {
    tableStates.curriculum_lp_ast = { rows: [] };
    tableStates.users = { rows: [{ id: 'user-1', phone_number: '923001234567' }] };

    const { statusCode } = await render('nope');

    expect(statusCode).toBe(404);
  });
});
