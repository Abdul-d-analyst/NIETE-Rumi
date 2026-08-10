-- Migration: Attendance — surface "leave" status + leave_count
-- Depends on: 014_attendance_tables.sql
-- Date: 2026-08-10
--
-- Why: attendance_records.status ALREADY allows 'late'/'excused' (see 014, line 110),
-- but there is no 'leave' value, and attendance_sessions only stores
-- present_count/absent_count, so a "leave" state cannot round-trip to the register.
-- v1 ships a 3-state set: Present / Absent / Leave. This migration:
--   1. adds 'leave' to the allowed record statuses (keeping late/excused in the CHECK),
--   2. adds a leave_count column to attendance_sessions,
--   3. backfills leave_count = 0 for existing rows.
--
-- Note: 'late' stays permitted by the CHECK (it was already there) but is NOT surfaced
-- in the UI for v1. If the team later wants a Late state, add a late_count column and
-- flip it on in the flow — no further schema change to the CHECK is needed.
--
-- This is the STUDENT attendance path (attendance_records / attendance_sessions).
-- It is unrelated to teacher_attendance_records (FEAT-125, principal→teacher), which
-- already has its own leave_type CHECK and needs no change here.
--
-- Safe/idempotent: uses IF NOT EXISTS and a guarded CHECK swap. Run in staging first.

BEGIN;

-- 1. Allow 'leave' on records (widen the CHECK; keep existing values incl. 'late')
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('present', 'absent', 'late', 'excused', 'leave'));

-- 2. Session-level leave tally
ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS leave_count INTEGER DEFAULT 0;

-- 3. Backfill (existing sessions had no leave concept)
UPDATE attendance_sessions SET leave_count = 0 WHERE leave_count IS NULL;

COMMENT ON COLUMN attendance_sessions.leave_count IS 'Students marked on leave (excused absence) — distinct from absent_count. Added 2026-08.';

INSERT INTO schema_versions (version, description)
VALUES ('v2.11.0', 'Attendance: add leave status + leave_count');

COMMIT;

-- ROLLBACK (manual):
--   ALTER TABLE attendance_records DROP CONSTRAINT attendance_records_status_check;
--   ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_status_check
--     CHECK (status IN ('present','absent','late','excused'));
--   ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS leave_count;
--   DELETE FROM schema_versions WHERE version = 'v2.11.0';
