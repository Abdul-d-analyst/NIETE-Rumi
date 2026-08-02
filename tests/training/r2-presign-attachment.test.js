/**
 * The bot's presigner must be able to ask for an ATTACHMENT.
 *
 * A certificate is the one artefact a teacher wants as a FILE — saved, printed,
 * handed to a head teacher — not a tab. R2 decides that from
 * Content-Disposition, and the stored objects carry whatever metadata the
 * uploader stamped. The fix is per-request response-header overrides.
 *
 * THE GOTCHA, identical to the dashboard's (already learned there): those
 * overrides are SIGNED query parameters. They must be handed to the
 * GetObjectCommand BEFORE getSignedUrl runs. Appending
 * `&response-content-disposition=attachment` to a URL the signer already
 * returned invalidates the signature and R2 answers 403.
 *
 * The parameter is optional and additive — every existing caller passes at
 * most (url, expiresIn) and must keep behaving exactly as before, signing a
 * bare { Bucket, Key } with no overrides at all.
 */

const R2_HOST = 'https://acct.r2.cloudflarestorage.com';
const BUCKET = 'test-bucket';

let commandInputs;
let r2;

beforeEach(() => {
  jest.resetModules();
  commandInputs = [];

  process.env.R2_ENDPOINT = R2_HOST;
  process.env.R2_BUCKET_NAME = BUCKET;
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(function S3Client() {}),
    PutObjectCommand: jest.fn(function PutObjectCommand(i) { this.input = i; }),
    DeleteObjectCommand: jest.fn(function DeleteObjectCommand(i) { this.input = i; }),
    GetObjectCommand: jest.fn(function GetObjectCommand(input) {
      commandInputs.push(input);
      this.input = input;
    }),
  }), { virtual: true });

  jest.doMock('@aws-sdk/s3-request-presigner', () => ({
    // Serialise the command input into the query string the way a real
    // presigner does, so a test can prove the overrides are INSIDE the signed
    // URL rather than concatenated afterwards.
    getSignedUrl: jest.fn(async (_client, command, opts) => {
      const input = command.input || {};
      const qs = new URLSearchParams({
        'X-Amz-Expires': String((opts && opts.expiresIn) || 0),
        'X-Amz-Signature': 'deadbeef',
      });
      if (input.ResponseContentDisposition) qs.set('response-content-disposition', input.ResponseContentDisposition);
      if (input.ResponseContentType) qs.set('response-content-type', input.ResponseContentType);
      return `${R2_HOST}/${BUCKET}/${input.Key}?${qs.toString()}`;
    }),
  }), { virtual: true });

  r2 = require('../../bot/shared/storage/r2');
});

const URL_FOR = (key) => `${R2_HOST}/${BUCKET}/${key}`;
const KEY = 'certs/user-abc/PFX-20260802-A1B2C3.pdf';

describe('getPresignedUrl — unchanged for every existing caller', () => {
  it('signs a bare { Bucket, Key } when no options are given', async () => {
    await r2.getPresignedUrl(URL_FOR(KEY), 3600);
    expect(commandInputs).toHaveLength(1);
    expect(commandInputs[0]).toEqual({ Bucket: BUCKET, Key: KEY });
  });

  it('still short-circuits a non-R2 url', async () => {
    const out = await r2.getPresignedUrl('https://example.com/file.pdf', 3600);
    expect(out).toBe('https://example.com/file.pdf');
    expect(commandInputs).toHaveLength(0);
  });
});

describe('getPresignedUrl — attachment mode', () => {
  it('signs Content-Disposition: attachment with the given filename', async () => {
    const url = await r2.getPresignedUrl(URL_FOR(KEY), 3600, {
      disposition: 'attachment', filename: 'PFX-20260802-A1B2C3.pdf',
    });

    expect(commandInputs[0].ResponseContentDisposition)
      .toBe('attachment; filename="PFX-20260802-A1B2C3.pdf"');
    expect(commandInputs[0].ResponseContentType).toBe('application/pdf');

    // and they are IN the signed url, not bolted on after
    expect(url).toContain('response-content-disposition=');
    expect(url).toContain('X-Amz-Signature');
  });

  it('falls back to the key basename when no filename is given', async () => {
    await r2.getPresignedUrl(URL_FOR(KEY), 3600, { disposition: 'attachment' });
    expect(commandInputs[0].ResponseContentDisposition)
      .toBe('attachment; filename="PFX-20260802-A1B2C3.pdf"');
  });

  it('sanitises a filename that could inject header syntax', async () => {
    await r2.getPresignedUrl(URL_FOR(KEY), 3600, {
      disposition: 'attachment', filename: 'a"b\r\nX-Evil: 1.pdf',
    });
    const value = commandInputs[0].ResponseContentDisposition;
    expect(value).not.toContain('\r');
    expect(value).not.toContain('\n');
    expect(value.match(/"/g)).toHaveLength(2); // only the two delimiters
  });

  it('asserts no Content-Type for an extension it does not recognise', async () => {
    await r2.getPresignedUrl(URL_FOR('certs/u/thing.weird'), 3600, { disposition: 'attachment' });
    expect(commandInputs[0].ResponseContentType).toBeUndefined();
    expect(commandInputs[0].ResponseContentDisposition).toContain('attachment');
  });
});
