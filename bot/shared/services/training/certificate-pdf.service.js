/**
 * Teacher Training — Certificate PDF renderer, store and delivery.
 *
 * `training_certificates.pdf_r2_key` shipped as a documented placeholder
 * ("null until PDF generated") that nothing ever wrote. A teacher who passed a
 * level exam got a row and a code — nothing they could hold, print, or hand to
 * a head teacher. This module fills the column in.
 *
 * WHY PDFKIT AND NOT ONE OF THE EXISTING RENDERERS
 * ------------------------------------------------
 * Four renderers already exist in this tree and none of them is the right base
 * for a certificate:
 *
 *   - `coaching/report-v2/hero-report.*` and the MEWAKA/quiz/reading templates
 *     all go through `utils/html-to-pdf` → Playwright. That means a Chromium
 *     launch. Issuance happens INSIDE the WhatsApp grading turn, on the web
 *     dyno and on the portal's Express process; paying a browser boot for a
 *     one-page static document with five fields would be the wrong trade, and
 *     it adds a failure mode (no Chromium in the image) to a path that must
 *     never fail.
 *   - `exam-checker/annotation.service` uses node-canvas — a native module the
 *     root test suite has to stub, and irrelevant here (nothing to composite).
 *   - `pdf-report.service._generatePDFKitReport` is PDFKit, which IS the right
 *     engine, but it is a multi-section scored-observation LAYOUT: header
 *     badge, domain cards, progress bars, per-criterion evidence boxes,
 *     paginated footers. A certificate shares none of that structure.
 *
 * So: reuse the ENGINE and the CONVENTIONS of `pdf-report.service.js` — the
 * chunk-collection stream idiom, the bundled NIETE mark, and above all its
 * hard-won font rule (register Noto Naskh, NOT Nastaliq, whose GPOS anchor
 * tables crash fontkit; and actually CALL `doc.font()` with it, because
 * registering a font and never selecting it is what shipped Latin-1 mojibake
 * for Urdu text) — and write the one-page landscape layout fresh. Reusing the
 * report layout would have meant bending a scorecard into a certificate.
 *
 * FAILURE POLICY
 * --------------
 * Everything here is BEST EFFORT. Every entry point swallows its errors and
 * returns null/false. A `training_certificates` row with a null `pdf_r2_key`
 * is a permanently valid state — it is what all 12k+ existing rows look like —
 * so nothing in this file may ever propagate an error into issuance.
 */

const fs = require('fs');
const path = require('path');
const { logToFile } = require('../../utils/logger');
const branding = require('../../config/branding');

// NIETE palette (brand book): navy-slate + green. Same pair the coaching hero
// report uses for this deployment, so a teacher's certificate and their
// observation report read as one family.
const COLORS = {
  ink: '#333748',      // navy slate — headings, name, rules
  accent: '#47BA7D',   // green — border, seal, divider
  muted: '#6B7280',    // labels and the metadata footer
  paper: '#FFFFFF',
};

// A4 landscape, in points.
const PAGE = { width: 842, height: 595 };
const MARGIN = 40;

/**
 * The R2 object key for a certificate PDF. Shape is prescribed by the schema
 * comment on `training_certificates.pdf_r2_key` — keep them in step.
 * @param {string} userId
 * @param {string} certificateCode
 * @returns {string|null} null when either part is missing (never upload to a
 *   half-formed key — an object at `certs//X.pdf` is unreachable by the row)
 */
function certificatePdfKey(userId, certificateCode) {
  if (!userId || !certificateCode) return null;
  return `certs/${userId}/${certificateCode}.pdf`;
}

/** Arabic-script detection (base, supplement, extended-A, presentation forms). */
const ARABIC_SCRIPT_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function isArabicScript(text) {
  return ARABIC_SCRIPT_RE.test(String(text || ''));
}

