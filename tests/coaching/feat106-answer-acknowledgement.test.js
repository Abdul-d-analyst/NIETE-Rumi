/**
 * FEAT-106 #4a (bd-2374) — reflective answer acknowledgement.
 *
 * After her single reflective answer, the flow jumped straight to a generic
 * "Thank you for your thoughtful reflections 🙏" and the report — nothing
 * reflected back what she actually said, so it felt like the bot ignored her
 * (Hareem, Irum; ICT, DC-6/DC-7).
 *
 * generateAcknowledgement() produces ONE short warm line that names what she
 * said, or null (so the caller falls back to the generic thanks). The prompt
 * builder is pure; generation is tested with an injected generator so no live
 * LLM is needed.
 */

const fs = require('fs');
const path = require('path');
const {
  buildAcknowledgementPrompt,
  generateAcknowledgement,
} = require('../../bot/shared/services/coaching/reflective-acknowledgement');

describe('FEAT-106 #4a — buildAcknowledgementPrompt', () => {
  it('includes her answer, the question, and the target language', () => {
    const p = buildAcknowledgementPrompt('I waited longer after asking', 'What were you noticing?', 'Urdu');
    expect(p).toContain('I waited longer after asking');
    expect(p).toContain('What were you noticing?');
    expect(p).toContain('Urdu');
  });

  it('instructs gender-neutral + no new question', () => {
    const p = buildAcknowledgementPrompt('ans', 'q', 'English');
    expect(p.toLowerCase()).toMatch(/gender-neutral/);
    expect(p.toLowerCase()).toMatch(/not ask/);
  });
});

describe('FEAT-106 #4a — generateAcknowledgement', () => {
  it('returns the generated line (trimmed, unquoted) on success', async () => {
    const generator = async () => '  "You gave the class more time to think today."  ';
    const out = await generateAcknowledgement('gave more wait time', 'q', 'en', { generator, langName: 'English' });
    expect(out).toBe('You gave the class more time to think today.');
  });

  it('returns null when the generator throws (caller falls back to generic thanks)', async () => {
    const generator = async () => { throw new Error('LLM down'); };
    const out = await generateAcknowledgement('some answer', 'q', 'en', { generator, langName: 'English' });
    expect(out).toBeNull();
  });

  it('returns null for an empty / too-short answer (nothing to reflect back)', async () => {
    const generator = async () => 'should not be called';
    expect(await generateAcknowledgement('', 'q', 'en', { generator })).toBeNull();
    expect(await generateAcknowledgement('.', 'q', 'en', { generator })).toBeNull();
  });

  it('returns null when the generator yields an empty string', async () => {
    const generator = async () => '   ';
    expect(await generateAcknowledgement('a real answer', 'q', 'en', { generator })).toBeNull();
  });
});

describe('FEAT-106 #4a — wiring (source guard)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/coaching/reflective-conversation.service.js'),
    'utf8',
  );
  it('the reflective flow calls generateAcknowledgement before the generic thanks', () => {
    expect(src).toMatch(/generateAcknowledgement\s*\(/);
    const ackIdx = src.indexOf('generateAcknowledgement(');
    const thanksIdx = src.indexOf("getCoachingMessage('reflectionsThanks'");
    expect(ackIdx).toBeGreaterThan(-1);
    expect(thanksIdx).toBeGreaterThan(ackIdx); // ack precedes the thanks
  });
});
