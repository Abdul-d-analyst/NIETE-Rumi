/**
 * GET /api/portal/training/certificates
 *
 * The teacher's own certificates, newest first, each with a DOWNLOAD link when
 * a PDF exists.
 *
 * Three properties this endpoint has to get right, all of them load-bearing:
 *
 *  1. SCOPED TO THE SESSION USER. Certificates are per-teacher records; the
 *     query filters on `req.session.portalUserId` and takes no id from the
 *     request, so there is no shape of request that fetches someone else's.
 *
 *  2. A CERTIFICATE WITHOUT A PDF STILL LISTS. `pdf_r2_key` is null on every
 *     certificate issued before PDFs existed, and generation is best-effort by
 *     design, so null is permanent and valid. Those rows come back with
 *     `download_url: null` — never omitted, never an error row, never a link
 *     that 404s.
 *
 *  3. THE DOWNLOAD IS SIGNED AS AN ATTACHMENT. The HTML `download` attribute
 *     is ignored cross-origin, so the disposition has to come from the
 *     presign — and because the response-header overrides are part of the
 *     SigV4 signature, they must be passed INTO generatePresignedUrl, not
 *     appended to a URL it already returned.
 */

let tableStates;
let presignCalls;

const R2_HOST = 'https://mock-account.r2.cloudflarestorage.com';
const BUCKET = 'mock-bucket';
const USER = 'user-uuid-1';

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {}, orderCol: null, orderDir: null };
  const chain = {};

  const rowsFor = () => {
    let rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        rows = rows.filter((r) => val.in.includes(r[col]));
      } else {
        rows = rows.filter((r) => r[col] === val);
      }
    }
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[record.orderCol], bv = b[record.orderCol];
        if (av === bv) return 0;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }
    return rows;
  };

  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: rowsFor()[0] || null, error: state.error || null }));
  chain.single = jest.fn(async () => ({ data: rowsFor()[0] || null, error: state.error || null }));
  chain._filters = record.filters;
  chain.then = (res, rej) => Promise.resolve(
    state.error ? { data: null, error: state.error } : { data: rowsFor(), error: null },
  ).then(res, rej);
  return chain;
}

let seenFilters;

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  presignCalls = [];
  seenFilters = [];

  process.env.R2_ENDPOINT = R2_HOST;
  process.env.R2_BUCKET_NAME = BUCKET;

  jest.doMock('../../dashboard/config/supabase', () => ({
    from: jest.fn((t) => {
      const c = makeChain(t);
      seenFilters.push({ table: t, filters: c._filters });
      return c;
    }),
  }));

  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(async (url, expiresIn, options) => {
      presignCalls.push({ url, expiresIn, options });
      return `${url}?X-Amz-Signature=deadbeef`;
    }),
    generatePresignedUrls: jest.fn(async (urls) => urls),
    isValidR2Url: (u) => typeof u === 'string' && u.includes('r2.cloudflarestorage.com'),
  }));

  // Same require-time stubs the other portal-route suites install: the router
  // pulls in hashing, a rate limiter (real timers keep the worker alive) and
  // the S3 client at module load.
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

function findRoute(router, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {}).get && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke({ userId }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, '/training/certificates');
  if (!stack) throw new Error('Route GET /training/certificates not found on router');

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: {}, query: {}, method: 'GET', path: '/training/certificates',
    ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
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

const ROWS = [
  {
    id: 'cert-new', user_id: USER, level_id: 3,
    certificate_code: 'PFX-20260802-NEW111',
    teacher_name_snapshot: 'Amina Khan', level_name_snapshot: 'Aspiring Teacher',
    issued_at: '2026-08-02T10:00:00Z',
    pdf_r2_key: 'certs/user-uuid-1/PFX-20260802-NEW111.pdf',
  },
  {
    id: 'cert-old', user_id: USER, level_id: 1,
    certificate_code: 'PFX-L1-20260712-OLD222',
    teacher_name_snapshot: 'Amina Khan', level_name_snapshot: 'Teacher Leader',
    issued_at: '2026-07-12T09:00:00Z',
    pdf_r2_key: null,
  },
  {
    id: 'cert-someone-else', user_id: 'other-user', level_id: 3,
    certificate_code: 'PFX-20260801-OTHER1',
    teacher_name_snapshot: 'Someone Else', level_name_snapshot: 'Aspiring Teacher',
    issued_at: '2026-08-01T10:00:00Z',
    pdf_r2_key: 'certs/other-user/PFX-20260801-OTHER1.pdf',
  },
];

