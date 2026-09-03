-- =========================================================
-- 0005_found_items.sql
-- =========================================================

create table public.found_items (
  id                  uuid primary key default gen_random_uuid(),
  finder_id           uuid not null references public.profiles(id) on delete cascade,
  category_id         uuid references public.categories(id),
  general_name        text not null,
  color                text,
  found_date          date,
  location_id         uuid references public.locations(id),   -- general/public location
  description         text,
  public_image_url    text,
  -- private / verification-only columns:
  private_image_url   text,
  exact_location       text,
  exact_time           timestamptz,
  serial_number        text,
  secret_details        text,
  custody_status       public.custody_status_enum not null default 'with_finder',
  status               public.found_item_status_enum not null default 'reported',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column public.found_items.secret_details is
  'The core anti-fraud secret. NEVER exposed via API/notification/public view. Used only in claim verification checklist by staff/admin logic.';

create trigger trg_found_items_updated_at
  before update on public.found_items
  for each row execute function public.set_updated_at();

alter table public.found_items enable row level security;

-- Finder sees full row, including private/secret columns.
create policy found_items_select_finder
  on public.found_items for select
  using (finder_id = auth.uid());

-- Staff/admin see everything.
create policy found_items_select_staff
  on public.found_items for select
  using (public.is_staff_or_admin());

-- Only the finder may create their own found-item report.
create policy found_items_insert_finder
  on public.found_items for insert
  with check (finder_id = auth.uid());

-- Finder can edit their own report; staff/admin can edit any (custody transfer, status).
create policy found_items_update_finder
  on public.found_items for update
  using (finder_id = auth.uid())
  with check (finder_id = auth.uid());

create policy found_items_update_staff
  on public.found_items for update
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

-- IMPORTANT: claimants must NEVER get a direct SELECT policy on this table —
-- that would leak secret_details. Claimants only see item data through
-- public_found_items (public columns) and through the claims flow, which
-- never returns secret_details to the client.
