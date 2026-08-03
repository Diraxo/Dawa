-- verify_trigger_088.sql
--
-- Live verification for migration 088 (consume_credit_on_payment trigger).
-- NOT a migration — do not place this in supabase/migrations, it is not
-- idempotent-safe for `db push` (section 3 intentionally always raises to
-- force a rollback). Run manually against the linked project, e.g.:
--
--   supabase db query --linked --file supabase/verify-scripts/verify_trigger_088.sql
--
-- Run each section's file separately if using the CLI, since it only
-- surfaces the last statement's result set per invocation.

-- ── Section 1: trigger + function are actually registered and enabled ──────
select
  t.tgname as trigger_name,
  p.proname as function_name,
  t.tgenabled as trigger_enabled,       -- 'O' = enabled (fires on origin/replica)
  pg_get_triggerdef(t.oid) as trigger_def
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgname = 'trg_consume_credit_on_payment'
  and not t.tgisinternal;

-- ── Section 2: the one credit the migration backfilled is actually fixed ───
select id, credit_used, replacement_consultation_id, payment_status, status
from public.consultations
where id = '71254c9a-9f07-415f-a401-92074d9f508a';
-- expected: credit_used = true

-- ── Section 3: scan for any remaining reusable/orphaned credits ────────────
-- Credits still marked unused whose replacement consultation already paid.
select
  credit.id as credit_consultation_id,
  credit.credit_used,
  credit.replacement_consultation_id,
  repl.payment_status as replacement_payment_status,
  repl.chapa_tx_ref
from public.consultations credit
join public.consultations repl
  on repl.id = credit.replacement_consultation_id
where credit.credit_used = false
  and repl.payment_status = 'paid';
-- expected: 0 rows

select
  repl.id as paid_consultation_id,
  repl.credit_source_id,
  repl.payment_status,
  repl.chapa_tx_ref,
  credit.credit_used as source_credit_used
from public.consultations repl
join public.consultations credit
  on credit.id = repl.credit_source_id
where repl.payment_status = 'paid'
  and credit.credit_used = false;
-- expected: 0 rows

-- ── Section 4: live-fire test — actually exercise the trigger ──────────────
-- Uses two real, mutually-unrelated consultation rows (both had
-- credit_source_id IS NULL going in). Everything happens inside this DO
-- block's implicit transaction; the final RAISE EXCEPTION unconditionally
-- aborts it, so no mutation is ever persisted, pass or fail. Read the error
-- message: it starts with 'PASS:' or 'FAIL:'.
--
-- Swap credit_id/paid_id for two other unrelated, non-credit-linked rows if
-- re-running this later (re-using the same two rows is safe too, since the
-- whole thing rolls back every time).
DO $$
DECLARE
  credit_id  uuid := '887e2719-bc4d-4731-a3f1-def3b82380a4';
  paid_id    uuid := 'ed0c2226-ed8e-43ff-821a-61861ab1a654';
  result     boolean;
BEGIN
  UPDATE public.consultations SET credit_used = false WHERE id = credit_id;
  UPDATE public.consultations SET credit_source_id = NULL, payment_status = 'pending'
    WHERE id = paid_id;

  -- booking-time write: attach credit, no payment_status touch -> must not fire
  UPDATE public.consultations SET credit_source_id = credit_id WHERE id = paid_id;
  IF (SELECT credit_used FROM public.consultations WHERE id = credit_id) != false THEN
    RAISE EXCEPTION 'FAIL: credit flipped before payment_status ever changed';
  END IF;

  -- the real event: payment_status pending -> paid while credit_source_id is set
  -- (this is exactly what the dev-bypass path and chapa-webhook both do)
  UPDATE public.consultations SET payment_status = 'paid' WHERE id = paid_id;
  SELECT credit_used INTO result FROM public.consultations WHERE id = credit_id;
  IF result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: trigger did not consume credit on payment_status -> paid (credit_used=%)', result;
  END IF;

  -- idempotency: duplicate webhook delivery / retry must not error or un-flip
  UPDATE public.consultations SET payment_status = 'paid' WHERE id = paid_id;
  SELECT credit_used INTO result FROM public.consultations WHERE id = credit_id;
  IF result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: credit_used flipped away from true on duplicate paid write';
  END IF;

  RAISE EXCEPTION 'PASS: all trigger assertions succeeded (rolled back, no data changed)';
END $$;
