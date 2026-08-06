/**
 * bd-2490 — assessments are taken on WhatsApp, not in this portal. INTERIM.
 *
 * WHY
 * ---
 * The portal renders quiz answers as one radio per option. A capstone paper is
 * free text and carries no options, so a Beacon House teacher opening the level
 * exam saw eight questions, no inputs, a counter stuck at 0/8 and a dead Submit
 * button. Separately, every assessment rule this surface owned has at some
 * point drifted from the bot's and been fixed on its own: the pass bar
 * (bd-2483), the progress write (bd-2450), the eligibility proxy (bd-2447).
 *
 * So the portal keeps what it is good at — videos, PDFs, progress, past
 * results — and the bot keeps grading, cooldowns and certificates.
 *
 * PAIRED WITH THE BACKEND
 * -----------------------
 * `ASSESSMENTS_ON_WHATSAPP_ONLY` also exists in dashboard/routes/portal.routes.js,
 * and THAT one is the real gate: the API refuses to hand over a paper or accept
 * answers regardless of what this file says. This constant only decides whether
 * the UI shows a redirect card or a quiz form. Flipping one without the other
 * degrades gracefully — flip this off alone and the form appears but every
 * submit is refused; flip the backend off alone and the API works while the UI
 * still points at WhatsApp. Neither combination can let an ungraded answer
 * through, which is the property that matters.
 *
 * TO REMOVE: delete this file and its two call sites (ModuleQuizPanel,
 * LevelExamCard) once the portal can genuinely run both quiz kinds — bd-2488.
 */

import { WHATSAPP_URL } from './whatsapp';

/** Interim: the portal does not run quizzes or exams. */
export const ASSESSMENTS_ON_WHATSAPP_ONLY = true;

/**
 * A chat link with `/training` pre-typed, so the teacher lands on the training
 * menu rather than having to remember the command.
 *
 * WhatsApp prefills the composer but does NOT send it — the teacher still taps
 * send. That is a platform behaviour, not something we can skip, so the copy
 * around this link should say "send /training", never "we've opened it for you".
 */
export const WHATSAPP_TRAINING_URL = `${WHATSAPP_URL}?text=${encodeURIComponent('/training')}`;
