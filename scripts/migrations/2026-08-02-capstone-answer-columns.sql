-- 2026-08-02 — let training_assessment_answers hold a WRITTEN answer.
--
-- WHY
-- ---
-- The first capstone ever completed in production scored 2/40 despite eight
-- genuine answers, six of them strong. The scorer was fine. The rows never
-- persisted.
--
--   chosen_option  character varying  NOT NULL
--   is_correct     boolean            NOT NULL
--
-- Both are MCQ-specific. capstone-delivery.routeTextAnswer sets
-- chosen_option:'text' as a placeholder but is_correct:null — a written answer
-- graded 0-5 has no binary correctness — so every upsert was rejected:
--
--   null value in column "is_correct" violates not-null constraint
--
-- chosen_option is dropped to nullable in the same pass: 'text' is a
-- placeholder standing in for a constraint that should not have applied, and
-- leaving the NOT NULL there just invites the next writer to invent another.
--
-- The upsert's error is never checked, so the flow carried on. finalizeAttempt
-- then summed an empty result set and fell back to its in-memory `lastScore`,
-- which is why the total equalled the score of the LAST question alone.
--
-- Same shape as bd-2477: the capstone service was written against a table
-- designed for multiple choice, and the schema was never widened to match.
--
-- WHY NULLABLE RATHER THAN PLACEHOLDERS
-- -------------------------------------
-- Writing chosen_option='' and is_correct=false would satisfy the constraint
-- and corrupt the meaning. is_correct=false on a 5/5 written answer is simply
-- untrue, and anything counting `is_correct` — gradeAttempt does exactly that
-- for MCQ scoring — would silently include capstone rows. NULL says what is
-- actually the case: this dimension does not apply to this kind of answer.
-- MCQ paths always set both, so nothing there changes.
--
-- SAFETY
-- ------
-- Dropping NOT NULL cannot invalidate an existing row. All 86-odd existing
-- answer rows keep their values. Purely widening.
--
-- IDEMPOTENT: DROP NOT NULL on an already-nullable column is a no-op.

BEGIN;

ALTER TABLE training_assessment_answers ALTER COLUMN chosen_option DROP NOT NULL;
ALTER TABLE training_assessment_answers ALTER COLUMN is_correct    DROP NOT NULL;

-- Prove the shape the capstone actually writes is now accepted, rather than
-- assuming it. Rolled back inside the migration — this is a check, not a write.
DO $$
DECLARE probe_attempt UUID;
BEGIN
    SELECT id INTO probe_attempt FROM training_assessment_attempts
     WHERE quiz_kind = 'capstone' ORDER BY started_at DESC LIMIT 1;
    IF probe_attempt IS NULL THEN
        RAISE NOTICE 'no capstone attempt to probe against — skipping insert check';
        RETURN;
    END IF;
    BEGIN
        INSERT INTO training_assessment_answers
            (attempt_id, question_index, question_id, answer_text, answer_score, feedback_text)
        SELECT probe_attempt, -1, id, 'probe', 0, 'probe'
          FROM training_questions WHERE grand_quiz_id = 29 LIMIT 1;
        DELETE FROM training_assessment_answers
         WHERE attempt_id = probe_attempt AND question_index = -1;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'capstone answer shape still rejected: %', SQLERRM;
    END;
END $$;

COMMIT;
