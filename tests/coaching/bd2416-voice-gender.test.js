/**
 * bd-2416 (FEAT-106 row 14) — the voice debrief said "kar raha hoon" (male)
 * though Rumi's voice (Sara) is female. Rumi's OWN first-person self-reference
 * must be female Urdu; text ABOUT the teacher stays gender-neutral (the teacher
 * may be a man or a woman).
 *
 * summarizeForVoiceDebrief's prompt must encode both rules (source guard — the
 * prompt is an LLM instruction, not unit-testable output).
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/services/gpt5-mini.service.js'),
  'utf8',
);
// Isolate the summarizeForVoiceDebrief method body.
const start = src.indexOf('summarizeForVoiceDebrief');
const body = src.slice(start, start + 3000);

describe('bd-2416 — voice debrief gender rules', () => {
  it("instructs FEMALE first-person for Rumi's own voice (کر رہی ہوں, not کر رہا ہوں)", () => {
    expect(body).toMatch(/کر رہی ہوں/);
    expect(body.toLowerCase()).toMatch(/female/);
  });

  it('instructs gender-neutral phrasing when referring to the teacher', () => {
    expect(body.toLowerCase()).toMatch(/gender-neutral|gender neutral/);
    expect(body.toLowerCase()).toMatch(/teacher/);
  });
});
