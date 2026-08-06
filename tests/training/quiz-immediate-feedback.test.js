/**
 * bd-2523 — a training quiz must tell the teacher, per question, whether the
 * answer was right or wrong.
 *
 * Reported by a NIETE teacher reviewer (Primary TT, P1): "it doesn't show
 * whether the option we selected is correct or incorrect. When I complete 4/4
 * questions then at the end it shows 2/4 options are incorrect making it
 * difficult to track progress."
 *
 * The maddening part was that the answer was ALREADY graded at the moment of
 * the tap — `handleQuizButton` computes `isCorrect`, writes it to
 * training_assessment_answers, advances the cursor, and then calls
 * sendQuestion for the next one. The verdict existed and was thrown away
 * without ever being shown. This is the one-line-per-answer acknowledgement
 * that closes that gap.
 *
 * Scope note: WHY an option was wrong is a separate, larger piece of work
 * (bd-2524 — the source question bank has per-option explanations for ~43% of
 * questions that were never migrated). This test pins the tick/cross only, and
 * is deliberately written so that adding the explanation later extends the
 * message rather than restructuring it.
 *
 * These are source-level assertions, matching the house pattern in
 * tests/portal/portal-ui-contracts.test.js. The delivery service reaches
 * Supabase and the WhatsApp API on every path through handleQuizButton, and
 * the existing behavioural tests for it stand up a full chain mock; for "is a
 * verdict sent before the next question", the ordering in the source IS the
 * contract, and it is exactly what a later edit would silently undo.
 *
 * What this canNOT tell you: how the two messages look arriving back-to-back
 * on a real handset. That wants a human on the PR.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SERVICE = 'bot/shared/services/training/quiz-delivery.service.js';

const raw = fs.readFileSync(path.join(ROOT, SERVICE), 'utf8');

// Assert on real code, never on the prose that explains it — the comments in
// this service discuss ticks and crosses at length.
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The single-answer grading tail: from the isCorrect computation to the end. */
function singleAnswerTail() {
  const start = code.indexOf('const isCorrect = String(q.correct_option)');
  expect(start).toBeGreaterThan(-1);
  const after = code.slice(start);
  const end = after.indexOf('\n}');
  return end === -1 ? after : after.slice(0, end);
}

describe('bd-2523 — the teacher is told, per question, if the answer was right', () => {
  it('a verdict is sent on the single-answer path', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/WhatsAppService\.sendMessage\(/);
  });

  it('the verdict is sent BEFORE the next question, not after', () => {
    const tail = singleAnswerTail();
    const verdictAt = tail.indexOf('WhatsAppService.sendMessage(');
    const nextQAt = tail.indexOf('sendQuestion(');
    expect(verdictAt).toBeGreaterThan(-1);
    expect(nextQAt).toBeGreaterThan(-1);
    // Arriving after the next question would attach the feedback to the wrong
    // one — the teacher reads it as a verdict on the question now on screen.
    expect(verdictAt).toBeLessThan(nextQAt);
  });

  it('it branches on the grade that was already computed', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/isCorrect\s*\?/);
  });

  it('both outcomes carry a mark the eye can catch', () => {
    const tail = singleAnswerTail();
    expect(tail).toMatch(/✅|✓/);
    expect(tail).toMatch(/❌|✗/);
  });

  it('the answer is still recorded before anything is sent', () => {
    const tail = singleAnswerTail();
    const recordAt = tail.indexOf('recordAnswer(');
    const sendAt = tail.indexOf('WhatsAppService.sendMessage(');
    expect(recordAt).toBeGreaterThan(-1);
    // A send that beat the write would lose the answer if delivery threw.
    expect(recordAt).toBeLessThan(sendAt);
  });

  it('a delivery failure cannot strand the quiz mid-attempt', () => {
    const tail = singleAnswerTail();
    // The verdict is a courtesy; the quiz must advance regardless of whether
    // that one message got through.
    expect(tail).toMatch(/try\s*\{[\s\S]*sendMessage\([\s\S]*\}\s*catch/);
  });
});
