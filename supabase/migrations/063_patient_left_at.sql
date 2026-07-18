-- Migration: patient_left_at
--
-- Lets the patient's mobile/web call screens signal "Leave Call" (an
-- explicit, deliberate exit that keeps the consultation active — the doctor
-- stays in the room) distinctly from an unexpected network drop. Symmetric
-- with the existing doctor_connected_at/patient_connected_at columns
-- (migration 035): the patient client writes this column directly, no DB
-- trigger involved, and it rides the same Realtime subscription the doctor
-- screens already hold open on this row via useConsultationState.
--
-- Never touches `status` — the consultation remains 'in_progress' when the
-- patient leaves, matching the requirement that only the doctor's "End
-- Consultation" action can actually terminate it.

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS patient_left_at timestamptz NULL;

COMMENT ON COLUMN consultations.patient_left_at IS
  'Set when the patient taps "Leave Call" mid-consultation; cleared back to NULL when the patient reconnects. Doctor UI shows "Patient has left the consultation" while set, distinct from a network-drop "Reconnecting…" state. Never implies the consultation itself ended.';
