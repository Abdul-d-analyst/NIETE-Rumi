/**
 * Training rules client — the portal's only source of training decisions.
 *
 * bd-2480 / bd-2481 / bd-2469.
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * The portal used to answer "is this locked?", "is this level passed?" and
 * "is this level ready for its exam?" with its own copy of the bot's rules.
 * Every copy drifted, and the comments above them still claimed parity:
 *
 *   | Rule                   | Bot                    | Portal (before)           |
 *   |------------------------|------------------------|---------------------------|
 *   | counts as a level pass | ['grand','capstone']   | 'grand' only              |
 *   | "ready for exam"       | every module (bd-2447) | >=1 module per course     |
 *   | missing vendor row     | not chain-locked       | chain-locked              |
 *   | module order gate      | checkModuleUnlocked    | ABSENT ENTIRELY (bd-2448) |
 *
 * Two of those contradicted fixes already announced as shipped. The capstone
 * one meant the first Beacon House certificate ever issued was invisible here.
 *
 * So this module deliberately contains NO rules. It asks the bot and returns
 * the answer. There is no local fallback, because a fallback is a second
 * implementation and that is precisely the bug being removed — a test asserts
 * this file contains no decision logic.
 *
 * WHY HTTP RATHER THAN REQUIRING THE BOT'S CODE
 * ---------------------------------------------
 * Settled by bd-2461: requiring bot code into the dashboard process throws
 * (the queue driver needs aws-sdk v2, the dashboard carries only v3), the
 * throw was swallowed, and the failure reported success for two days. Same
 * pattern as password-reset.service.js, already in production.
 *
 * FAIL CLOSED
 * -----------
 * This makes the bot an availability floor for portal training — an accepted
 * trade (operator, 2026-08-02). It is safe only because every failure DENIES.
 * Unreachable, timed out, 401, 500, malformed body, missing config: all answer
 * `ok: false`. A gate that opens when it cannot reach the authority is not a
 * gate — that is bd-2452's bug class, and bd-2461's.
 *
 * Reads are the exception: getLevelStates THROWS rather than returning [],
 * because an empty catalogue is a legitimate answer ("no training assigned")
 * and returning it on error would render a plausible lie.
 */

const axios = require('axios');

const TIMEOUT_MS = 10_000;

/** Shown when the decision authority could not be reached. Deliberately vague
 *  about the cause — the teacher can only retry either way — and never
 *  phrased as though the content itself is locked. */
const UNAVAILABLE = 'Training is temporarily unavailable. Please try again in a moment.';

function config() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

/**
 * POST to the bot's training API.
 *
 * @returns {Promise<object>} the bot's response body
 * @throws when the bot is unreachable, unhappy, or not configured. Callers
 *         that are GATES must catch and deny; callers that are READS may let
 *         it propagate.
 */
async function ask(path, body) {
  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    // Never silently degrade to "allowed" because a variable is missing.
    throw new Error('training rules API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/training/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const data = res && res.data;
  if (!data || data.success !== true) {
    throw new Error(`training rules API returned failure for ${path}`);
  }
  return data;
}

/**
 * Run a GATE. Any failure denies, with a message the caller can render.
 *
 * @param {string} label   for the log line
 * @param {Function} call  the ask() invocation
 */
async function gate(label, call) {
  try {
    const data = await call();
    // Trust the bot's answer, including its message and any reason/status it
    // attached. `ok` is normalised to a strict boolean so a missing field can
    // never read as permission.
    return { ...data, ok: data.ok === true };
  } catch (error) {
    console.error(`❌ Training gate "${label}" could not reach the bot — denying`, {
      error: error?.message,
      status: error?.response?.status,
    });
    return { ok: false, status: 503, message: UNAVAILABLE, unavailable: true };
  }
}

/**
 * Every level this teacher can see, with the bot's state for each:
 * locked / certified / ready_for_quiz / in_progress / not_started.
 *
 * Throws on failure — see the module note on why this does not return [].
 */
async function getLevelStates(userId) {
  const data = await ask('level-states', { userId });
  return data.levels || [];
}

/** May this teacher open this level's contents? Denies on any failure. */
async function checkLevelUnlocked(userId, levelId) {
  return gate('level-unlocked', () => ask('level-unlocked', { userId, levelId }));
}

/** May this teacher open this module right now? (bd-2448 sequencing.) */
async function checkModuleUnlocked(userId, moduleId) {
  return gate('module-unlocked', () => ask('module-unlocked', { userId, moduleId }));
}

/** May this teacher sit this level's exam — grand quiz or capstone? */
async function checkExamGate(userId, levelOrder, vendorKey = null) {
  return gate('exam-gate', () => ask('exam-gate', { userId, levelOrder, vendorKey }));
}

/** The exam's presentation state for a level. Denies on any failure. */
async function getGrandQuizState(userId, levelId) {
  return gate('grand-quiz-state', () => ask('grand-quiz-state', { userId, levelId }));
}

module.exports = {
  getLevelStates,
  checkLevelUnlocked,
  checkModuleUnlocked,
  checkExamGate,
  getGrandQuizState,
  UNAVAILABLE,
};
