-- V1.0.9 — Leader allocations (coach → school → teacher) for the /observe visit picker
-- and the Leader Portal (bd-2426 epic, bd-2427).
--
-- Ported from the main Rumi bot's 20260722_leader_schools_teachers.sql (FEAT-116),
-- adapted for NIETE: source CHECK is 'niete_ict' (the ICT coach roster sheet), and
-- leader_teachers carries a `level` column (PRIMARY / MIDDLE / HIGH / combinations)
-- instead of relying on users.grades_taught — the roster is level-based.
--
-- Conventions:
--   school_ext_id  = 'niete:<EMIS>'          (EMIS is the govt school id in the roster)
--   teacher_ext_id = teacher phone e164      (unique per school after dedupe)
--   teacher_phone_e164 = digits-only 92XXXXXXXXXX (no '+') — must byte-match
--                        users.phone_number for the join to work.
--
-- Seeding is done by the roster backfill script (idempotent on the UNIQUE keys),
-- NOT by this migration. Apply this file to the live NIETE Supabase AND keep it
-- committed here so the repo schema stays honest.

BEGIN;

CREATE TABLE IF NOT EXISTS leader_schools (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source             text NOT NULL CHECK (source IN ('niete_ict')),
  school_ext_id      text,
  school_name        text NOT NULL,
  emis               text,
  name_match_quality text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leader_user_id, source, school_ext_id)
);
CREATE INDEX IF NOT EXISTS idx_leader_schools_leader ON leader_schools (leader_user_id);

CREATE TABLE IF NOT EXISTS leader_teachers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source             text NOT NULL CHECK (source IN ('niete_ict')),
  school_ext_id      text,
  teacher_ext_id     text,
  teacher_name       text NOT NULL,
  teacher_phone      text,
  teacher_phone_e164 text,
  level              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leader_user_id, source, school_ext_id, teacher_ext_id)
);
CREATE INDEX IF NOT EXISTS idx_leader_teachers_leader_school
  ON leader_teachers (leader_user_id, school_ext_id);
CREATE INDEX IF NOT EXISTS idx_leader_teachers_phone_e164
  ON leader_teachers (teacher_phone_e164);

COMMIT;

-- DOWN (manual):
--   DROP TABLE IF EXISTS leader_teachers;
--   DROP TABLE IF EXISTS leader_schools;
