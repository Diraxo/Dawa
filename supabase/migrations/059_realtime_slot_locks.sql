-- slot_locks was never added to the supabase_realtime publication (same class
-- of gap fixed for consultation_summaries in 037 and consultations/notifications
-- in 022) — so a patient's already-open booking screen never saw another
-- patient's booking/cancellation flip a slot from available to booked (or back)
-- without navigating away and re-selecting the day. RLS already allows any
-- patient to read all of a doctor's slot_locks rows (019), so this is safe to
-- broadcast broadly.

ALTER PUBLICATION supabase_realtime ADD TABLE public.slot_locks;
