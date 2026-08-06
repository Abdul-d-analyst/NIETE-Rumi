/**
 * The portal's certificates client — a wire, not a brain.
 *
 * Mirrors dashboard/services/training-rules.service.js: it holds no rules, no
 * rendering, no R2 knowledge. It posts a userId the SESSION established and
 * hands back whatever the bot said.
 *
 * The two failure policies differ on purpose:
 *
 *   listCertificates  THROWS. An empty array is a legitimate answer ("none
 *                     yet"), so returning it on error would tell a teacher
 *                     their certificates do not exist — a plausible lie. Same
 *                     reasoning as getLevelStates in the rules client.
 *
 *   getCertificatePdf returns null. A download that cannot be produced is
 *                     simply unavailable; the caller degrades the ONE
 *                     certificate and the list is untouched.
 */

let client;
let post;

beforeEach(() => {
  jest.resetModules();
  process.env.MAIN_BOT_URL = 'https://bot.example.com';
  process.env.INTERNAL_API_KEY = 'shared-secret-key';

  post = jest.fn();
  jest.doMock('axios', () => ({ post }), { virtual: true });

  client = require('../../dashboard/services/certificates.service');
});

afterEach(() => {
  delete process.env.MAIN_BOT_URL;
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const USER = 'user-uuid-1';
const CODE = 'PFX-20260802-A1B2C3';

const LIST = [
  { id: 'c1', certificate_code: CODE, level_name: 'Aspiring Teacher', teacher_name: 'Amina Khan', issued_at: '2026-08-02T10:00:00Z', has_pdf: false },
];

describe('listCertificates', () => {
  it('posts to the bot with the session userId and the shared key', async () => {
    post.mockResolvedValue({ data: { success: true, certificates: LIST } });

    const out = await client.listCertificates(USER);

    expect(out).toEqual(LIST);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://bot.example.com/api/internal/training/certificates');
    expect(body).toEqual({ userId: USER });
    expect(opts.headers['x-api-key']).toBe('shared-secret-key');
  });

  it('THROWS when the bot is unreachable — never a plausible empty list', async () => {
    post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(client.listCertificates(USER)).rejects.toThrow();
  });

  it('THROWS when the bot answers success:false', async () => {
    post.mockResolvedValue({ data: { success: false } });
    await expect(client.listCertificates(USER)).rejects.toThrow();
  });

  it('THROWS when the client is not configured', async () => {
    jest.resetModules();
    delete process.env.MAIN_BOT_URL;
    jest.doMock('axios', () => ({ post }), { virtual: true });
    const c = require('../../dashboard/services/certificates.service');
    await expect(c.listCertificates(USER)).rejects.toThrow(/not configured/i);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('getCertificatePdf', () => {
  it('returns the bot\'s fetch-or-mint answer', async () => {
    post.mockResolvedValue({
      data: { success: true, certificate_code: CODE, pdf_r2_key: 'certs/u/x.pdf', download_url: 'https://r2/signed', minted: true },
    });

    const out = await client.getCertificatePdf(USER, CODE);

    expect(out).toEqual(expect.objectContaining({ download_url: 'https://r2/signed', minted: true }));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('https://bot.example.com/api/internal/training/certificate-pdf');
    expect(body).toEqual({ userId: USER, certificateCode: CODE });
  });

  it('returns null on a mint failure so ONE certificate degrades, not the list', async () => {
    post.mockRejectedValue(Object.assign(new Error('Bad Gateway'), { response: { status: 502 } }));
    await expect(client.getCertificatePdf(USER, CODE)).resolves.toBeNull();
  });

  it('returns null when the bot is unreachable', async () => {
    post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(client.getCertificatePdf(USER, CODE)).resolves.toBeNull();
  });

  it('distinguishes not-found with a notFound flag rather than a bare null', async () => {
    // The route must be able to answer 404 for "no such certificate" and 502
    // for "we could not render it" — collapsing both to null loses that.
    post.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    const out = await client.getCertificatePdf(USER, CODE);
    expect(out).toEqual({ notFound: true });
  });

  it('returns null when the client is not configured', async () => {
    jest.resetModules();
    delete process.env.INTERNAL_API_KEY;
    jest.doMock('axios', () => ({ post }), { virtual: true });
    const c = require('../../dashboard/services/certificates.service');
    await expect(c.getCertificatePdf(USER, CODE)).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('the client holds no certificate logic', () => {
  const fs = require('fs');
  const path = require('path');

  it('never renders, never touches R2, never reads the certificates table', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../dashboard/services/certificates.service.js'), 'utf8',
    );
    // Scan CODE, not prose. The header deliberately names pdfkit to explain
    // why the render cannot live here; that explanation is the point of the
    // file and must not be what trips its own guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/pdfkit|PDFDocument/i);
    expect(code).not.toMatch(/PutObjectCommand|GetObjectCommand|getSignedUrl/);
    expect(code).not.toMatch(/training_certificates/);
    expect(code).not.toMatch(/pdf_r2_key\s*=/);
    expect(code).not.toMatch(/certs\//);
  });
});
