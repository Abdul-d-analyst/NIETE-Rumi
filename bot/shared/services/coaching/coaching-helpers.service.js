/**
 * Coaching Helpers Service
 * Utility functions for coaching workflow
 *
 * Responsibilities:
 * - Generate encouraging messages
 * - Determine output language
 * - Record quality metrics
 * - Calculate costs
 *
 * Extracted from coaching.service.js as part of Phase 2 refactoring
 */

const OpenAI = require('openai');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { OPENAI_API_KEY } = require('../../utils/constants');
const { getUserLanguage } = require('../../utils/language-cache');

class CoachingHelpersService {
  /**
   * Generate encouraging message after transcription using GPT-4o
   * @param {string} firstName - Teacher's first name
   * @param {number} durationSeconds - Audio duration in seconds
   * @returns {Promise<string>} Encouraging message
   */
  static async generateEncouragingMessage(firstName, durationSeconds) {
    try {
      const durationMinutes = Math.round(durationSeconds / 60);
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a supportive teaching coach in Pakistan. Generate a brief, warm, encouraging message (1-2 sentences max) acknowledging a teacher after they complete a classroom recording. Be authentic and specific, using their name and the lesson duration.'
          },
          {
            role: 'user',
            content: `Teacher's name: ${firstName}\nLesson duration: ${durationMinutes} minutes\n\nGenerate an encouraging message.`
          }
        ],
        max_tokens: 100,
        temperature: 0.8
      });

      return `✅ ${response.choices[0].message.content.trim()}`;
    } catch (error) {
      logToFile('Warning: Failed to generate encouraging message, using fallback', {
        error: error.message
      });

      // Fallback message if LLM call fails
      const durationMinutes = Math.round(durationSeconds / 60);
      return `✅ Transcription complete, ${firstName}! You taught for ${durationMinutes} minutes - that's great stamina! 💪`;
    }
  }

  /**
   * Determine output language for the report + voice debrief.
   *
   * bd-2413 (FEAT-106 rows 11,12): the teacher's PREFERRED/LOCKED language wins —
   * NEVER the transient input language. Previously this read the most recent
   * conversations.input_language and returned that, so a teacher who answered one
   * reflection in English got an English voice debrief, and one who asked for
   * Punjabi mid-flow got Punjabi output that then stuck. The report + voice must
   * follow her chosen language (set + locked via /settings → preferred_language),
   * clamped to a language the coaching pipeline can actually render.
   *
   * @param {string} userId
   * @param {string} sessionId (unused now; kept for signature compatibility)
   * @param {string} transcriptLanguage - fallback only, when no preference is set
   * @returns {Promise<string>} Language code ('ur', 'en', …)
   */
  static async determineOutputLanguage(userId, sessionId, transcriptLanguage) {
    try {
      const preferred = await getUserLanguage(userId);
      if (preferred) return CoachingHelpersService.clampCoachingLanguage(preferred);
      // No stored preference — fall back to the transcript language, then Urdu.
      return CoachingHelpersService.clampCoachingLanguage(transcriptLanguage || 'ur');
    } catch (error) {
      logToFile('Warning: Could not determine output language, defaulting to Urdu', {
        error: error.message,
      });
      return 'ur';
    }
  }

  /**
   * Clamp a language code to one the coaching report + TTS can render. Anything
   * outside this set (e.g. a regional PK code, or a language the teacher wrote in
   * once) collapses to Urdu — the deliberate floor for this market.
   */
  static clampCoachingLanguage(lang) {
    const SUPPORTED = new Set(['en', 'ur', 'sw', 'ar']);
    const code = String(lang || '').trim();
    return SUPPORTED.has(code) ? code : 'ur';
  }

  /**
   * Record quality metrics for coaching session
   * @param {object} session - Coaching session object
   * @returns {Promise<void>}
   */
  static async recordQualityMetrics(session) {
    try {
      const processingTime = new Date(session.completed_at) - new Date(session.created_at);
      const transcriptionTime = new Date(session.transcription_completed_at) - new Date(session.transcription_started_at);
      const analysisTime = new Date(session.analysis_completed_at) - new Date(session.analysis_started_at);

      await supabase
        .from('coaching_quality_metrics')
        .insert({
          coaching_session_id: session.id,
          diarization_confidence: session.diarization_confidence,
          processing_time_seconds: Math.round(processingTime / 1000),
          transcription_time_seconds: Math.round(transcriptionTime / 1000),
          analysis_time_seconds: Math.round(analysisTime / 1000),
          session_cost: session.total_cost,
          had_errors: false,
          retry_count: 0,
          created_at: new Date().toISOString()
        });

      logToFile('Quality metrics recorded', { coachingSessionId: session.id });
    } catch (error) {
      logToFile('Warning: Failed to record quality metrics (non-critical)', {
        error: error.message,
        coachingSessionId: session.id
      });
    }
  }

  /**
   * Calculate total cost for coaching session
   * @param {number} transcriptionCost - Cost of transcription
   * @param {number} analysisCost - Cost of analysis
   * @param {number} reportCost - Cost of report generation
   * @param {number} voiceCost - Cost of voice debrief
   * @returns {number} Total cost
   */
  static calculateTotalCost(transcriptionCost = 0, analysisCost = 0, reportCost = 0, voiceCost = 0) {
    return transcriptionCost + analysisCost + reportCost + voiceCost;
  }
}

module.exports = CoachingHelpersService;
