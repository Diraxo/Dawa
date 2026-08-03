-- Migration 093: cross-device "reconnecting" sync
--
-- Today each call screen derives its `reconnecting` phase purely from its own
-- local Agora signals (onConnectionStateChanged state===4 = my own network is
-- degraded, onUserOffline = my peer's stream disappeared from Agora's server-
-- side view). Both signals are real, but they are not the same latency: when
-- MY network blips, I see it immediately (onConnectionStateChanged), but my
-- peer only learns about it once Agora's own server-side peer-timeout fires
-- onUserOffline on their client — several seconds later. In that window the
-- two devices legitimately disagree about whether the call is healthy
-- (doctor shows "Connected" while the patient already shows "Reconnecting").
--
-- Fix, mirroring the existing pattern from migration 035 (each party reports
-- only its own milestone, the other side mirrors it via Realtime): add one
-- self-reported boolean per role. Each client flips its own flag the instant
-- its local Agora signal changes; the peer combines "my own local signal OR
-- the other party's self-reported flag" into what it displays, so a network
-- blip on either side reaches both screens within a Realtime round-trip
-- instead of waiting on Agora's slower peer-offline detection.

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS doctor_reconnecting  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS patient_reconnecting boolean NOT NULL DEFAULT false;
