-- bd-2390 — per-vendor pass marks, split by quiz kind.
--
-- `training_vendors.passing_pct` already existed but nothing read it, so its
-- values were never checked against the real marking policy. Making the module
-- quiz a gate turns pass marks into live config, so they have to be right —
-- and one column can't hold them, because NIETE uses a DIFFERENT bar for the
-- module quiz (100%) than for the level exam (80%).
--
-- Policy (NIETE team):
--
--   vendor        module quiz ("quick check")   level exam
--   ------------  ---------------------------   ------------------------------
--   TALEEMABAD    100%                          80%  (grand quiz)
--   BEACONHOUSE    70%                          70%  (capstone)
--   OXBRIDGE       70%                          n/a  (no level exam at all)
--
-- So: `passing_pct` keeps its meaning as the LEVEL-EXAM bar, and a new
-- `module_passing_pct` carries the module-quiz bar.
--
-- The level-exam numbers are what the historical data shows: across 30,996
-- source grand-quiz attempts, `is_passed` matches ">= 80 for TALEEMABAD,
-- >= 70 otherwise" for all but 4 rows (99.987%). Beacon House is exact —
-- min passing score 70, max failing score 69.
--
-- Oxbridge has no level exam (0 grand quizzes in both source and NIETE,
-- has_grand_quiz = false); its passing_pct is left at 70 as an inert default.
--
-- Idempotent — safe to re-run.

ALTER TABLE training_vendors
  ADD COLUMN IF NOT EXISTS module_passing_pct SMALLINT NOT NULL DEFAULT 100;

COMMENT ON COLUMN training_vendors.module_passing_pct IS
  'Pass mark (%) for a per-module "quick check" quiz. Distinct from passing_pct, '
  'which is the level-exam (grand quiz / capstone) bar. NIETE 100, BH/Oxbridge 70.';

COMMENT ON COLUMN training_vendors.passing_pct IS
  'Pass mark (%) for the LEVEL EXAM (grand quiz, or capstone for all_modules '
  'vendors). NIETE 80, BH 70. See module_passing_pct for the module-quiz bar.';

-- Level-exam bars
UPDATE training_vendors SET passing_pct = 80 WHERE key = 'TALEEMABAD'  AND passing_pct <> 80;
UPDATE training_vendors SET passing_pct = 70 WHERE key = 'BEACONHOUSE' AND passing_pct <> 70;
UPDATE training_vendors SET passing_pct = 70 WHERE key = 'OXBRIDGE'    AND passing_pct <> 70;

-- Module-quiz bars
UPDATE training_vendors SET module_passing_pct = 100 WHERE key = 'TALEEMABAD'  AND module_passing_pct <> 100;
UPDATE training_vendors SET module_passing_pct =  70 WHERE key = 'BEACONHOUSE' AND module_passing_pct <>  70;
UPDATE training_vendors SET module_passing_pct =  70 WHERE key = 'OXBRIDGE'    AND module_passing_pct <>  70;

-- Verify:
--   SELECT key, name, module_passing_pct, passing_pct, has_grand_quiz
--   FROM training_vendors ORDER BY key;
-- Expect:
--   BEACONHOUSE  70 | 70 | false   (level exam is a capstone)
--   OXBRIDGE     70 | 70 | false   (no level exam)
--   TALEEMABAD  100 | 80 | true
