/**
 * bd-2381 / OPS-114: env-driven branding defaults must resolve to NIETE, not Rumi.
 *
 * The hardcoded self-references were already renamed (bd-2365, ecf8ccc). But three
 * branding surfaces are ENV-DRIVEN and still defaulted to "Rumi":
 *   - branding.botName            (BOT_NAME || 'Rumi')
 *   - branding.orgName            (ORG_NAME || 'Rumi Education')
 *   - region-config DEFAULT_COACH_ROLE_LABEL (|| 'Rumi Digital Coach')
 * DEFAULT_COACH_ROLE_LABEL is the one that leaks to teachers today — it renders as
 * the observerName on every coaching-report footer / coaching card / LP-selection
 * footer. This fork cannot set the Railway env var (read-only token, 403 on
 * variableUpsert), so — exactly like RUMI_LOGO_R2_KEY (bd-2374) — the CODE DEFAULT
 * is the operative config and must be NIETE.
 *
 * TDD: written red-first (defaults were 'Rumi*' when this was authored).
 */

jest.mock('dotenv', () => ({ config: jest.fn() }), { virtual: true });

const BRAND_ENV = ['BOT_NAME', 'ORG_NAME', 'DEFAULT_COACH_ROLE_LABEL'];

describe('env-driven branding defaults are NIETE, never Rumi (bd-2381)', () => {
  let saved;
  beforeEach(() => {
    saved = {};
    for (const k of BRAND_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    jest.resetModules();
  });
  afterEach(() => {
    for (const k of BRAND_ENV) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    jest.resetModules();
  });

  test('branding.botName defaults to "NIETE Teaching Assistant"', () => {
    const branding = require('../../bot/shared/config/branding');
    expect(branding.botName).toBe('NIETE Teaching Assistant');
    expect(branding.botName).not.toMatch(/rumi/i);
  });

  test('branding.orgName defaults to "NIETE"', () => {
    const branding = require('../../bot/shared/config/branding');
    expect(branding.orgName).toBe('NIETE');
    expect(branding.orgName).not.toMatch(/rumi/i);
  });

  test('coach-role label defaults to "NIETE Digital Coach" (teacher-facing report footer)', () => {
    const rc = require('../../bot/shared/config/region-config');
    expect(rc.DEFAULT_COACH_ROLE_LABEL).toBe('NIETE Digital Coach');
    expect(rc.coachRoleLabelForRegion('')).toBe('NIETE Digital Coach');
    expect(rc.coachRoleLabelForRegion('ict')).not.toMatch(/rumi/i);
  });

  test('all three stay overridable via their env vars', () => {
    process.env.BOT_NAME = 'X Bot';
    process.env.ORG_NAME = 'X Org';
    process.env.DEFAULT_COACH_ROLE_LABEL = 'X Coach';
    const branding = require('../../bot/shared/config/branding');
    const rc = require('../../bot/shared/config/region-config');
    expect(branding.botName).toBe('X Bot');
    expect(branding.orgName).toBe('X Org');
    expect(rc.DEFAULT_COACH_ROLE_LABEL).toBe('X Coach');
  });

  test('welcome messages carry the NIETE name (not Rumi) in every shipped language', () => {
    const branding = require('../../bot/shared/config/branding');
    for (const lang of ['en', 'ur', 'ar', 'es']) {
      const msg = branding.getWelcomeMessage(lang);
      expect(msg).toContain('NIETE');
      expect(msg).not.toMatch(/rumi/i);
    }
  });
});
