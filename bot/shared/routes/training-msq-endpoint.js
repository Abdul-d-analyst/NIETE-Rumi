/**
 * Training multi-answer question — WhatsApp Flow endpoint (data exchange).
 *
 * ONE Flow serves EVERY "select all that apply" question in the training
 * catalogue. Nothing about a specific question lives in the Flow JSON: the
 * question text, the option list and the already-checked set are all supplied
 * here at INIT, from the attempt named in the flow token. That is why there
 * are no fixed per-option slots and no per-question Flow to register.
 *
 * Flow token: `<userId>:training-msq:<attemptId>:<questionIndex>`
 *   Segment 0 is the teacher's own id — the same convention every other Flow
 *   endpoint in this repo resolves the user by. The trailing pair names the
 *   exact question, so a Flow message re-opened after the quiz has moved on is
 *   recognised as stale instead of overwriting a newer answer.
 *
 * There is no data_exchange step. The screen's Footer completes the Flow, so
 * the selection arrives as an NFM completion payload and is recorded by
 * quiz-delivery from the webhook. Nothing slow happens inside the ~10s
 * endpoint budget, and there is exactly one write path for an answer.
 *
 * Screen contract (see docs/flows/training-msq-flow.json):
 *   MSQ_QUESTION.data = progress, question_text, options, selected,
 *                       attempt_ref, training_msq_action
 * Never include a `version` field in a response — Meta fails the Flow silently.
 */

const { logToFile } = require('../utils/logger');

const SCREEN_MSQ_QUESTION = 'MSQ_QUESTION';
const TOKEN_TAG = 'training-msq';

/**
 * Split a flow token into the teacher, the attempt and the question index.
 *
 * @param {string} flowToken
 * @returns {{userId: string, attemptId: string, questionIndex: number}|null}
 */
function parseMsqToken(flowToken) {
  const m = new RegExp(`^([^:]+):${TOKEN_TAG}:([a-f0-9-]{36}):(\\d+)$`).exec(String(flowToken || ''));
  if (!m) return null;
  return { userId: m[1], attemptId: m[2], questionIndex: Number(m[3]) };
}

function errorScreen(message) {
  // Error responses carry no screen — Meta shows the message on the current one.
  return { data: { error: { message } } };
}

/**
 * INIT — render the question the attempt is currently on.
 *
 * @param {string} userId resolved by the router from segment 0 of the token
 * @param {string} flowToken
 */
async function handleTrainingMsqInit(userId, flowToken) {
  const parsed = parseMsqToken(flowToken);
  if (!parsed) {
    logToFile('⚠️ Multi-answer Flow token unparseable', { hasToken: !!flowToken });
    return errorScreen('This question link has expired. Please reopen your training.');
  }
  // The router already derives userId from the token; compare anyway so a
  // hand-crafted mismatch is refused here rather than deeper in.
  if (userId && userId !== parsed.userId) {
    logToFile('⚠️ Multi-answer Flow token user mismatch at INIT', { attemptId: parsed.attemptId });
    return errorScreen('This question is not available. Please reopen your training.');
  }

  // Required lazily: quiz-delivery pulls in WhatsApp + certificate + content
  // delivery, and the route file is loaded at boot by every process.
  const QuizDelivery = require('../services/training/quiz-delivery.service');
  const data = await QuizDelivery.buildMsqFlowScreenData(
    parsed.userId, parsed.attemptId, parsed.questionIndex,
  );
  if (!data) {
    return errorScreen('This question has already been answered. Please reopen your training.');
  }

  return { screen: SCREEN_MSQ_QUESTION, data };
}

/**
 * data_exchange — unused. The screen completes rather than round-tripping, so
 * reaching here means the Flow JSON and this endpoint have drifted apart.
 */
async function handleTrainingMsqDataExchange(userId, screen) {
  logToFile('⚠️ Unexpected data_exchange on the multi-answer Flow', { screen });
  return errorScreen('Please tap Submit answer to send your selection.');
}

/**
 * BACK — single screen, nowhere to go back to; re-render the question.
 */
async function handleTrainingMsqBack(userId, screen, flowToken) {
  return await handleTrainingMsqInit(userId, flowToken);
}

module.exports = {
  handleTrainingMsqInit,
  handleTrainingMsqDataExchange,
  handleTrainingMsqBack,
  parseMsqToken,
  SCREEN_MSQ_QUESTION,
};
