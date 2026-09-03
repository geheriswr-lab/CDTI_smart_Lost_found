-- =========================================================
-- 0004_lost_items.sql
-- =========================================================

create table public.lost_items (
  id                       uuid primary key default gen_random_uuid(),
  reporter_id              uuid not null references public.profiles(id) on delete cascade,
  category_id              uuid references public.categories(id),
  item_name                text not null,
  brand                    text,
  color                    text,
  lost_date                date,
  location_id              uuid references public.locations(id),
  description              text,
  public_image_url         text,
  -- private / verification-only columns:
  private_ownership_details text,
  private_image_url        text,
  status                   public.lost_item_status_enum not null default 'reported',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column public.lost_items.private_ownership_details is
  'NEVER exposed through public views/search. Used only for claim verification.';

create trigger trg_lost_items_updated_at
  before update on public.lost_items
  for each row execute function public.set_updated_at();

alter table public.lost_items enable row level security;

-- Owner (reporter) sees full row, including private columns.
create policy lost_items_select_owner
  on public.lost_items for select
  using (reporter_id = auth.uid());

-- Staff/admin see everything (needed for review, matching, disputes).
create policy lost_items_select_staff
  on public.lost_items for select
  using (public.is_staff_or_admin());

-- Only the reporter may create their own report.
create policy lost_items_insert_owner
  on public.lost_items for insert
  with check (reporter_id = auth.uid());

-- Reporter can edit their own report; staff/admin can edit any (status changes, review).
create policy lost_items_update_owner
  on public.lost_items for update
  using (reporter_id = auth.uid())
  with check (reporter_id = auth.uid());

create policy lost_items_update_staff
  on public.lost_items for update
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

-- No public/anon SELECT policy on the base table at all.
-- Public/anon access happens only through public_lost_items (Phase 1 view, see 0018).
