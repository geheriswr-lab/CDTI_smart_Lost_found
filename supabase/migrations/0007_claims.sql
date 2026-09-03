-- =========================================================
-- 0007_claims.sql
-- =========================================================

create table public.claims (
  id                   uuid primary key default gen_random_uuid(),
  claimant_id          uuid not null references public.profiles(id) on delete cascade,
  found_item_id        uuid not null references public.found_items(id) on delete cascade,
  match_id             uuid references public.matches(id),
  status               public.claim_status_enum not null default 'pending',
  verification_level   public.verification_level_enum not null default 'standard',
  answers              jsonb not null default '{}'::jsonb, -- questionnaire answers, private
  claim_attempt_count  integer not null default 0,
  last_attempt_at      timestamptz,
  reviewed_by          uuid references public.profiles(id),
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column public.claims.answers is
  'Claimant questionnaire answers used for ownership verification. Never contains password/PIN/credentials (enforced at application layer).';

create trigger trg_claims_updated_at
  before update on public.claims
  for each row execute function public.set_updated_at();

alter table public.claims enable row level security;

-- Claimant sees only their own claims.
create policy claims_select_claimant
  on public.claims for select
  using (claimant_id = auth.uid());

-- Staff/admin see all claims (review, dispute handling).
create policy claims_select_staff
  on public.claims for select
  using (public.is_staff_or_admin());

-- Only the claimant may open a claim, on their own behalf.
create policy claims_insert_claimant
  on public.claims for insert
  with check (claimant_id = auth.uid());

-- Claimant may update limited fields of their own pending claim (e.g. re-answer);
-- application layer / additional CHECK constraints should restrict which
-- columns are editable once status has left 'pending'.
create policy claims_update_claimant
  on public.claims for update
  using (claimant_id = auth.uid())
  with check (claimant_id = auth.uid());

-- Staff/admin can update any claim (approve/reject/needs_review/disputed).
create policy claims_update_staff
  on public.claims for update
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

-- NOTE: the finder of the found_item deliberately has NO access to this table.
-- This preserves information asymmetry — the person who found the item must
-- never see who is claiming it or what they answered.