/** Format an ISO timestamp as a human issue date; falls back to today. */
function formatIssueDate(issuedAt) {
  const d = issuedAt ? new Date(issuedAt) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return safe.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Render the certificate. Returns a PDF Buffer.
 *
 * Throws on a genuine renderer failure — the callers below are the ones that
 * are required to swallow, so a direct caller (a script, a future backfill)
 * can still see what went wrong.
 *
 * @param {object} p
 * @param {string} p.teacherName
 * @param {string} p.levelName
 * @param {string} [p.vendorName]
 * @param {string} p.certificateCode
 * @param {string} [p.issuedAt] - ISO timestamp
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePdf({ teacherName, levelName, vendorName, certificateCode, issuedAt }) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: [PAGE.width, PAGE.height], margin: MARGIN });

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Naskh, never Nastaliq: Nastaliq's GPOS anchor tables crash fontkit
  // ("Cannot read properties of null (reading 'xCoordinate')"). Naskh renders
  // both Urdu and Arabic legibly. Registered up front, selected per-field.
  let hasArabicFont = false;
  const naskh = path.join(__dirname, '../../fonts/NotoNaskhArabic-Regular.ttf');
  if (fs.existsSync(naskh)) {
    doc.registerFont('CertArabic', naskh);
    hasArabicFont = true;
  }

  const centerW = PAGE.width - MARGIN * 2;
  const centered = { width: centerW, align: 'center' };

  // Double rule frame — outer green, inner hairline.
  doc.lineWidth(3).strokeColor(COLORS.accent)
     .rect(MARGIN * 0.6, MARGIN * 0.6, PAGE.width - MARGIN * 1.2, PAGE.height - MARGIN * 1.2).stroke();
  doc.lineWidth(0.75).strokeColor(COLORS.ink)
     .rect(MARGIN * 0.6 + 7, MARGIN * 0.6 + 7, PAGE.width - MARGIN * 1.2 - 14, PAGE.height - MARGIN * 1.2 - 14).stroke();

  // Organisation mark. Optional by design — a clone without the asset still
  // gets a valid certificate rather than an ENOENT.
  const logo = path.join(__dirname, '../../assets/niete-mark-onlight.png');
  if (fs.existsSync(logo)) {
    try {
      doc.image(logo, PAGE.width / 2 - 21, 78, { width: 42 });
    } catch (err) {
      logToFile('⚠️  Certificate logo skipped', { error: err.message });
    }
  }

  // Issuing organisation — env-driven, never a hardcoded deployment name.
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink)
     .text(String(branding.orgName || '').toUpperCase(), MARGIN, 134, { ...centered, characterSpacing: 3 });

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
     .text('CERTIFICATE OF COMPLETION', MARGIN, 158, { ...centered, characterSpacing: 4 });

  // Short accent rule under the eyebrow.
  doc.lineWidth(2).strokeColor(COLORS.accent)
     .moveTo(PAGE.width / 2 - 34, 182).lineTo(PAGE.width / 2 + 34, 182).stroke();

  doc.font('Helvetica').fontSize(12).fillColor(COLORS.muted)
     .text('This is to certify that', MARGIN, 218, centered);

  // The teacher's name — the one field that can legitimately be non-Latin.
  const nameIsArabic = isArabicScript(teacherName) && hasArabicFont;
  doc.font(nameIsArabic ? 'CertArabic' : 'Helvetica-Bold')
     .fontSize(nameIsArabic ? 30 : 34)
     .fillColor(COLORS.ink)
     .text(String(teacherName || 'Teacher'), MARGIN, nameIsArabic ? 246 : 248, centered);

  doc.lineWidth(0.75).strokeColor(COLORS.ink)
     .moveTo(PAGE.width / 2 - 190, 304).lineTo(PAGE.width / 2 + 190, 304).stroke();

  doc.font('Helvetica').fontSize(12).fillColor(COLORS.muted)
     .text('has successfully completed the training programme', MARGIN, 322, centered);

  const levelIsArabic = isArabicScript(levelName) && hasArabicFont;
  doc.font(levelIsArabic ? 'CertArabic' : 'Helvetica-Bold').fontSize(20).fillColor(COLORS.accent)
     .text(String(levelName || 'Level'), MARGIN, 350, centered);

  if (vendorName) {
    const vendorIsArabic = isArabicScript(vendorName) && hasArabicFont;
    doc.font(vendorIsArabic ? 'CertArabic' : 'Helvetica').fontSize(11).fillColor(COLORS.muted)
       .text(`Content provider: ${vendorName}`, MARGIN, 382, centered);
  }

  // Footer band: issue date left, certificate code right. The code is the
  // verification handle, so it gets monospace-ish treatment and a label.
  const footY = PAGE.height - 130;
  doc.lineWidth(0.5).strokeColor('#D8DCE0')
     .moveTo(MARGIN + 40, footY).lineTo(PAGE.width - MARGIN - 40, footY).stroke();

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
     .text('DATE OF ISSUE', MARGIN + 40, footY + 16, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink)
     .text(formatIssueDate(issuedAt), MARGIN + 40, footY + 30);

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
     .text('CERTIFICATE CODE', PAGE.width - MARGIN - 260, footY + 16, {
       width: 220, align: 'right', characterSpacing: 1.5,
     });
  doc.font('Courier-Bold').fontSize(11).fillColor(COLORS.ink)
     .text(String(certificateCode || ''), PAGE.width - MARGIN - 260, footY + 30, {
       width: 220, align: 'right',
     });

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
     .text('Verify this certificate with the code above.', MARGIN, PAGE.height - 62, centered);

  doc.end();
  return done;
}

/**
 * Best-effort lookup of the content provider behind a level. Its own
 * try/catch: a vendor hiccup must degrade the certificate by one line, not
 * cost the teacher the whole PDF.
 * @returns {Promise<string|null>}
 */
