-- V1.0.10 — Observation schedules for the /observe scheduling UI (bd-2439 epic, bd-2441).
--
-- A coach schedules a future observation of a teacher (picked via the visit
-- Flow). Keyed on (leader_user_id, school_ext_id, teacher_ext_id) — the same
-- external-id model as leader_teachers, because roster teachers may have NO
-- users row (off-Rumi). Exactly ONE active ('upcoming') schedule per
-- coach×school×teacher — re-scheduling updates in place (partial unique index).
--
-- Rule-15 note: hcp_visit_schedules (V1.0.6) was considered and rejected —
-- its coach_id FKs dashboard_users (a different identity system, 1 stub row)
-- and its teacher_id NOT NULL REFERENCES users(id) cannot represent off-Rumi
-- teachers. Live row count at decision time: 0. See SCHEDULING_PLAN.md §0b.

BEGIN;

CREATE TABLE IF NOT EXISTS observation_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_ext_id   text NOT NULL,
  teacher_ext_id  text NOT NULL,
  teacher_name    text,
  school_name     text,
  scheduled_for   date NOT NULL,
  scheduled_slot  text,
  status          text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','done','cancelled')),
  session_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_sched_leader_status
  ON observation_schedules (leader_user_id, status, scheduled_for);
CREATE UNIQUE INDEX IF NOT EXISTS uq_obs_sched_active
  ON observation_schedules (leader_user_id, school_ext_id, teacher_ext_id)
  WHERE status = 'upcoming';

COMMIT;

-- DOWN (manual):
--   DROP TABLE IF EXISTS observation_schedules;
