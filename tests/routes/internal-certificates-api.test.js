/**
 * The bot owns certificates; the portal asks over HTTP.
 *
 * WHY THIS IS FORCED, NOT PREFERRED
 * ---------------------------------
 * `certificate-pdf.service.js` lives in `bot/shared/…`, so its
 * `require('pdfkit')` resolves from `bot/node_modules` and then the repo root.
 * It never reaches `dashboard/node_modules`. The dashboard declaring pdfkit in
 * its own package.json does not change that — Node resolves from the requiring
 * FILE's directory upward. A portal-side render therefore works in a dev tree
 * where both installs happen to exist and fails in production, which is the
 * worst possible failure shape. Same conclusion the LP enqueue reached: the
 * work stays in the process that has the dependencies, and the portal asks.
 *
 * TWO ROUTES, DELIBERATELY
 *   /training/certificates      list only — never mints, never presigns
 *   /training/certificate-pdf   fetch-or-mint ONE, on an actual request
 *
 * Splitting them is the whole performance story: listing 40 certificates must
 * not render 40 PDFs.
 *
 * IDENTITY: the bot takes `userId` from the caller, and every lookup filters
 * on it. The portal establishes who that is from its own session — the bot
 * never accepts a bare certificate code, so a leaked code is not a download.
 */

let router;
let certs;

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { headers = {}, body = {} } = {}) {
  const stack = findRoute(router, 'post', path);
  if (!stack) throw new Error(`route POST ${path} not found`);
  const req = { headers, body, ip: '127.0.0.1', method: 'POST', path };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

const KEY = 'shared-secret-key';
const auth = { 'x-api-key': KEY };
const USER = 'user-uuid-1';
const CODE = 'PFX-20260802-A1B2C3';

const LIST = [
  { id: 'c1', certificate_code: CODE, level_name: 'Aspiring Teacher', teacher_name: 'Amina Khan', issued_at: '2026-08-02T10:00:00Z', has_pdf: false },
  { id: 'c2', certificate_code: 'PFX-L1-OLD', level_name: 'Teacher Leader', teacher_name: 'Amina Khan', issued_at: '2026-07-12T09:00:00Z', has_pdf: true },
];

const MINTED = {
  certificate_code: CODE,
  level_name: 'Aspiring Teacher',
  teacher_name: 'Amina Khan',
  issued_at: '2026-08-02T10:00:00Z',
  pdf_r2_key: `certs/${USER}/${CODE}.pdf`,
  download_url: 'https://r2.example.com/signed?X-Amz-Signature=abc',
  minted: true,
};

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

  certs = {
    listCertificates: jest.fn().mockResolvedValue(LIST),
    fetchOrMintCertificatePdf: jest.fn().mockResolvedValue(MINTED),
  };
  jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => certs);

  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const ROUTES = [
  ['/training/certificates', { userId: USER }],
  ['/training/certificate-pdf', { userId: USER, certificateCode: CODE }],
];

describe('auth — the same shared-secret gate as the rest of the internal API', () => {
  it.each(ROUTES)('%s rejects a call with no api key', async (path, body) => {
    const { statusCode } = await invoke(path, { body });
    expect(statusCode).toBe(401);
  });

  it.each(ROUTES)('%s rejects a wrong api key', async (path, body) => {
    const { statusCode } = await invoke(path, { headers: { 'x-api-key': 'nope' }, body });
    expect(statusCode).toBe(401);
  });

  it.each(ROUTES)('%s does no work when the key is rejected', async (path, body) => {
    await invoke(path, { headers: { 'x-api-key': 'nope' }, body });
    expect(certs.listCertificates).not.toHaveBeenCalled();
    expect(certs.fetchOrMintCertificatePdf).not.toHaveBeenCalled();
  });

  it('refuses everyone when the bot has no INTERNAL_API_KEY set', async () => {
    jest.resetModules();
    delete process.env.INTERNAL_API_KEY;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/training/certificate-pdf.service', () => certs);
    router = require('../../bot/shared/routes/internal-api.routes');

    const { statusCode } = await invoke('/training/certificates', { body: { userId: USER } });
    expect(statusCode).toBe(401);
    expect(certs.listCertificates).not.toHaveBeenCalled();
  });
});

