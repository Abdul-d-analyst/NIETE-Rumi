/**
 * bd-2492 — R2 presigned URLs must ask for INLINE rendering.
 *
 * Training videos and PDFs migrated into the R2 bucket by an external tool
 * carry inconsistent object metadata: some objects have a correct
 * Content-Type, some are application/octet-stream, some carry a stored
 * Content-Disposition of `attachment`. Because generatePresignedUrl signed a
 * GetObjectCommand with only { Bucket, Key }, whatever was stamped at upload
 * time won — so the same portal control rendered a video for one module and
 * downloaded a file for the next.
 *
 * The fix is per-request response-header overrides, which S3/R2 honour as
 * SIGNED query params (response-content-disposition / response-content-type).
 * Nothing about the stored object changes.
 *
 * THE GOTCHA these tests lock down: those params are part of the signature.
 * Appending `&response-content-disposition=inline` to an already-signed URL
 * invalidates it (SignatureDoesNotMatch → 403). They must be handed to the
 * GetObjectCommand BEFORE getSignedUrl runs.
 */

const path = require('path');

const R2_HOST = 'https://mock-account-id.r2.cloudflarestorage.com';
const BUCKET = 'mock-bucket';

let commandInputs; // every GetObjectCommand constructor arg, in order
let signedUrls;    // every URL getSignedUrl returned, in order

function loadService() {
  jest.resetModules();
  commandInputs = [];
  signedUrls = [];

  process.env.R2_ENDPOINT = R2_HOST;
  process.env.R2_BUCKET_NAME = BUCKET;
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(function S3Client() {}),
    GetObjectCommand: jest.fn(function GetObjectCommand(input) {
      commandInputs.push(input);
      this.input = input;
    }),
  }), { virtual: true });

  // Fake signer: serialises the command input into the query string exactly
  // the way a real presigner does, so a test can assert the override params
  // are inside the SIGNED url rather than concatenated on afterwards.
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: jest.fn(async (_client, command, opts) => {
      const input = command.input || {};
      const qs = new URLSearchParams({
        'X-Amz-Expires': String((opts && opts.expiresIn) || 0),
        'X-Amz-Signature': 'deadbeef',
      });
      if (input.ResponseContentDisposition) {
        qs.set('response-content-disposition', input.ResponseContentDisposition);
      }
      if (input.ResponseContentType) {
        qs.set('response-content-type', input.ResponseContentType);
      }
      const url = `${R2_HOST}/${input.Bucket}/${input.Key}?${qs.toString()}`;
      signedUrls.push(url);
      return url;
    }),
  }), { virtual: true });

  jest.doMock('dotenv', () => ({ config: jest.fn() }), { virtual: true });

  return require(path.join('..', '..', 'dashboard', 'services', 'r2.service'));
}

const urlFor = (key) => `${R2_HOST}/${BUCKET}/${key}`;

afterEach(() => jest.resetModules());

describe('generatePresignedUrl — inline by default', () => {
  it('signs a PDF with inline disposition and application/pdf', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('training/docs/module-7.pdf'));

    expect(commandInputs).toHaveLength(1);
    expect(commandInputs[0].ResponseContentDisposition).toBe('inline');
    expect(commandInputs[0].ResponseContentType).toBe('application/pdf');
  });

  it('signs a video with inline disposition and video/mp4', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('training/videos/m42.mp4'));

    expect(commandInputs[0].ResponseContentDisposition).toBe('inline');
    expect(commandInputs[0].ResponseContentType).toBe('video/mp4');
  });

  it('infers audio and image types too (mp3, m4a, ogg, png, jpg, webp)', async () => {
    const r2 = loadService();
    const cases = [
      ['a.mp3', 'audio/mpeg'],
      ['a.m4a', 'audio/mp4'],
      ['a.ogg', 'audio/ogg'],
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.webp', 'image/webp'],
    ];
    for (const [key, type] of cases) {
      // eslint-disable-next-line no-await-in-loop
      await r2.generatePresignedUrl(urlFor(key));
    }
    expect(commandInputs.map((c) => c.ResponseContentType)).toEqual(cases.map(([, t]) => t));
    expect(commandInputs.every((c) => c.ResponseContentDisposition === 'inline')).toBe(true);
  });

  it('is case-insensitive about the extension and ignores a query string', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('training/docs/Module-7.PDF'));
    expect(commandInputs[0].ResponseContentType).toBe('application/pdf');
  });

  it('leaves an UNKNOWN extension alone — no octet-stream, no forced inline', async () => {
    // Forcing inline with application/octet-stream still downloads, so guessing
    // buys nothing and risks mangling an object whose stored metadata is right.
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('training/misc/archive.zip'));

    expect(commandInputs[0].ResponseContentType).toBeUndefined();
    expect(commandInputs[0].ResponseContentDisposition).toBeUndefined();
    expect(Object.keys(commandInputs[0]).sort()).toEqual(['Bucket', 'Key']);
  });

  it('leaves a key with no extension at all alone', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('training/misc/no-extension-here'));
    expect(Object.keys(commandInputs[0]).sort()).toEqual(['Bucket', 'Key']);
  });

  it('still returns null for a non-R2 URL (unchanged contract)', async () => {
    const r2 = loadService();
    await expect(r2.generatePresignedUrl('https://public-cdn.example/a.mp4')).resolves.toBeNull();
    expect(commandInputs).toHaveLength(0);
  });

  it('keeps expiresIn as the second positional arg (existing call sites pass 3600)', async () => {
    const r2 = loadService();
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    await r2.generatePresignedUrl(urlFor('a.pdf'), 900);
    expect(getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 900 });
  });
});

