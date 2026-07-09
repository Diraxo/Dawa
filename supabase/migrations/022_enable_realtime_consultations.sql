-- Migration 022: Enable Supabase Realtime for consultation-critical tables
--
-- Root cause: consultations and notifications were absent from the supabase_realtime
-- publication, so ALL postgres_changes subscriptions on these tables silently
-- received zero events. Broken systems:
--   - IncomingRequestOverlay (doctor web): incoming request modal never fired
--   - WaitingRoom (patient mobile/web): status updates never arrived via Realtime
--   - AppointmentAlerts (both): notification badge never fired in real-time
--
-- REPLICA IDENTITY FULL is required for filtered subscriptions (e.g.
-- filter: 'doctor_id=eq.{uuid}'). Without it the Supabase Realtime server
-- cannot evaluate column-level filters on UPDATE/DELETE events.

ALTER PUBLICATION supabase_realtime ADD TABLE public.consultations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

ALTER TABLE public.consultations REPLICA IDENTITY FULL;
ALTER TABLE public.notifications  REPLICA IDENTITY FULL;
