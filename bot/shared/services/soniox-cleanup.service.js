/**
 * FEAT-106 (bd-2378) — Soniox storage cleanup.
 *
 * Soniox retains every transcription + file record we create. The account fills
 * up (~2000) and then new uploads fail — every transcription breaks. We already
 * delete the file inline after each transcription, but failed deletes and the
 * transcription JOB records accumulate. This runs on the 15-min stale-session
 * cron to keep the account well under the ceiling.
 *
 * Age-based (NOT the manual script's "keep 5") so a periodic auto-run can never
 * delete an in-flight file: only COMPLETED transcriptions and files older than a
 * safety window are removed; anything recent (or still processing) is left alone.
 */

const axios = require('axios');
const { SONIOX_API_KEY } = require('../utils/constants');
const { logToFile } = require('../utils/logger');

// Anything older than this is safe to delete — transcriptions finish in minutes,
// so a 2-hour window never touches in-flight work.
const CLEANUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const SONIOX_BASE = 'https://api.soniox.com/v1';

/**
 * Pure planner: decide which transcription + file IDs to delete.
 * @param {Array} transcriptions  [{id, status, created_at}]
 * @param {Array} files           [{id, created_at}]
 * @param {number} nowMs
 * @param {number} [maxAgeMs]
 * @returns {{transcriptionIds:string[], fileIds:string[]}}
 */
function planSonioxDeletions(transcriptions, files, nowMs = Date.now(), maxAgeMs = CLEANUP_MAX_AGE_MS) {
  const isOld = (created) => {
    const t = Date.parse(created || '');
    return !Number.isNaN(t) && (nowMs - t) > maxAgeMs;
  };
  const transcriptionIds = (transcriptions || [])
    .filter((t) => t && t.status === 'completed' && isOld(t.created_at))
    .map((t) => t.id);
  const fileIds = (files || [])
    .filter((f) => f && isOld(f.created_at))
    .map((f) => f.id);
  return { transcriptionIds, fileIds };
}

async function _get(pathname) {
  const res = await axios.get(`${SONIOX_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${SONIOX_API_KEY}` },
  });
  return res.data || {};
}

async function _delete(pathname) {
  await axios.delete(`${SONIOX_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${SONIOX_API_KEY}` },
  });
}

/**
 * List Soniox transcriptions + files, delete the old ones. Fully best-effort —
 * a failure here must never break the cron; it just logs and moves on.
 * @returns {Promise<{transcriptionsDeleted:number, filesDeleted:number, skipped?:boolean}>}
 */
async function runSonioxCleanup() {
  if (!SONIOX_API_KEY) {
    logToFile('🧹 Soniox cleanup skipped — no SONIOX_API_KEY');
    return { transcriptionsDeleted: 0, filesDeleted: 0, skipped: true };
  }

  try {
    const [tx, fx] = await Promise.all([
      _get('/transcriptions').catch((e) => { logToFile('⚠️ Soniox list transcriptions failed', { error: e.message }); return {}; }),
      _get('/files').catch((e) => { logToFile('⚠️ Soniox list files failed', { error: e.message }); return {}; }),
    ]);

    const { transcriptionIds, fileIds } = planSonioxDeletions(
      tx.transcriptions || [],
      fx.files || [],
    );

    logToFile('🧹 Soniox cleanup starting', {
      transcriptionsTotal: (tx.transcriptions || []).length,
      filesTotal: (fx.files || []).length,
      toDeleteTranscriptions: transcriptionIds.length,
      toDeleteFiles: fileIds.length,
    });

    let transcriptionsDeleted = 0;
    for (const id of transcriptionIds) {
      try { await _delete(`/transcriptions/${id}`); transcriptionsDeleted += 1; }
      catch (e) { logToFile('⚠️ Soniox delete transcription failed', { id, error: e.message }); }
    }
    let filesDeleted = 0;
    for (const id of fileIds) {
      try { await _delete(`/files/${id}`); filesDeleted += 1; }
      catch (e) { logToFile('⚠️ Soniox delete file failed', { id, error: e.message }); }
    }

    logToFile('✅ Soniox cleanup complete', { transcriptionsDeleted, filesDeleted });
    return { transcriptionsDeleted, filesDeleted };
  } catch (error) {
    logToFile('❌ Soniox cleanup errored (non-fatal)', { error: error.message });
    return { transcriptionsDeleted: 0, filesDeleted: 0 };
  }
}

module.exports = { planSonioxDeletions, runSonioxCleanup, CLEANUP_MAX_AGE_MS };
