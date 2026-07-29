/**
 * FEAT-106 #4b (bd-2375) — Urdu TTS runtime discipline for the Sara voice.
 *
 * NIETE's Urdu coaching voice moves from Uplift's "Info/Education" voice to the
 * canonical Sara / eleven_v3 ("Warm Storyteller — Urdu & Hindi"). Sara's hard-won
 * rules (lp-voicenotes V20): inline bare digits render as gibberish ("alaran") —
 * spell them as English number words; Markdown emphasis is read literally
 * ("asterisk asterisk") — strip it. This is the runtime safety net that enforces
 * both before the text hits ElevenLabs.
 */

const { normalizeForUrduTTS } = require('../../bot/shared/services/urdu-tts-normalizer');

describe('FEAT-106 #4b — normalizeForUrduTTS', () => {
  it('spells inline digits as English number words', () => {
    expect(normalizeForUrduTTS('اگلی کلاس میں 3 سوال پوچھیں۔')).toContain('three');
    expect(normalizeForUrduTTS('Step 1/5')).toBe('Step one/five');
    expect(normalizeForUrduTTS('43 اور 8')).toContain('forty-three');
    expect(normalizeForUrduTTS('43 اور 8')).toContain('eight');
  });

  it('leaves large numbers (>99) as digits', () => {
    expect(normalizeForUrduTTS('year 2026')).toContain('2026');
  });

  it('strips Markdown emphasis so the voice does not read the markers', () => {
    expect(normalizeForUrduTTS('**Long Lesson** detected')).toBe('Long Lesson detected');
    expect(normalizeForUrduTTS('_important_ point')).toBe('important point');
    expect(normalizeForUrduTTS('a *quick* note')).toBe('a quick note');
  });

  it('handles empty / null safely', () => {
    expect(normalizeForUrduTTS('')).toBe('');
    expect(normalizeForUrduTTS(null)).toBe(null);
  });

  it('leaves clean Urdu+English text untouched', () => {
    const clean = 'اگلی کلاس میں open-ended questions پوچھیں۔';
    expect(normalizeForUrduTTS(clean)).toBe(clean);
  });
});
