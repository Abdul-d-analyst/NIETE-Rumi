/**
 * `/certificate <CODE>` on WhatsApp — the same fetch-or-mint the portal uses.
 *
 * A teacher who asks for an old certificate in chat must get the actual file,
 * not just its code. That means the legacy certificates (12,952 of them, all
 * with pdf_r2_key null) mint on a chat request exactly as they do on a portal
 * download — ONE implementation, both surfaces, so the two can never disagree
 * about what a teacher may have or what the file contains.
 *
 * The command parsing and the delivery are exported as functions rather than
 * inlined in text-message.handler.js: that handler drags in ~40 services and
 * cannot be booted in a test, so anything hidden inside it is untestable. Only
 * the two-line dispatch stays in the handler.
 */

let svc;
let sends;
let fetchOrMint;

beforeEach(() => {
  jest.resetModules();
  sends = [];

  jest.doMock('pdfkit', () => jest.fn(), { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    uploadBuffer: jest.fn(),
    buildR2PublicUrl: (k) => `https://r2.example.com/bucket/${k}`,
    getPresignedUrl: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendDocumentFromUrl: jest.fn(async (to, url, filename, caption) => {
      sends.push({ to, url, filename, caption });
      return true;
    }),
    sendMessage: jest.fn().mockResolvedValue(true),
  }));

  svc = require('../../bot/shared/services/training/certificate-pdf.service');
  fetchOrMint = jest.spyOn(svc, 'fetchOrMintCertificatePdf');
});

afterEach(() => jest.restoreAllMocks());

describe('parseCertificateCommand', () => {
  it('recognises the bare list command', () => {
    expect(svc.parseCertificateCommand('/certificates')).toEqual({ code: null });
    expect(svc.parseCertificateCommand('/certificate')).toEqual({ code: null });
    expect(svc.parseCertificateCommand('  /CERTIFICATES  ')).toEqual({ code: null });
  });

  it('extracts a certificate code', () => {
    expect(svc.parseCertificateCommand('/certificate PFX-20260802-A1B2C3'))
      .toEqual({ code: 'PFX-20260802-A1B2C3' });
    expect(svc.parseCertificateCommand('/certificates pfx-20260802-a1b2c3'))
      .toEqual({ code: 'PFX-20260802-A1B2C3' });   // codes are uppercase
  });

  it('is not a certificate command at all for anything else', () => {
    expect(svc.parseCertificateCommand('/training')).toBeNull();
    expect(svc.parseCertificateCommand('my certificate please')).toBeNull();
    expect(svc.parseCertificateCommand('')).toBeNull();
    expect(svc.parseCertificateCommand(null)).toBeNull();
  });

  it('ignores a junk argument rather than treating it as a code', () => {
    // A code is <PREFIX>-<8 digits>-<alnum>; anything else is the teacher
    // talking, and must fall back to the list instead of a "not found".
    expect(svc.parseCertificateCommand('/certificate please')).toEqual({ code: null });
    expect(svc.parseCertificateCommand('/certificates for level 2')).toEqual({ code: null });
  });
});

describe('deliverCertificateByCode', () => {
  const USER = 'user-abc';
  const PHONE = '923001234567';
  const CODE = 'PFX-20260802-A1B2C3';

  it('mints if needed and sends the PDF as a WhatsApp document', async () => {
    fetchOrMint.mockResolvedValue({
      certificate_code: CODE,
      level_name: 'Aspiring Teacher',
      pdf_r2_key: `certs/${USER}/${CODE}.pdf`,
      download_url: 'https://r2/signed',
      minted: true,
    });

    const out = await svc.deliverCertificateByCode({}, { userId: USER, phoneNumber: PHONE, certificateCode: CODE });

    expect(out.ok).toBe(true);
    expect(out.minted).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toBe(PHONE);
    expect(sends[0].filename).toBe(`${CODE}.pdf`);
  });

  it('uses the SAME fetch-or-mint the portal goes through', async () => {
    fetchOrMint.mockResolvedValue({
      certificate_code: CODE, level_name: 'L', pdf_r2_key: 'k', download_url: 'u', minted: false,
    });
    await svc.deliverCertificateByCode({}, { userId: USER, phoneNumber: PHONE, certificateCode: CODE });
    expect(fetchOrMint).toHaveBeenCalledWith({}, { userId: USER, certificateCode: CODE });
  });

  it('reports not_found without sending anything', async () => {
    fetchOrMint.mockRejectedValue(Object.assign(new Error('nope'), { code: 'not_found' }));
    const out = await svc.deliverCertificateByCode({}, { userId: USER, phoneNumber: PHONE, certificateCode: 'NOPE' });
    expect(out).toEqual({ ok: false, reason: 'not_found' });
    expect(sends).toHaveLength(0);
  });

  it('reports mint_failed without sending anything', async () => {
    fetchOrMint.mockRejectedValue(Object.assign(new Error('boom'), { code: 'mint_failed' }));
    const out = await svc.deliverCertificateByCode({}, { userId: USER, phoneNumber: PHONE, certificateCode: CODE });
    expect(out).toEqual({ ok: false, reason: 'mint_failed' });
    expect(sends).toHaveLength(0);
  });

  it('never throws, whatever goes wrong', async () => {
    fetchOrMint.mockRejectedValue(new Error('something unexpected'));
    await expect(
      svc.deliverCertificateByCode({}, { userId: USER, phoneNumber: PHONE, certificateCode: CODE }),
    ).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('reports a send failure rather than claiming success', async () => {
    fetchOrMint.mockResolvedValue({
      certificate_code: CODE, level_name: 'L', pdf_r2_key: 'k', download_url: 'u', minted: false,
    });
    const wa = require('../../bot/shared/services/whatsapp.service');
    wa.sendDocumentFromUrl.mockResolvedValueOnce(false);

    const out = await svc.deliverCertificateByCode({}, { userId: USER, phoneNumber: PHONE, certificateCode: CODE });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('send_failed');
  });
});

describe('the handler dispatches to these functions', () => {
  const fs = require('fs');
  const path = require('path');

  it('text-message.handler.js routes /certificate through the shared service', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8',
    );
    expect(src).toContain('parseCertificateCommand');
    expect(src).toContain('deliverCertificateByCode');
  });
});
