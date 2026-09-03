-- =========================================================
-- 0013_internal_notes.sql
-- Staff/admin-only internal notes attached to any entity
-- (found_item, lost_item, claim, risk_event, ...).
-- =========================================================

create table public.internal_notes (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,   -- 'lost_item' | 'found_item' | 'claim' | 'risk_event' | ...
  entity_id    uuid not null,
  author_id    uuid not null references public.profiles(id),
  note         text not null,
  created_at   timestamptz not null default now()
);

alter table public.internal_notes enable row level security;

-- Strictly staff/admin, both read and write. No end user ever sees this table.
create policy internal_notes_select_staff
  on public.internal_notes for select
  using (public.is_staff_or_admin());

create policy internal_notes_insert_staff
  on public.internal_notes for insert
  with check (public.is_staff_or_admin() and author_id = auth.uid());

create policy internal_notes_delete_staff
  on public.internal_notes for delete
  using (public.is_staff_or_admin());
