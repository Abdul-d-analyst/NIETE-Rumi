/**
 * Teacher Training — Module Progress
 *
 * The single writer for `teacher_training_progress`. Extracted from
 * content-delivery.service so quiz-delivery can record a completion without
 * requiring content-delivery (which requires quiz-delivery back — the cycle
 * the circular-deps guard flags).
 *
 * bd-2390 made passing the module quiz the gate for completion, so exactly
 * two callers may write a progress row:
 *
 *   1. content-delivery.handleModuleDone — a module with NO quiz, where the
 *      "▶ Next video" tap is the only completion signal available.
 *   2. quiz-delivery.gradeAttempt — the module quiz was passed.
 *
 * Keeping the write in one place is what stops "completed" drifting back to
 * meaning "tapped a button".
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

/**
 * Record a module as completed for a teacher. Idempotent — a repeat call
 * refreshes completed_at rather than creating a duplicate.
 *
 * @param {string} userId   users.id (uuid)
 * @param {number} moduleId training_modules.id
 * @returns {Promise<boolean>} true if the row is present after the call
 */
async function markModuleComplete(userId, moduleId) {
  const { error } = await supabase
    .from('teacher_training_progress')
    .upsert(
      { user_id: userId, module_id: moduleId, completed_at: new Date().toISOString() },
      { onConflict: 'user_id,module_id' }
    );
  if (error) {
    logToFile('❌ Progress upsert failed', { userId, moduleId, error: error.message });
    return false;
  }
  return true;
}

module.exports = { markModuleComplete };