describe('POST /api/internal/training/certificates — list', () => {
  it('returns the bot\'s list verbatim', async () => {
    const { statusCode, payload } = await invoke('/training/certificates', { headers: auth, body: { userId: USER } });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, certificates: LIST });
    expect(certs.listCertificates).toHaveBeenCalledWith(expect.anything(), USER);
  });

  it('NEVER mints while listing', async () => {
    await invoke('/training/certificates', { headers: auth, body: { userId: USER } });
    expect(certs.fetchOrMintCertificatePdf).not.toHaveBeenCalled();
  });

  it('400s without a userId', async () => {
    const { statusCode } = await invoke('/training/certificates', { headers: auth, body: {} });
    expect(statusCode).toBe(400);
    expect(certs.listCertificates).not.toHaveBeenCalled();
  });

  it('500s on a lookup failure rather than answering an empty list', async () => {
    // An empty list is a legitimate answer ("no certificates yet"). Returning
    // it on error would render a plausible lie — the teacher would be told
    // their certificates do not exist.
    certs.listCertificates.mockRejectedValueOnce(new Error('connection reset'));
    const { statusCode, payload } = await invoke('/training/certificates', { headers: auth, body: { userId: USER } });
    expect(statusCode).toBe(500);
    expect(payload.success).toBe(false);
    expect(payload.certificates).toBeUndefined();
  });
});

describe('POST /api/internal/training/certificate-pdf — fetch or mint', () => {
  it('returns the signed url and whether it had to mint', async () => {
    const { statusCode, payload } = await invoke('/training/certificate-pdf', {
      headers: auth, body: { userId: USER, certificateCode: CODE },
    });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, ...MINTED });
    expect(certs.fetchOrMintCertificatePdf).toHaveBeenCalledWith(
      expect.anything(), { userId: USER, certificateCode: CODE },
    );
  });

  it('reports minted:false when the PDF already existed', async () => {
    certs.fetchOrMintCertificatePdf.mockResolvedValueOnce({ ...MINTED, minted: false });
    const { payload } = await invoke('/training/certificate-pdf', {
      headers: auth, body: { userId: USER, certificateCode: CODE },
    });
    expect(payload.minted).toBe(false);
  });

  it('400s without a userId or a certificateCode', async () => {
    expect((await invoke('/training/certificate-pdf', { headers: auth, body: { certificateCode: CODE } })).statusCode).toBe(400);
    expect((await invoke('/training/certificate-pdf', { headers: auth, body: { userId: USER } })).statusCode).toBe(400);
    expect(certs.fetchOrMintCertificatePdf).not.toHaveBeenCalled();
  });

  it('404s when the certificate is not this user\'s', async () => {
    certs.fetchOrMintCertificatePdf.mockRejectedValueOnce(
      Object.assign(new Error('No such certificate for this user'), { code: 'not_found' }),
    );
    const { statusCode, payload } = await invoke('/training/certificate-pdf', {
      headers: auth, body: { userId: USER, certificateCode: 'SOMEONE-ELSES' },
    });
    expect(statusCode).toBe(404);
    expect(payload.success).toBe(false);
  });

  it('502s on a mint failure — never a 200 with a null url', async () => {
    certs.fetchOrMintCertificatePdf.mockRejectedValueOnce(
      Object.assign(new Error('Certificate PDF could not be generated'), { code: 'mint_failed' }),
    );
    const { statusCode, payload } = await invoke('/training/certificate-pdf', {
      headers: auth, body: { userId: USER, certificateCode: CODE },
    });
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
    expect(payload.download_url).toBeUndefined();
  });

  it('500s on an unexpected error', async () => {
    certs.fetchOrMintCertificatePdf.mockRejectedValueOnce(new Error('kaboom'));
    const { statusCode, payload } = await invoke('/training/certificate-pdf', {
      headers: auth, body: { userId: USER, certificateCode: CODE },
    });
    expect(statusCode).toBe(500);
    expect(payload.success).toBe(false);
  });
});