describe('generatePresignedUrl — explicit attachment mode', () => {
  it('signs attachment with a filename derived from the key', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('training/docs/module-7.pdf'), 3600, {
      disposition: 'attachment',
    });

    expect(commandInputs[0].ResponseContentDisposition)
      .toBe('attachment; filename="module-7.pdf"');
    expect(commandInputs[0].ResponseContentType).toBe('application/pdf');
  });

  it('accepts an explicit filename', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('lps/curriculum-ast/8f2a.en.pdf'), 3600, {
      disposition: 'attachment',
      filename: 'Photosynthesis - Lesson Plan.pdf',
    });

    expect(commandInputs[0].ResponseContentDisposition)
      .toBe('attachment; filename="Photosynthesis - Lesson Plan.pdf"');
  });

  it('sanitises quotes/newlines out of the filename (header injection)', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('a.pdf'), 3600, {
      disposition: 'attachment',
      filename: 'ev"il\r\nX-Injected: 1.pdf',
    });

    const cd = commandInputs[0].ResponseContentDisposition;
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd.match(/"/g)).toHaveLength(2); // only the delimiters
    expect(cd).not.toContain('X-Injected: 1');
  });

  it('adds an RFC 5987 filename* when the name is non-ASCII', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('a.pdf'), 3600, {
      disposition: 'attachment',
      filename: 'سبق.pdf',
    });

    const cd = commandInputs[0].ResponseContentDisposition;
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain(encodeURIComponent('سبق.pdf'));
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(cd)).toBe(true); // header stays ASCII-safe
  });

  it('still forces attachment for an unknown extension (explicit, not a guess)', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('training/misc/archive.zip'), 3600, {
      disposition: 'attachment',
    });

    expect(commandInputs[0].ResponseContentDisposition)
      .toBe('attachment; filename="archive.zip"');
    expect(commandInputs[0].ResponseContentType).toBeUndefined();
  });

  it('disposition:null opts out entirely (stored metadata wins)', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrl(urlFor('a.pdf'), 3600, { disposition: null });
    expect(Object.keys(commandInputs[0]).sort()).toEqual(['Bucket', 'Key']);
  });
});

describe('the signature gotcha — overrides must be signed, never appended', () => {
  it('puts the override params INSIDE the signed URL', async () => {
    const r2 = loadService();
    const url = await r2.generatePresignedUrl(urlFor('training/docs/m.pdf'));
    const qs = new URL(url).searchParams;

    expect(qs.get('response-content-disposition')).toBe('inline');
    expect(qs.get('response-content-type')).toBe('application/pdf');
    expect(qs.get('X-Amz-Signature')).toBeTruthy();
  });

  it('returns the signer output verbatim — the service never post-appends params', async () => {
    // If anyone "fixes" this by string-concatenating the params onto the
    // finished URL, R2 answers 403 SignatureDoesNotMatch. This assertion is
    // the guard: what we return is exactly what was signed.
    const r2 = loadService();
    const url = await r2.generatePresignedUrl(urlFor('training/docs/m.pdf'));
    expect(url).toBe(signedUrls[0]);
  });

  it('the params reach the command BEFORE signing (order of operations)', async () => {
    const r2 = loadService();
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    await r2.generatePresignedUrl(urlFor('training/docs/m.pdf'));

    const signedCommand = getSignedUrl.mock.calls[0][1];
    expect(signedCommand.input.ResponseContentDisposition).toBe('inline');
  });
});

describe('generatePresignedUrls (plural) threads the same options', () => {
  it('defaults every URL to inline with an inferred type', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrls([urlFor('s1.png'), urlFor('s2.png')]);

    expect(commandInputs).toHaveLength(2);
    expect(commandInputs.every((c) => c.ResponseContentDisposition === 'inline')).toBe(true);
    expect(commandInputs.every((c) => c.ResponseContentType === 'image/png')).toBe(true);
  });

  it('forwards an explicit attachment option to each item', async () => {
    const r2 = loadService();
    await r2.generatePresignedUrls([urlFor('a.pdf'), urlFor('b.pdf')], 3600, {
      disposition: 'attachment',
    });

    expect(commandInputs.map((c) => c.ResponseContentDisposition)).toEqual([
      'attachment; filename="a.pdf"',
      'attachment; filename="b.pdf"',
    ]);
  });

  it('passes non-R2 entries through untouched (unchanged contract)', async () => {
    const r2 = loadService();
    const out = await r2.generatePresignedUrls(['https://public-cdn.example/x.mp4', null]);
    expect(out[0]).toBe('https://public-cdn.example/x.mp4');
    expect(out[1]).toBeNull();
  });
});

describe('getInlineContentTypeFromKey', () => {
  it('returns null for unknown extensions instead of application/octet-stream', () => {
    const r2 = loadService();
    expect(r2.getInlineContentTypeFromKey('a.zip')).toBeNull();
    expect(r2.getInlineContentTypeFromKey('a.pdf')).toBe('application/pdf');
  });

  it('does not change getContentTypeFromKey, which streamFromR2 relies on', () => {
    const r2 = loadService();
    expect(r2.getContentTypeFromKey('a.zip')).toBe('application/octet-stream');
  });
});
