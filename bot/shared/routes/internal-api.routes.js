/**
 * Internal service-to-service API.
 *
 * Mounted at /api/internal. Callers are other services in the same deployment
 * (today: the portal/dashboard), authenticated with a shared secret in
 * `x-api-key`. Never exposed to teachers, never called from a browser.
 *
 * bd-2461 — why the LP enqueue lives here rather than in the portal.
 *
 * The portal used to enqueue by requiring the bot's queue service directly:
 *
 *     require('../../bot/shared/services/lesson-plan-queue.service')
 *
 * That throws inside the dashboard process. The queue driver does
 * `require('aws-sdk')` (the v2 SDK, a dependency of bot/) and the dashboard
 * only carries the v3 `@aws-sdk/*` packages — different package names, so the
 * module simply isn't there. The require sat in a bare `catch (_) {}`, so it
 * degraded silently to writing a `pending` row that nothing consumes, while
 * still answering the browser `queued: true`. Twenty-one orphan rows built up
 * over two days before anyone noticed.
 *
 * The fix isn't to give the dashboard queue powers — that means either
 * shipping a deprecated monolithic SDK into it, or writing a second producer
 * that has to keep its job envelope in step with the bot's forever. It's to
 * stop it needing them. The enqueue stays here, in the process where aws-sdk
 * and SQS_QUEUE_URL already exist, and the portal asks over HTTP.
 *
 * This is an existing pattern: password-reset already calls
 * POST /api/internal/send-password-reset the same way, and MAIN_BOT_URL +
 * INTERNAL_API_KEY are already provisioned on the portal service.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');

const router = express.Router();

/**
 * Shared-secret auth for every route in this router.
 *
 * Rejects when INTERNAL_API_KEY is unset. Without that check a bot missing the
 * variable would compare `undefined === undefined` for a caller that sent no
 * header, and the endpoint would be open to anyone who found the URL.
 */
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    logToFile('❌ Internal API called but INTERNAL_API_KEY is not set — refusing', {
      path: req.path,
    });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (req.headers['x-api-key'] !== expected) {
    logToFile('❌ Unauthorized internal API call', { path: req.path, ip: req.ip });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

/**
 * POST /api/internal/queue-lesson-plan
 *
 * Queue a grounded lesson-plan render (a curriculum_lp_ast row laid out via
 * Gamma). Delegates to the SAME createAndQueueGrounded the bot's own handlers
 * use, so there is exactly one definition of the job envelope.
 *
 * Body   { userId, phoneNumber, sourceLpUuid, topic, chapterTitle?, language? }
 * Auth   x-api-key: INTERNAL_API_KEY
 * Errors 400 (missing userId/sourceLpUuid), 401 (bad key), 502 (queue failed)
 * Ok     202 { success: true, requestId }
 */
router.post('/queue-lesson-plan', requireInternalKey, async (req, res) => {
  const { userId, phoneNumber, sourceLpUuid, topic, chapterTitle } = req.body || {};
  const language = String((req.body && req.body.language) || 'en').toLowerCase() === 'ur' ? 'ur' : 'en';

  if (!userId || !sourceLpUuid) {
    return res.status(400).json({ success: false, error: 'userId and sourceLpUuid are required' });
  }

  try {
    const LessonPlanQueueService = require('../services/lesson-plan-queue.service');
    const requestId = await LessonPlanQueueService.createAndQueueGrounded({
      userId,
      phoneNumber,
      sourceLpUuid,
      topic,
      chapterTitle: chapterTitle || null,
      language,
    });
    logToFile('🧾 Grounded LP queued via internal API', { requestId, sourceLpUuid, userId, language });
    return res.status(202).json({ success: true, requestId, language });
  } catch (error) {
    // Loudly. The bug this endpoint replaces was invisible precisely because a
    // failed enqueue still read as success to the caller.
    logToFile('❌ Internal API failed to queue grounded LP', {
      userId, sourceLpUuid, error: error?.message,
    });
    return res.status(502).json({ success: false, error: 'Failed to queue lesson plan' });
  }
});

/* ------------------------------------------------------------------------- *
 * bd-2479 — the training DECISION layer.
 *
 * The portal reimplemented the bot's training rules in its own process and the
 * copies rotted. Found live 2026-08-02, while the portal's own comments still
 * claimed parity ("mirror the WhatsApp endpoint's rule exactly"):
 *
 *   - a capstone pass did not count as a level pass, so the first Beacon House
 *     certificate ever issued was invisible to the portal;
 *   - "ready for exam" still used the pre-bd-2447 ">=1 module per course"
 *     proxy, a fix we had already announced as shipped;
 *   - a missing vendor row defaulted to chain-locked on one surface and
 *     unlocked on the other;
 *   - the module-order gate (bd-2448) did not exist on the portal at all.
 *
 * These routes add NO logic. Each one delegates to the function the bot's own
 * Flow already calls, and passes the answer back untouched. That is the whole
 * point: a rule that exists in one place cannot drift from itself.
 *
 * Every handler requires the domain module lazily, matching the enqueue route
 * above and keeping this router cheap to load.
 * ------------------------------------------------------------------------- */

/** Coerce a body value to a finite number, or null. Rejects '' and undefined. */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Wrap a training handler with the two things every one of them needs:
 * lazy module resolution, and fail-CLOSED error handling.
 *
 * Failing closed matters more here than in most places. These endpoints answer
 * "is this locked?", and an error that reads as `ok: true` turns a gate into a
 * doorway — the exact bug class bd-2452 fixed on the bot, where a level
 * rendered "🔒 Locked" and started anyway when tapped. On a throw we send 5xx
 * with no `ok` field at all, so a caller cannot mistake failure for permission.
 */
function trainingRoute(name, handler) {
  return async (req, res) => {
    try {
      const Training = require('./teacher-training-endpoint');
      return await handler(Training, req, res);
    } catch (error) {
      logToFile('❌ Internal training API failed', { route: name, error: error?.message });
      return res.status(500).json({ success: false, error: 'Training lookup failed' });
    }
  };
}

/**
 * POST /api/internal/training/level-states
 * Body { userId } → { success, levels: [...] }
 *
 * The whole level catalogue with per-level state, exactly as the WhatsApp Flow
 * renders it: locked / certified / ready_for_quiz / in_progress / not_started.
 */
router.post('/training/level-states', requireInternalKey, trainingRoute('level-states', async (Training, req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

  const levels = await Training.loadVisibleLevelsWithProgress(userId);
  return res.json({ success: true, levels: levels || [] });
}));

/**
 * POST /api/internal/training/level-unlocked
 * Body { userId, levelId } → { success, ok, status?, message?, previous_level_order? }
 */
router.post('/training/level-unlocked', requireInternalKey, trainingRoute('level-unlocked', async (Training, req, res) => {
  const { userId } = req.body || {};
  const levelId = num((req.body || {}).levelId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelId === null) return res.status(400).json({ success: false, error: 'levelId is required' });

  const gate = await Training.checkLevelUnlocked(userId, levelId);
  return res.json({ success: true, ...gate });
}));

/**
 * POST /api/internal/training/module-unlocked
 * Body { userId, moduleId } → { success, ok, message? }
 *
 * bd-2448's sequencing rule — exactly one unpassed module is open at a time.
 * The portal has never had this gate.
 */
router.post('/training/module-unlocked', requireInternalKey, trainingRoute('module-unlocked', async (Training, req, res) => {
  const { userId } = req.body || {};
  const moduleId = num((req.body || {}).moduleId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (moduleId === null) return res.status(400).json({ success: false, error: 'moduleId is required' });

  const gate = await Training.checkModuleUnlocked(userId, moduleId);
  return res.json({ success: true, ...gate });
}));

/**
 * POST /api/internal/training/exam-gate
 * Body { userId, levelOrder, vendorKey? } → { success, ok, reason?, message?, level? }
 *
 * The single precondition check for sitting a level exam — grand quiz or
 * capstone. `vendorKey` is passed through as null when absent rather than
 * defaulted here; what a missing scope means is the domain's call, not the
 * wire's.
 */
router.post('/training/exam-gate', requireInternalKey, trainingRoute('exam-gate', async (Training, req, res) => {
  const { userId, vendorKey } = req.body || {};
  const levelOrder = num((req.body || {}).levelOrder);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelOrder === null) return res.status(400).json({ success: false, error: 'levelOrder is required' });

  const gate = await Training.assertCanStartGrandQuiz(userId, levelOrder, vendorKey || null);
  return res.json({ success: true, ...gate });
}));

/**
 * POST /api/internal/training/exam-gate-by-level
 * Body { userId, levelId } -> { success, ok, reason?, message?, level? }
 *
 * bd-2483 — the same gate, keyed the way the portal addresses levels. The Flow
 * holds a level order; the portal holds an id. One rule, two ways in.
 */
router.post('/training/exam-gate-by-level', requireInternalKey, trainingRoute('exam-gate-by-level', async (Training, req, res) => {
  const { userId } = req.body || {};
  const levelId = num((req.body || {}).levelId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelId === null) return res.status(400).json({ success: false, error: 'levelId is required' });

  const gate = await Training.assertCanStartExamForLevel(userId, levelId);
  return res.json({ success: true, ...gate });
}));

/**
 * POST /api/internal/training/grand-quiz-state
 * Body { userId, levelId } → { success, ...state }
 *
 * The exam's presentation state (badge, body, caption, CTA) alongside its
 * availability, resolved by LEVEL so Beacon House capstones resolve too.
 */
router.post('/training/grand-quiz-state', requireInternalKey, trainingRoute('grand-quiz-state', async (Training, req, res) => {
  const { userId } = req.body || {};
  const levelId = num((req.body || {}).levelId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelId === null) return res.status(400).json({ success: false, error: 'levelId is required' });

  const state = await Training.loadGrandQuizState(userId, levelId);
  return res.json({ success: true, ...(state || {}) });
}));

/**
 * POST /api/internal/training/module-quiz-verdict
 * Body { moduleId, score, totalQuestions } -> { success, is_passed, status, pass_pct, achieved_pct }
 *
 * bd-2483 — the portal graded module quizzes with `score === total` and wrote
 * status 'passed' whatever happened. The bar is per vendor
 * (module_passing_pct), and a failure must record as one.
 */
router.post('/training/module-quiz-verdict', requireInternalKey, async (req, res) => {
  const moduleId = num((req.body || {}).moduleId);
  const score = num((req.body || {}).score);
  const totalQuestions = num((req.body || {}).totalQuestions);
  if (moduleId === null) return res.status(400).json({ success: false, error: 'moduleId is required' });
  if (score === null) return res.status(400).json({ success: false, error: 'score is required' });
  if (totalQuestions === null) return res.status(400).json({ success: false, error: 'totalQuestions is required' });

  try {
    const QuizDelivery = require('../services/training/quiz-delivery.service');
    const verdict = await QuizDelivery.decideModuleQuizPass(moduleId, score, totalQuestions);
    return res.json({ success: true, ...verdict });
  } catch (error) {
    // Fail CLOSED: never let a lookup failure read as a pass.
    logToFile('❌ Internal training API failed', { route: 'module-quiz-verdict', error: error?.message });
    return res.status(500).json({ success: false, error: 'Grading lookup failed' });
  }
});

module.exports = router;
