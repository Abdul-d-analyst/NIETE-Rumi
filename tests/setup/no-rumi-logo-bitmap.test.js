/**
 * Bot self-LOGO (bitmap) hygiene guard (bd-2368 / OPS-114).
 *
 * Companion to `no-hardcoded-bot-name.test.js`. That guard keeps the bot's
 * self-NAME text (menu greeting, LLM identity prompts, footers) off the literal
 * "Rumi". This guard keeps the self-LOGO IMAGE off the Rumi brand bitmap on the
 * teacher-facing renders — the reports and cards a teacher actually receives.
 *
 * Why it exists: renaming the text while the report header still shows the Rumi
 * mark is the exact "text says NIETE, picture says Rumi" inconsistency the RM
 * feedback (OPS-114) is trying to kill. The logo lives in a handful of render
 * surfaces that base64-embed (or ffmpeg-overlay) a PNG; each must point at the
 * NIETE mark, never the Rumi bitmap.
 *
 * Scope: the teacher-facing render surfaces only. The forked default mark is the
 * official NIETE icon extracted from niete.edu.pk, staged in `bot/shared/assets/`
 * as `niete-mark-onlight.png` (charcoal J — visible on WHITE report backgrounds)
 * and `niete-mark-ondark.png` (off-white J — visible on the NAVY coaching band /
 * over video). Dead templates and the R2/LOGO_URL env-driven LP-header path are
 * out of scope (the latter is deploy-time config, not a repo asset).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// The teacher-facing render surfaces that embed the header/footer/watermark logo.
const SURFACES = [
  'bot/shared/templates/reading-report.template.js',
  'bot/shared/templates/quiz-report.template.js',
  'bot/shared/services/coaching/report-v2/hero-report.template.js',
  'bot/shared/services/observe/observe-coach-card.js',
  'bot/shared/services/coaching/coaching-card/card-template.js',
  'bot/shared/services/pdf-report.service.js',
  'bot/shared/services/video/video-watermark.service.js',
].map((p) => path.join(ROOT, p));

// The Rumi brand bitmaps that must NOT be referenced by any surface above.
const FORBIDDEN_ASSET_RE = /Rumi Transparent\.png|rumi-mark-white\.png|rumi-mark-navy\.png|rumi-watermark-logo\.png/i;

// The NIETE marks the fork ships instead — both must exist on disk.
const NIETE_MARKS = [
  'bot/shared/assets/niete-mark-onlight.png',
  'bot/shared/assets/niete-mark-ondark.png',
].map((p) => path.join(ROOT, p));

describe('Bot self-logo hygiene — no Rumi bitmap on teacher-facing renders', () => {
  it('no render surface references a Rumi brand bitmap', () => {
    const violations = [];
    for (const filePath of SURFACES) {
      const rel = path.relative(ROOT, filePath);
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN_ASSET_RE.test(line)) {
          violations.push(`${rel}:${i + 1} — Rumi logo bitmap — ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('the NIETE mark assets the surfaces point at exist on disk', () => {
    const missing = NIETE_MARKS.filter((p) => !fs.existsSync(p)).map((p) => path.relative(ROOT, p));
    expect(missing).toEqual([]);
  });
});
