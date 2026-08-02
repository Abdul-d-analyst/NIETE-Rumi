/**
 * bd-2492 — `_resolveMediaUrl` must be able to ask for a specific disposition.
 *
 * It is the single choke point the training-module endpoint uses for
 * video/audio/PDF URLs: R2-hosted values get presigned, externally-hosted
 * public values pass through. For the inline fix to be reachable from a
 * route (and for a future "Download" control to presign the SAME object as
 * an attachment), the helper has to forward an options object to
 * generatePresignedUrl instead of swallowing it.
 *
 * Exercised directly rather than through the endpoint: the default path is
 * already covered by tests/training/portal-module-media.test.js, and what
 * needs locking here is argument forwarding.
 */

const R2_HOST = 'https://mock-account-id.r2.cloudflarestorage.com';

let generatePresignedUrl;

function loadRoutes() {
  jest.resetModules();

  generatePresignedUrl = jest.fn(async (url) => `presigned:${url}`);

  jest.doMock('../../dashboard/config/supabase', () => ({
    from: jest.fn(() => ({})),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    isValidR2Url: jest.fn((url) => !!url && url.includes('r2.cloudflarestorage.com')),
    generatePresignedUrl,
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }), { virtual: true });

  const routes = require('../../dashboard/routes/portal.routes');
  return routes._resolveMediaUrl;
}

afterEach(() => jest.resetModules());

describe('_resolveMediaUrl — disposition options', () => {
  it('is exported for testing', () => {
    expect(typeof loadRoutes()).toBe('function');
  });

  it('presigns R2 URLs with no options by default (service default = inline)', async () => {
    const resolve = loadRoutes();
    const url = `${R2_HOST}/mock-bucket/training/videos/m42.mp4`;

    await expect(resolve(url, 3600)).resolves.toBe(`presigned:${url}`);
    expect(generatePresignedUrl).toHaveBeenCalledWith(url, 3600, undefined);
  });

  it('forwards an explicit attachment option to generatePresignedUrl', async () => {
    const resolve = loadRoutes();
    const url = `${R2_HOST}/mock-bucket/training/docs/m42.pdf`;

    await resolve(url, 3600, { disposition: 'attachment', filename: 'Module 42.pdf' });
    expect(generatePresignedUrl).toHaveBeenCalledWith(url, 3600, {
      disposition: 'attachment',
      filename: 'Module 42.pdf',
    });
  });

  it('still passes public non-R2 URLs through unchanged, options or not', async () => {
    const resolve = loadRoutes();
    const url = 'https://public-assets.example-cdn.example/objects/abc.mp4';

    await expect(resolve(url, 3600, { disposition: 'attachment' })).resolves.toBe(url);
    expect(generatePresignedUrl).not.toHaveBeenCalled();
  });

  it('still returns null for empty / non-http values', async () => {
    const resolve = loadRoutes();
    await expect(resolve(null)).resolves.toBeNull();
    await expect(resolve('/local/path/file.mp4')).resolves.toBeNull();
  });
});
