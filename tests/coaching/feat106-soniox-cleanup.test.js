/**
 * FEAT-106 (bd-2378) — Soniox storage cleanup.
 *
 * The Soniox account accumulates transcription + file records; once it fills up
 * (~2000) new uploads fail and every transcription breaks. The manual
 * cleanup-soniox.js in the main bot keeps only the 5 most recent — unsafe for a
 * periodic auto-run (it can delete a file whose transcription is still in
 * flight). planSonioxDeletions() is age-based instead: it deletes COMPLETED
 * transcriptions and files older than a safety window, leaving anything recent
 * (and any in-flight work) untouched.
 */

const { planSonioxDeletions, CLEANUP_MAX_AGE_MS } = require('../../bot/shared/services/soniox-cleanup.service');

const NOW = 1_700_000_000_000;
const iso = (ms) => new Date(ms).toISOString();
const old = iso(NOW - CLEANUP_MAX_AGE_MS - 60_000);
const recent = iso(NOW - 60_000);

describe('FEAT-106 — planSonioxDeletions', () => {
  it('deletes completed transcriptions older than the window', () => {
    const { transcriptionIds } = planSonioxDeletions(
      [{ id: 't-old', status: 'completed', created_at: old },
       { id: 't-recent', status: 'completed', created_at: recent }],
      [], NOW,
    );
    expect(transcriptionIds).toEqual(['t-old']);
  });

  it('does NOT delete an in-flight (not-completed) transcription even if old', () => {
    const { transcriptionIds } = planSonioxDeletions(
      [{ id: 't-running', status: 'processing', created_at: old }], [], NOW,
    );
    expect(transcriptionIds).toEqual([]);
  });

  it('deletes files older than the window, keeps recent files', () => {
    const { fileIds } = planSonioxDeletions(
      [],
      [{ id: 'f-old', created_at: old }, { id: 'f-recent', created_at: recent }],
      NOW,
    );
    expect(fileIds).toEqual(['f-old']);
  });

  it('handles empty inputs', () => {
    expect(planSonioxDeletions([], [], NOW)).toEqual({ transcriptionIds: [], fileIds: [] });
    expect(planSonioxDeletions(null, null, NOW)).toEqual({ transcriptionIds: [], fileIds: [] });
  });

  it('skips items with an unparseable timestamp (do not risk deleting in-flight work)', () => {
    const { fileIds } = planSonioxDeletions([], [{ id: 'f-bad', created_at: null }], NOW);
    expect(fileIds).toEqual([]);
  });
});
