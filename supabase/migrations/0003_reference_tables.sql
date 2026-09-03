-- =========================================================
-- 0003_reference_tables.sql
-- categories, locations, handover_locations
-- Public read, admin-only write.
-- =========================================================

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name_th     text not null,
  name_en     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.handover_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.handover_locations enable row level security;

-- Anyone (including anon/guest browsing) can read active reference data.
create policy categories_select_all
  on public.categories for select using (true);
create policy locations_select_all
  on public.locations for select using (true);
create policy handover_locations_select_all
  on public.handover_locations for select using (true);

-- Only admin can write.
create policy categories_write_admin
  on public.categories for all
  using (public.is_admin()) with check (public.is_admin());
create policy locations_write_admin
  on public.locations for all
  using (public.is_admin()) with check (public.is_admin());
create policy handover_locations_write_admin
  on public.handover_locations for all
  using (public.is_admin()) with check (public.is_admin());
