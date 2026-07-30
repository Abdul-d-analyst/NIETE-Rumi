/**
 * FEAT-106 #1 (bd-2377) — Whisper last-resort must handle >25MB audio.
 *
 * The transcription cascade is Soniox → Soniox → Whisper. Whisper caps uploads
 * at 25MB, so on 2026-07-23 when Soniox 429'd, a long classroom recording
 * (936s ≫ 25MB) had NO working last resort — the whole session failed. Chunking
 * the audio under the Whisper cap gives the fallback a real safety net.
 *
 * planWhisperChunks() is the pure planner: given file size + duration it returns
 * the time segments to split into so each chunk lands under the cap. (The ffmpeg
 * split itself is a thin wrapper, not unit-tested here.)
 */

const { planWhisperChunks, WHISPER_UPLOAD_CAP_BYTES } = require('../../bot/shared/services/whisper-chunk-planner');

const MB = 1024 * 1024;

describe('FEAT-106 #1 — planWhisperChunks', () => {
  it('returns a single chunk when the file is under the cap', () => {
    const plan = planWhisperChunks(10 * MB, 600);
    expect(plan).toHaveLength(1);
    expect(plan[0].single).toBe(true);
  });

  it('returns a single chunk exactly at the cap', () => {
    const plan = planWhisperChunks(WHISPER_UPLOAD_CAP_BYTES, 600);
    expect(plan).toHaveLength(1);
  });

  it('splits a 40MB / 600s recording into enough chunks to fit under the cap', () => {
    const plan = planWhisperChunks(40 * MB, 600);
    expect(plan.length).toBeGreaterThanOrEqual(2);
    // every chunk's estimated bytes must be under the cap
    const bytesPerSec = (40 * MB) / 600;
    for (const c of plan) {
      expect(c.durationSec * bytesPerSec).toBeLessThanOrEqual(WHISPER_UPLOAD_CAP_BYTES);
    }
  });

  it('covers the whole duration (chunks span start→end)', () => {
    const plan = planWhisperChunks(100 * MB, 1000);
    expect(plan[0].startSec).toBe(0);
    const last = plan[plan.length - 1];
    expect(last.startSec + last.durationSec).toBeGreaterThanOrEqual(1000);
  });

  it('falls back to a single chunk when duration is unknown (cannot plan)', () => {
    const plan = planWhisperChunks(40 * MB, 0);
    expect(plan).toHaveLength(1);
    expect(plan[0].single).toBe(true);
  });
});
