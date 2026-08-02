-- 2026-08-02 — allow quiz_kind='capstone' rows in training_assessment_attempts.
--
-- WHY
-- ---
-- The Beacon House capstone has NEVER been attempted in production. Not zero
-- passes — zero attempts, across 17,656 rows. The reason is this constraint:
--
--   CHECK (
--       (quiz_kind = 'grand'           AND grand_quiz_id IS NOT NULL AND training_module_id IS NULL)
--    OR (quiz_kind = 'training_module' AND training_module_id IS NOT NULL)
--   );
--
-- It permits exactly two kinds. capstone-delivery.service.js inserts
-- quiz_kind='capstone', which matches neither branch, so Postgres has rejected
-- every capstone attempt since bd-2233 shipped. The feature could not have
-- worked at any point; the service was written without extending the
-- constraint that governs its own table.
--
-- It stayed invisible because handleCapstoneButton discarded the error and
-- returned nothing. A teacher tapped "Start Grand Quiz", saw a typing
-- indicator, and got silence. bd-2476 added the logging that finally surfaced
-- it:
--
--   ❌ Capstone attempt insert failed
--      violates check constraint "training_assessment_attempts_kind_target_ck"
--
-- WHAT THIS DOES
-- --------------
-- Adds a third branch matching what the capstone service actually writes:
-- grand_quiz_id set (the capstone row lives in training_grand_quizzes, keyed
-- by quiz_type='capstone'), training_module_id null.
--
-- SAFETY
-- ------
-- Strictly more permissive than the constraint it replaces — the two existing
-- branches are unchanged, so no existing row can be invalidated by it. The
-- verification block below proves that against live data before COMMIT rather
-- than trusting the reasoning.
--
-- IDEMPOTENT: re-running drops and re-adds the same definition.
--
-- NOT DONE HERE, deliberately: ux_taa_one_active_per_module is scoped to
-- quiz_kind='training_module', so nothing prevents a teacher opening several
-- concurrent capstone attempts. Real, but a behaviour change rather than an
-- unblock, and it belongs in its own review.

BEGIN;

ALTER TABLE training_assessment_attempts
    DROP CONSTRAINT IF EXISTS training_assessment_attempts_kind_target_ck;

ALTER TABLE training_assessment_attempts
    ADD CONSTRAINT training_assessment_attempts_kind_target_ck
    CHECK (
        (quiz_kind = 'grand'           AND grand_quiz_id IS NOT NULL AND training_module_id IS NULL)
        OR
        (quiz_kind = 'training_module' AND training_module_id IS NOT NULL)
        OR
        -- bd-2477 — the Beacon House capstone. Its questions hang off a
        -- training_grand_quizzes row (quiz_type='capstone'), so it carries a
        -- grand_quiz_id and no module, exactly like a grand quiz.
        (quiz_kind = 'capstone'        AND grand_quiz_id IS NOT NULL AND training_module_id IS NULL)
    );

-- Prove it against live data rather than asserting it. ADD CONSTRAINT already
-- validates existing rows, but this fails loudly with a count if anything is
-- off, instead of leaving a half-applied migration to be discovered later.
DO $$
DECLARE bad INTEGER;
BEGIN
    SELECT COUNT(*) INTO bad
    FROM   training_assessment_attempts
    WHERE  NOT (
        (quiz_kind = 'grand'           AND grand_quiz_id IS NOT NULL AND training_module_id IS NULL)
        OR (quiz_kind = 'training_module' AND training_module_id IS NOT NULL)
        OR (quiz_kind = 'capstone'        AND grand_quiz_id IS NOT NULL AND training_module_id IS NULL)
    );
    IF bad > 0 THEN
        RAISE EXCEPTION '% existing attempt row(s) violate the new constraint — aborting', bad;
    END IF;
END $$;

COMMIT;
