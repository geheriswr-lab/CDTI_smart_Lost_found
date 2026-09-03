-- =========================================================
-- 0006_matches.sql
-- System-generated potential matches between lost_items and found_items.
-- =========================================================

create table public.matches (
  id             uuid primary key default gen_random_uuid(),
  lost_item_id   uuid not null references public.lost_items(id) on delete cascade,
  found_item_id  uuid not null references public.found_items(id) on delete cascade,
  score          numeric(5,2) not null check (score >= 0 and score <= 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (lost_item_id, found_item_id)
);

alter table public.matches enable row level security;

-- Only the two involved parties (lost reporter + found finder) and staff/admin
-- may see a match. This is a "potential match" notice, never proof of ownership.
create policy matches_select_involved_parties
  on public.matches for select
  using (
    public.is_staff_or_admin()
    or exists (select 1 from public.lost_items li where li.id = lost_item_id and li.reporter_id = auth.uid())
    or exists (select 1 from public.found_items fi where fi.id = found_item_id and fi.finder_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policy for authenticated/anon: matches are written
-- exclusively by the backend matching job using the service role key,
-- which bypasses RLS entirely. This keeps scoring logic server-side only.
