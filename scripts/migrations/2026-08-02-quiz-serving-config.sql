-- 2026-08-02 — per-vendor QUIZ SERVING policy on training_vendors.
--
-- WHY
-- ---
-- Teachers are being asked far more questions than a WhatsApp quiz can carry,
-- and the same paper every time they re-sit it.
--
--   * Module checks serve EVERY active question on the module — a median of 9,
--     one interactive list message each, against a 100% pass bar.
--   * Level exams serve EVERY question on the exam — 72, 68, 62 and 45 on the
--     four live papers.
--   * Options are always rendered in the stored order, so a failed attempt is
--     re-sat with identical text against identical letters.
--
-- The content is already tagged well enough to fix the first of those without
-- editing a single question: training_questions.bloom_level is populated on
-- 2,501 of 2,534 rows. Serving ONE question per distinct level on a module
-- keeps the cognitive spread the module was written for while dropping the
-- median from 9 to 3.
--
-- WHY CONFIG AND NOT CODE
-- -----------------------
-- This is a property of the CONTENT AUTHORITY, not of the product. The three
-- vendors' banks are shaped differently: one is Bloom-tagged and huge, the
-- others are short and hand-curated, and one has no level exam at all. Putting
-- the policy in training_vendors means switching a second vendor onto it later
-- is an UPDATE, reviewed by whoever owns that content — not a deploy.
--
-- Columns rather than a new table, deliberately (anti-sprawl): training_vendors
-- already IS the per-vendor rules row — passing_pct, module_passing_pct,
-- cooldown_hours, unlock_logic, has_grand_quiz all live there and are read on
-- the same lookups these will be read on. A serving-policy table would be a
-- 1:1 join carrying three scalars.
--
-- WHAT THIS DOES
-- --------------
--   module_quiz_strategy  'all' | 'one_per_bloom'   DEFAULT 'all'
--   exam_question_cap     INTEGER, NULL = no cap    DEFAULT NULL
--   shuffle_options       BOOLEAN                   DEFAULT FALSE
--
-- Then sets the three on TALEEMABAD only. BEACONHOUSE and OXBRIDGE keep the
-- defaults, which ARE their current behaviour — nothing about their quizzes
-- changes on the day this runs.
--
-- The cap of 20 applies only to the grand quiz. It is a plain random sample,
-- NOT stratified: all 411 exam questions in the live banks are tagged 'apply',
-- so a "balanced" sample would be identical to a random one while implying a
-- guarantee the data cannot keep. Bloom can only stratify the module checks.
--
-- SAFETY
-- ------
-- Additive only. Every default reproduces the behaviour that shipped before
-- the serving layer existed, and the bot fails open to those same defaults if
-- it cannot resolve a vendor row — so a half-applied migration, or a clone
-- without these columns, serves the old full-length quiz rather than a short
-- or empty one.
--
-- Attempts already in progress are NOT affected: their total_questions was
-- snapshotted against the full bank and quiz-delivery detects that and keeps
-- serving them the full bank to the end. No backfill, no data rewrite; the
-- 433,604 existing answer rows keep their meaning because chosen_option stays
-- the canonical 1-based option index (shuffling is display-only).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + guarded constraint adds + an UPDATE
-- that is a no-op on re-run.

BEGIN;

ALTER TABLE training_vendors
    ADD COLUMN IF NOT EXISTS module_quiz_strategy VARCHAR(32) NOT NULL DEFAULT 'all';
ALTER TABLE training_vendors
    ADD COLUMN IF NOT EXISTS exam_question_cap INTEGER;
ALTER TABLE training_vendors
    ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN NOT NULL DEFAULT FALSE;

-- Keep the strategy vocabulary closed. A typo'd strategy is treated as 'all'
-- by the bot (fail-open), which would silently look like "the change didn't
-- work" rather than an error — the constraint makes it loud at write time.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'training_vendors_module_quiz_strategy_ck'
    ) THEN
        ALTER TABLE training_vendors
            ADD CONSTRAINT training_vendors_module_quiz_strategy_ck
            CHECK (module_quiz_strategy IN ('all', 'one_per_bloom'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'training_vendors_exam_question_cap_ck'
    ) THEN
        ALTER TABLE training_vendors
            ADD CONSTRAINT training_vendors_exam_question_cap_ck
            CHECK (exam_question_cap IS NULL OR exam_question_cap > 0);
    END IF;
END $$;

COMMENT ON COLUMN training_vendors.module_quiz_strategy IS
    'How many module-quiz questions to serve: all | one_per_bloom (one per distinct training_questions.bloom_level, floor of 2).';
COMMENT ON COLUMN training_vendors.exam_question_cap IS
    'Max questions served in a level exam, sampled at random per attempt (seeded on attempt id). NULL = serve the whole bank.';
COMMENT ON COLUMN training_vendors.shuffle_options IS
    'Permute MCQ option order per (attempt, question). Display only — chosen_option is always stored as the canonical 1-based index.';

-- The one vendor whose banks motivated this. Left untouched: BEACONHOUSE
-- (capstone level exam, free-text, 33 untagged questions) and OXBRIDGE (no
-- level exam, short curated modules).
UPDATE training_vendors
SET    module_quiz_strategy = 'one_per_bloom',
       exam_question_cap    = 20,
       shuffle_options      = TRUE
WHERE  key = 'TALEEMABAD';

-- Prove the outcome against live data rather than asserting it: the target
-- vendor must be configured, and no other vendor may have been moved off the
-- defaults by this migration.
DO $$
DECLARE
    configured INTEGER;
    drifted    INTEGER;
BEGIN
    SELECT COUNT(*) INTO configured
    FROM   training_vendors
    WHERE  key = 'TALEEMABAD'
      AND  module_quiz_strategy = 'one_per_bloom'
      AND  exam_question_cap = 20
      AND  shuffle_options IS TRUE;
    IF configured <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 configured TALEEMABAD vendor row, found %', configured;
    END IF;

    SELECT COUNT(*) INTO drifted
    FROM   training_vendors
    WHERE  key <> 'TALEEMABAD'
      AND  (module_quiz_strategy <> 'all' OR exam_question_cap IS NOT NULL OR shuffle_options IS TRUE);
    IF drifted > 0 THEN
        RAISE EXCEPTION '% other vendor row(s) left the defaults — aborting', drifted;
    END IF;
END $$;

COMMIT;

-- Post-apply sanity (read-only, run separately):
--
--   SELECT key, module_quiz_strategy, exam_question_cap, shuffle_options
--   FROM   training_vendors ORDER BY key;
--
--   -- what the module checks will now serve, per module
--   SELECT m.id, m.title,
--          COUNT(*) AS bank,
--          LEAST(COUNT(*), GREATEST(COUNT(DISTINCT COALESCE(q.bloom_level, '')), 2)) AS served
--   FROM   training_questions q
--   JOIN   training_modules  m ON m.id = q.training_module_id
--   WHERE  q.is_active
--   GROUP  BY m.id, m.title
--   ORDER  BY bank DESC
--   LIMIT  20;
