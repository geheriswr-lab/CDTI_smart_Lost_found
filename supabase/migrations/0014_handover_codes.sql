-- =========================================================
-- 0014_handover_codes.sql
-- One-time 6-digit codes used to confirm secure handover.
-- Only the HASH is stored; the plaintext code is shown to the
-- claimant exactly once (via notification/UI) at generation time.
-- =========================================================

create table public.handover_codes (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims(id) on delete cascade,
  code_hash    text not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  unique (claim_id)
);

alter table public.handover_codes enable row level security;

-- Staff/admin only: they are the ones who key in / verify the code at handover.
create policy handover_codes_select_staff
  on public.handover_codes for select
  using (public.is_staff_or_admin());

create policy handover_codes_update_staff
  on public.handover_codes for update
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

-- No INSERT policy for authenticated/anon: codes are generated server-side
-- (service role) so the hash and plaintext are never both handled by the
-- client at once.
