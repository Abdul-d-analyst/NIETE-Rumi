/**
 * FEAT-106 #1 (bd-2377) — Whisper chunk planner.
 *
 * OpenAI Whisper caps uploads at 25MB. The transcription cascade uses Whisper as
 * the LAST resort after Soniox v-primary and v-backup both fail. On 2026-07-23,
 * when Soniox 429'd, a 936-second classroom recording (≫ 25MB) hit that last
 * resort and threw "Audio file too large" — the whole session failed with no
 * safety net. Splitting the audio into sub-cap chunks and transcribing each in
 * turn gives the fallback a real chance to catch a long recording.
 *
 * This module is the PURE planner: from file size + duration it returns the time
 * segments to cut. The ffmpeg cut + per-chunk Whisper calls live in
 * audio.service.js (thin wrapper around this).
 */

// Stay comfortably under OpenAI's 25MB hard limit (headers + container overhead).
const WHISPER_UPLOAD_CAP_BYTES = 24 * 1024 * 1024;

/**
 * @param {number} fileSizeBytes total audio size
 * @param {number} durationSec   total audio duration in seconds
 * @param {number} [capBytes]    per-chunk byte cap
 * @returns {Array<{startSec:number, durationSec:number, single?:boolean}>}
 *   one entry per chunk; a single {single:true} entry means "upload as-is".
 */
function planWhisperChunks(fileSizeBytes, durationSec, capBytes = WHISPER_UPLOAD_CAP_BYTES) {
  // Can't plan without both dimensions, or already under the cap → single upload.
  if (!(fileSizeBytes > 0) || !(durationSec > 0) || fileSizeBytes <= capBytes) {
    return [{ startSec: 0, durationSec: durationSec > 0 ? durationSec : 0, single: true }];
  }

  // Enough chunks that each chunk's proportional byte size is under the cap.
  const numChunks = Math.ceil(fileSizeBytes / capBytes);
  const segLen = durationSec / numChunks;

  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const startSec = Math.floor(i * segLen);
    // Last chunk runs to the end (absorb rounding); others use the ceil segment.
    const isLast = i === numChunks - 1;
    const durationSecChunk = isLast ? Math.max(0, durationSec - startSec) : Math.ceil(segLen);
    chunks.push({ startSec, durationSec: durationSecChunk });
  }
  return chunks;
}

module.exports = { planWhisperChunks, WHISPER_UPLOAD_CAP_BYTES };
