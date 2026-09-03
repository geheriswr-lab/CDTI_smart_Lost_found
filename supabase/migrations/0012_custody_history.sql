-- =========================================================
-- 0012_custody_history.sql
-- =========================================================

create table public.custody_history (
  id             uuid primary key default gen_random_uuid(),
  found_item_id  uuid not null references public.found_items(id) on delete cascade,
  from_status    public.custody_status_enum,
  to_status      public.custody_status_enum not null,
  handled_by     uuid references public.profiles(id),
  location_id    uuid references public.handover_locations(id),
  notes          text,
  created_at     timestamptz not null default now()
);

alter table public.custody_history enable row level security;

-- Staff/admin: full visibility (chain-of-custody audit).
create policy custody_history_select_staff
  on public.custody_history for select
  using (public.is_staff_or_admin());

-- The finder can see the custody trail of the item they reported, for transparency.
create policy custody_history_select_finder
  on public.custody_history for select
  using (
    exists (
      select 1 from public.found_items fi
      where fi.id = found_item_id and fi.finder_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated/anon: custody transitions
-- are recorded exclusively by server-side handover logic (service role),
-- keeping the chain of custody tamper-resistant from the client side.
