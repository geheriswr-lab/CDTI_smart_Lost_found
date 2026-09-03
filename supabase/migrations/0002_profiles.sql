-- =========================================================
-- 0002_profiles.sql
-- profiles table (1:1 with auth.users) + role helper functions
-- =========================================================

create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text not null,
  full_name             text not null,
  user_type             public.user_type_enum not null,
  role                  public.system_role_enum not null default 'user',
  must_change_password  boolean not null default false,
  phone                 text,
  is_restricted         boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.profiles is
  'Extends auth.users. role is the ONLY source of truth for admin/staff authorization — never check email.';

-- ---------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read
-- profiles.role without recursive RLS lookups)
-- ---------------------------------------------------------

create or replace function public.current_user_role()
returns public.system_role_enum
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false);
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('staff','admin'), false);
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff_or_admin() to authenticated;

-- updated_at trigger helper (reused by every table)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table public.profiles enable row level security;

-- Users can see their own profile; staff/admin can see everyone.
create policy profiles_select_own_or_staff
  on public.profiles for select
  using (id = auth.uid() or public.is_staff_or_admin());

-- Users can update their own profile EXCEPT role / must_change_password,
-- which are protected by the trigger below.
create policy profiles_update_own
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admin can update anyone (role changes, restrictions, etc).
create policy profiles_update_admin
  on public.profiles for update
  using (public.is_admin())
  with check (true);

-- Profile row is created by a trigger on auth.users (see below), not by the client.
-- No insert policy for authenticated/anon -> default deny.

-- Prevent a non-admin from ever escalating their own role.
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change role';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_profiles_block_self_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();

-- ---------------------------------------------------------
-- Auto-create a profile row when a new auth.users row appears
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, user_type, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'user_type')::public.user_type_enum, 'external_visitor'),
    'user'
  );
  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