async function resolveVendorName(supabase, levelId) {
  try {
    if (!supabase || levelId === undefined || levelId === null) return null;
    const { data: level } = await supabase
      .from('training_levels').select('id, name, vendor_id').eq('id', levelId).maybeSingle();
    if (!level || !level.vendor_id) return null;
    const { data: vendor } = await supabase
      .from('training_vendors').select('id, name').eq('id', level.vendor_id).maybeSingle();
    return (vendor && vendor.name) || null;
  } catch (err) {
    logToFile('⚠️  Certificate vendor lookup failed', { levelId, error: err.message });
    return null;
  }
}

/**
 * Render → upload → persist. The single entry point issuance calls.
 *
 * Never throws. Returns the stored key, or null if ANY step failed — in which
 * case `pdf_r2_key` stays null, which is a valid certificate.
 *
 * The persist is a standalone UPDATE on the already-inserted row rather than a
 * column on the INSERT: bundling a best-effort value into the critical write
 * means one bad column takes the certificate down with it.
 *
 * @param {object} supabase - caller-injected client (bot or dashboard)
 * @param {object} p - { userId, levelId, certificateCode, teacherName, levelName, issuedAt }
 * @returns {Promise<string|null>} the R2 key, or null
 */
async function generateAndStoreCertificatePdf(supabase, p = {}) {
  const { userId, levelId, certificateCode, teacherName, levelName, issuedAt } = p;
  const key = certificatePdfKey(userId, certificateCode);
  if (!key) {
    logToFile('⚠️  Certificate PDF skipped — no key', { userId, certificateCode });
    return null;
  }

  try {
    const vendorName = await resolveVendorName(supabase, levelId);
    const buffer = await renderCertificatePdf({
      teacherName, levelName, vendorName, certificateCode, issuedAt,
    });

    const { uploadBuffer } = require('../../storage/r2');
    await uploadBuffer(buffer, key, 'application/pdf');

    const { error } = await supabase
      .from('training_certificates')
      .update({ pdf_r2_key: key })
      .eq('certificate_code', certificateCode);
    if (error) {
      // The object IS in R2, but the row cannot point at it. Report null so
      // the caller's view matches the database rather than the bucket.
      logToFile('❌ Certificate PDF stored but key not persisted', {
        certificateCode, key, error: error.message,
      });
      return null;
    }

    logToFile('✅ Certificate PDF generated', { certificateCode, key, bytes: buffer.length });
    return key;
  } catch (err) {
    logToFile('❌ Certificate PDF generation failed (row stands, pdf_r2_key stays null)', {
      certificateCode, userId, error: err.message,
    });
    return null;
  }
}

/**
 * Presigned URL for a stored certificate PDF.
 * @param {string} pdfR2Key
 * @param {number} [expiresIn=3600] seconds
 * @returns {Promise<string|null>}
 */
async function certificatePdfUrl(pdfR2Key, expiresIn = 3600) {
  if (!pdfR2Key) return null;
  try {
    const { buildR2PublicUrl, getPresignedUrl } = require('../../storage/r2');
    return await getPresignedUrl(buildR2PublicUrl(pdfR2Key), expiresIn);
  } catch (err) {
    logToFile('❌ Certificate presign failed', { pdfR2Key, error: err.message });
    return null;
  }
}

/**
 * Send the certificate to the teacher on WhatsApp as a document.
 *
 * No-op (false) when the certificate has no PDF — the congratulation message
 * with the code has already gone out and remains the fallback, so a missing
 * PDF costs the teacher an attachment, not the news.
 *
 * @param {string} phoneNumber
 * @param {object} cert - a training_certificates-shaped object
 * @param {string} [caption]
 * @returns {Promise<boolean>}
 */
async function sendCertificateDocument(phoneNumber, cert, caption) {
  try {
    const key = cert && cert.pdf_r2_key;
    if (!phoneNumber || !key) return false;

    const { buildR2PublicUrl } = require('../../storage/r2');
    const WhatsAppService = require('../whatsapp.service');

    const code = (cert.certificate_code || 'certificate').replace(/[^A-Za-z0-9._-]/g, '_');
    const text = caption || (cert.level_name
      ? `🏆 Your ${cert.level_name} certificate.`
      : '🏆 Your certificate.');

    const ok = await WhatsAppService.sendDocumentFromUrl(
      phoneNumber, buildR2PublicUrl(key), `${code}.pdf`, text,
    );
    return !!ok;
  } catch (err) {
    logToFile('❌ Certificate document delivery failed', {
      certificateCode: cert && cert.certificate_code, error: err.message,
    });
    return false;
  }
}

module.exports = {
  certificatePdfKey,
  renderCertificatePdf,
  generateAndStoreCertificatePdf,
  certificatePdfUrl,
  sendCertificateDocument,
  // exported for tests + any future backfill script
  resolveVendorName,
  formatIssueDate,
  isArabicScript,
};
