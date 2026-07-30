/**
 * bd-2405 — teacher-facing observe copy leaks Kiswahili on NIETE.
 *
 * Two grounded defects (evidence img-014: a NIETE coach's teacher got a full
 * Kiswahili report — "Kutoka kwa Asad", "Ahadi yako", "Tunajivunia kazi yako.
 * Tuko pamoja", "Ripoti yako ya somo… uchunguzi wa Asad"):
 *
 *   1. observe-send.service.js hardcoded `observeStrings('sw')` for the
 *      teacher copy (D6, a Tanzania-era assumption) — so EVERY market's
 *      teacher got Swahili.
 *   2. The `en` string set itself leaked "Tuko pamoja" (Swahili) in
 *      companion_closing.
 *
 * Rule 20: language is market-scoped. NIETE (fico) offers ur/en and must
 * NEVER resolve to sw; Tanzania (mewaka) stays sw.
 *
 * RED-FIRST: both assertions fail against current code.
 * Created: 2026-07-30
 */

// Mock supabase so resolveTeacherLang's teacher-phone lookup is controllable.
let mockTeacherRow = null;
jest.mock('../../shared/config/supabase', () => {
  const chain = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: mockTeacherRow, error: null })),
    single: jest.fn(async () => ({ data: mockTeacherRow, error: null })),
  };
  return chain;
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { observeStrings } = require('../../shared/services/observe/observe-strings');

const SWAHILI_TOKENS = ['Tuko pamoja', 'Asante', 'Ripoti', 'Ahadi yako', 'Kutoka kwa', 'uchunguzi'];

describe('bd-2405 · observe language market-scope', () => {
  afterEach(() => { delete process.env.OBSERVE_FRAMEWORK; mockTeacherRow = null; });

  it('the English string set contains no Kiswahili leak', () => {
    const en = observeStrings('en');
    for (const [key, val] of Object.entries(en)) {
      if (typeof val !== 'string') continue;
      for (const tok of SWAHILI_TOKENS) {
        expect(`${key}=${val}`).not.toContain(tok);
      }
    }
  });

  it('the Urdu string set contains no Kiswahili leak', () => {
    const ur = observeStrings('ur');
    for (const [key, val] of Object.entries(ur)) {
      if (typeof val !== 'string') continue;
      for (const tok of SWAHILI_TOKENS) {
        expect(`${key}=${val}`).not.toContain(tok);
      }
    }
  });

  describe('resolveTeacherLang (market-scoped)', () => {
    let resolveTeacherLang;
    beforeEach(() => {
      jest.resetModules();
      resolveTeacherLang = require('../../shared/services/observe/observe-send.service').resolveTeacherLang;
    });

    it('NIETE (fico) never resolves the teacher copy to sw — clamps a stray sw coach lang to a market language', async () => {
      process.env.OBSERVE_FRAMEWORK = 'fico';
      mockTeacherRow = null; // teacher not registered
      const lang = await resolveTeacherLang({ teacher_phone: '923001234567' }, 'sw');
      expect(['ur', 'en']).toContain(lang);
      expect(lang).not.toBe('sw');
    });

    it('NIETE (fico) follows the teacher\'s own Urdu preference when registered', async () => {
      process.env.OBSERVE_FRAMEWORK = 'fico';
      mockTeacherRow = { preferred_language: 'ur' };
      const lang = await resolveTeacherLang({ teacher_phone: '923001234567' }, 'en');
      expect(lang).toBe('ur');
    });

    it('Tanzania (mewaka) still resolves the teacher copy to sw', async () => {
      process.env.OBSERVE_FRAMEWORK = 'mewaka';
      mockTeacherRow = null;
      const lang = await resolveTeacherLang({ teacher_phone: '255700000000' }, 'sw');
      expect(lang).toBe('sw');
    });
  });
});
