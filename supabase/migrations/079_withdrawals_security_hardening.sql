-- Withdrawals security hardening.
--
-- Found during the July 2026 mobile release audit: withdrawals_update (migration
-- 002) had a USING clause allowing a doctor to update their own row, but no
-- WITH CHECK at all — meaning a doctor's own authenticated client could run
-- `update withdrawals set status = 'paid' where id = <own row>` directly,
-- bypassing admin approval entirely. No mobile/web client code actually needs
-- doctor-initiated updates (grepped: nothing calls `.from('withdrawals').update`
-- outside the admin API, which writes via the service-role client) — this was
-- pure unused attack surface. Tightened to admin/service-role only, matching
-- the pattern already used for doctor_profiles in migration 056.
--
-- Also: withdrawals_insert only checked the doctor is approved, never that the
-- requested amount doesn't exceed their actual available balance (earned minus
-- already pending/approved/paid withdrawals) — that check only existed in
-- client-side JS (app/(doctor)/withdraw.tsx), so a modified client or direct
-- API call could request more than the doctor has earned. Added a WITH CHECK
-- balance guard mirroring the same computation the mobile screen already does.

drop policy if exists withdrawals_update on public.withdrawals;
create policy withdrawals_update on public.withdrawals
  for update to authenticated
  using (public.is_admin() or auth.role() = 'service_role')
  with check (public.is_admin() or auth.role() = 'service_role');

drop policy if exists withdrawals_insert on public.withdrawals;
create policy withdrawals_insert on public.withdrawals
  for insert to authenticated
  with check (
    doctor_id = public.get_user_id_from_jwt_sub()
    and exists (
      select 1 from public.doctor_profiles dp
      where dp.user_id = public.get_user_id_from_jwt_sub()
        and dp.status = 'approved'
    )
    and amount <= (
      coalesce((
        select sum(c.doctor_amount) from public.consultations c
        where c.doctor_id = doctor_id and c.status = 'completed'
      ), 0)
      -
      coalesce((
        select sum(w.amount) from public.withdrawals w
        where w.doctor_id = doctor_id and w.status in ('pending', 'approved', 'paid')
      ), 0)
    )
  );
