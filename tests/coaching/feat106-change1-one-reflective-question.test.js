/**
 * FEAT-106 CHANGE 1 (bd-2346) — exactly ONE reflection question per observation.
 *
 * NUM_REFLECTIVE_QUESTIONS is the single source the debrief loop gates on
 * (reflective-conversation.service.js: `if (questionsAnswered < NUM_REFLECTIVE_QUESTIONS)`)
 * and the question generator sizes its arm array from. This locks the count at 1 so
 * it can't silently drift back to 3, and asserts the loop-gate behaviour: ask one,
 * then proceed to the report.
 */

const { NUM_REFLECTIVE_QUESTIONS } = require('../../bot/shared/config/coaching-debrief.config');

// Mirrors the gate at reflective-conversation.service.js:298.
const wantsAnotherQuestion = (questionsAnswered) => questionsAnswered < NUM_REFLECTIVE_QUESTIONS;

describe('FEAT-106 CHANGE 1 — one reflection question', () => {
  it('is configured to exactly 1', () => {
    expect(NUM_REFLECTIVE_QUESTIONS).toBe(1);
  });

  it('asks one question, then stops (no second question after the first answer)', () => {
    expect(wantsAnotherQuestion(0)).toBe(true);  // before any answer → ask the one question
    expect(wantsAnotherQuestion(1)).toBe(false); // after the first answer → proceed to report
  });
});
