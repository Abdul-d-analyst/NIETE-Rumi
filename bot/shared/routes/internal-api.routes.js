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

module.exports = router;