describe('GET /api/portal/training/certificates', () => {
  it('requires portal auth (401 when unauthenticated)', async () => {
    tableStates.training_certificates = { rows: ROWS };
    const { statusCode } = await invoke({ userId: null });
    expect(statusCode).toBe(401);
  });

  it('returns only the session user\'s certificates', async () => {
    tableStates.training_certificates = { rows: ROWS };
    const { statusCode, payload } = await invoke({ userId: USER });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.certificates.map((c) => c.certificate_code))
      .toEqual(['PFX-20260802-NEW111', 'PFX-L1-20260712-OLD222']);

    // The scoping must be in the QUERY, not a post-filter.
    const certQuery = seenFilters.find((f) => f.table === 'training_certificates');
    expect(certQuery.filters.user_id).toBe(USER);
  });

  it('orders newest first', async () => {
    tableStates.training_certificates = { rows: ROWS };
    const { payload } = await invoke({ userId: USER });
    expect(payload.certificates[0].issued_at).toBe('2026-08-02T10:00:00Z');
    expect(payload.certificates[1].issued_at).toBe('2026-07-12T09:00:00Z');
  });

  it('lists a certificate with NO pdf, with download_url null', async () => {
    tableStates.training_certificates = { rows: ROWS };
    const { payload } = await invoke({ userId: USER });

    const old = payload.certificates.find((c) => c.certificate_code === 'PFX-L1-20260712-OLD222');
    expect(old).toBeDefined();
    expect(old.download_url).toBeNull();
    expect(old.level_name).toBe('Teacher Leader');
    // and it must not have been presigned at all
    expect(presignCalls.every((p) => !p.url.includes('OLD222'))).toBe(true);
  });

  it('presigns the stored key as an ATTACHMENT named after the certificate code', async () => {
    tableStates.training_certificates = { rows: ROWS };
    const { payload } = await invoke({ userId: USER });

    const fresh = payload.certificates.find((c) => c.certificate_code === 'PFX-20260802-NEW111');
    expect(fresh.download_url).toContain('X-Amz-Signature');

    expect(presignCalls).toHaveLength(1);
    expect(presignCalls[0].url)
      .toBe(`${R2_HOST}/${BUCKET}/certs/user-uuid-1/PFX-20260802-NEW111.pdf`);
    // The disposition is SIGNED — passed as options, never appended after.
    expect(presignCalls[0].options).toEqual({
      disposition: 'attachment',
      filename: 'PFX-20260802-NEW111.pdf',
    });
  });

  it('returns an empty list rather than an error when the teacher has none', async () => {
    tableStates.training_certificates = { rows: [] };
    const { statusCode, payload } = await invoke({ userId: USER });
    expect(statusCode).toBe(200);
    expect(payload.certificates).toEqual([]);
  });

  it('degrades to download_url null when presigning fails', async () => {
    const r2 = require('../../dashboard/services/r2.service');
    r2.generatePresignedUrl.mockResolvedValueOnce(null);
    tableStates.training_certificates = { rows: [ROWS[0]] };

    const { payload } = await invoke({ userId: USER });
    expect(payload.certificates).toHaveLength(1);
    expect(payload.certificates[0].download_url).toBeNull();
    expect(payload.certificates[0].certificate_code).toBe('PFX-20260802-NEW111');
  });

  it('surfaces a DB error as a 500 rather than a half-list', async () => {
    tableStates.training_certificates = { error: { message: 'connection reset' } };
    const { statusCode, payload } = await invoke({ userId: USER });
    expect(statusCode).toBe(500);
    expect(payload.success).toBe(false);
  });
});
