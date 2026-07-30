/**
 * bd-2417 (FEAT-106 row 13) — recovery for coaching sessions stuck at the
 * confirmation gate.
 *
 * A long classroom recording sets status='initiated' / AWAITING_CONFIRMATION and
 * sends a "Yes, Analyze" button. If the teacher never taps it (Sidra sent a
 * 16-min recording and waited 2h), the session froze forever — NIETE has no cron
 * to sweep it, and follow-ups got misleading "still analyzing" replies.
 *
 * This pure planner decides the action; the worker executes it (queue
 * transcription to proceed, or mark abandoned). Kept dependency-free so it is
 * unit-testable in isolation.
 */

// Grace window before we act — the teacher may still tap "Yes, Analyze".
const STUCK_INITIATED_MIN_AGE_MS = 30 * 60 * 1000; // 30 minutes
// WhatsApp retains uploaded media ~30 days; past this the media id is dead, so
// we can't transcribe — mark abandoned instead of failing at download.
const STUCK_INITIATED_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000; // 25 days

/**
 * @param {{status:string, created_at:string, audio_id?:string}} session
 * @param {number} nowMs
 * @returns {{action:'skip'|'auto_confirm'|'abandon', reason?:string}}
 */
function classifyStuckInitiatedSession(session, nowMs = Date.now()) {
  const created = Date.parse((session && session.created_at) || '');
  if (Number.isNaN(created)) return { action: 'skip', reason: 'unparseable_timestamp' };

  const age = nowMs - created;
  if (age < STUCK_INITIATED_MIN_AGE_MS) return { action: 'skip', reason: 'within_grace_window' };
  if (age > STUCK_INITIATED_MAX_AGE_MS) return { action: 'abandon', reason: 'media_expired' };

  // Past the grace window, media still valid: proceed with her recording so she
  // still gets her report (she clearly intended coaching — it's a 15+ min
  // classroom recording). No audio id → nothing to analyse → abandon.
  if (session.audio_id) return { action: 'auto_confirm', reason: 'proceed_with_recording' };
  return { action: 'abandon', reason: 'no_audio' };
}

module.exports = {
  classifyStuckInitiatedSession,
  STUCK_INITIATED_MIN_AGE_MS,
  STUCK_INITIATED_MAX_AGE_MS,
};
