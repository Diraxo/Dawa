-- Migration: get_server_time
--
-- Problem (Issue 1 — past time slots still selectable): the booking page and
-- RescheduleModal both derived "now" from the *device's* clock
-- (`nowInEthiopia()` in lib/slotGeneration.ts calls `new Date()`, which reads
-- Date.now() — the browser/OS clock). A patient whose device clock is wrong
-- (unset, misconfigured, or deliberately turned back to keep an already-past
-- slot looking bookable) could still see and select lapsed slots client-side,
-- and depending on timing, race the server's own `slot_start < now() - 2min`
-- guard in book_appointment_slot()/reschedule_appointment_slot().
--
-- Fix: expose Postgres' own now() via RPC so the client can compute a
-- device-clock-independent offset (see lib/serverClock.ts) and anchor all
-- slot-availability math to it instead of trusting the browser's Date.now()
-- outright. No RLS-guarded data is exposed — this is a public wall-clock
-- reading, same trust level as the client's own Date.now().

CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION public.get_server_time() TO anon, authenticated;
