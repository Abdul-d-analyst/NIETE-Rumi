/**
 * Kie.ai prompt builder — page-1/page-2 prompt assembly + the OSS coaching-number
 * sanitization (env-driven, omitted when unset; no PK/TZ phone literals ever).
 */

let Builder;
function load() {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  Builder = require('../../bot/shared/services/pic-to-lp/kieai-prompt-builder.service');
}

const base = { grade: 5, subject: 'Math', topic: 'Fractions', ocrText: '' };

const BANNED = ['+255', '677 095', '0329', '5012345', '92 329'];

afterEach(() => {
  delete process.env.COACHING_WHATSAPP_NUMBER;
  jest.resetModules();
});

describe('buildPage1Prompt', () => {
  it("English page 1 contains the topic + 'Big Idea'", () => {
    load();
    const out = Builder.buildPage1Prompt({ ...base, language: 'en' });
    expect(out).toContain('Fractions');
    expect(out).toContain('Big Idea');
  });

  it('Urdu page 1 contains the Nastaliq directive', () => {
    load();
    const out = Builder.buildPage1Prompt({ ...base, language: 'ur' });
    expect(out).toContain('Noto Nastaliq Urdu');
  });

  it('never emits a banned PK/TZ phone literal', () => {
    load();
    const out = Builder.buildPage1Prompt({ ...base, language: 'en' });
    BANNED.forEach((b) => expect(out).not.toContain(b));
  });
});

describe('IMAGE 1 brand-mark description — NIETE "N", not the Rumi smile (bd-2365/OPS-114)', () => {
  // The rename relabelled the brand mark "Rumi"→"NIETE" but left the Rumi
  // *geometry* ("white smile-only mark, curved line + two cheek dots") and the
  // page-template "white smile brand mark" literals. Those describe Rumi's mark,
  // not NIETE's green "N" monogram — a text-says-NIETE/picture-says-Rumi split
  // that pushes the image model to render the wrong shape. Guard every page prompt.
  const pages = ['buildPage1Prompt', 'buildPage2Prompt'];
  const langs = ['en', 'ur'];

  it('no page prompt describes the Rumi smile geometry', () => {
    load();
    for (const fn of pages) {
      for (const language of langs) {
        const out = Builder[fn]({ ...base, language });
        expect(out).not.toMatch(/smile/i);
        expect(out).not.toMatch(/cheek/i);
      }
    }
  });

  it('the IMAGE 1 role line names the NIETE "N" mark', () => {
    load();
    const out = Builder.buildPage1Prompt({ ...base, language: 'en' });
    expect(out).toContain('NIETE brand mark');
    expect(out).toMatch(/monogram|letter ["']?N["']?|"N"/);
  });
});

describe('buildPage2Prompt coaching corner — env-driven contact line', () => {
  it('omits the "WhatsApp NIETE ·" contact line when COACHING_WHATSAPP_NUMBER is unset', () => {
    delete process.env.COACHING_WHATSAPP_NUMBER;
    load();
    const en = Builder.buildPage2Prompt({ ...base, language: 'en' });
    const ur = Builder.buildPage2Prompt({ ...base, language: 'ur' });
    expect(en).toContain('Coaching Corner');           // corner itself kept
    expect(en).not.toContain('WhatsApp NIETE ·');        // contact line omitted
    expect(ur).not.toContain('WhatsApp NIETE ·');
  });

  it('includes the contact line with the configured number when set', () => {
    process.env.COACHING_WHATSAPP_NUMBER = '+1 555 0100';
    load();
    const en = Builder.buildPage2Prompt({ ...base, language: 'en' });
    const ur = Builder.buildPage2Prompt({ ...base, language: 'ur' });
    expect(en).toContain('WhatsApp NIETE · +1 555 0100');
    expect(ur).toContain('WhatsApp NIETE · +1 555 0100');
  });

  it('never emits a banned PK/TZ phone literal (set or unset)', () => {
    process.env.COACHING_WHATSAPP_NUMBER = '+1 555 0100';
    load();
    const out = Builder.buildPage2Prompt({ ...base, language: 'en' });
    BANNED.forEach((b) => expect(out).not.toContain(b));
  });
});

describe('coachingNumberFor', () => {
  it('returns the env value and ignores the region arg', () => {
    process.env.COACHING_WHATSAPP_NUMBER = '+1 555 0100';
    load();
    expect(Builder.coachingNumberFor('PK')).toBe('+1 555 0100');
    expect(Builder.coachingNumberFor('TZ')).toBe('+1 555 0100');
  });

  it("returns '' when unset", () => {
    delete process.env.COACHING_WHATSAPP_NUMBER;
    load();
    expect(Builder.coachingNumberFor('PK')).toBe('');
  });
});
