-- bd-2390 — module-quiz pass thresholds per vendor.
--
-- `training_vendors.passing_pct` already existed but nothing read it, so the
-- values were never checked against the real marking policy. Making the module
-- quiz a gate (quiz-delivery.service.js gradeAttempt) turns this column into
-- live config, so it has to be right.
--
-- Policy (NIETE team): NIETE/TALEEMABAD 80%, Beacon House 70%, Oxbridge 70%.
-- The 70s are already correct; TALEEMABAD is stored as 100, which would gate
-- every NIETE module quiz at a perfect score and wall teachers on one wrong
-- answer.
--
-- These same thresholds are what the historical grand-quiz data shows: across
-- 30,996 source attempts, `is_passed` matches "score >= 80 for TALEEMABAD,
-- >= 70 otherwise" for all but 4 rows (99.987%).
--
-- Idempotent — safe to re-run.

UPDATE training_vendors SET passing_pct = 80 WHERE key = 'TALEEMABAD' AND passing_pct <> 80;
UPDATE training_vendors SET passing_pct = 70 WHERE key = 'BEACONHOUSE' AND passing_pct <> 70;
UPDATE training_vendors SET passing_pct = 70 WHERE key = 'OXBRIDGE'    AND passing_pct <> 70;

-- Verify:
--   SELECT key, name, passing_pct FROM training_vendors ORDER BY key;
-- Expect: BEACONHOUSE 70 | OXBRIDGE 70 | TALEEMABAD 80
