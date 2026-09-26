-- =========================================================
-- 0026_phase11_security_hardening.sql
-- Phase 11 — Security Testing: fixes for issues found during the audit.
--
--   1. Forced password change was only enforced by Next.js middleware.
--      * A user could PATCH profiles.must_change_password=false through the
--        REST API without ever changing the password (0017 allowed the
--        owner to clear it unconditionally).
--      * While the flag was set, is_admin()/is_staff_or_admin() still
--        returned true, so the seeded admin (admin12345) had full admin
--        power via the API before changing the password.
--      Fix: clearing the flag now requires that auth.users.encrypted_password
--      actually changed since the flag was set (marker table), and the role
--      helpers return false while the flag is set or the account is
--      restricted.
--   2. A finder could edit secret_details / serial_number / exact_location /
--      exact_time / private image / category of a found item after someone
--      had already claimed it (collusion: copy the claimant's answers into
--      the secret, or sabotage the real owner). Now locked for non-staff
--      once any claim exists.
--   3. Users could change their own profiles.email / user_type (which staff
--      rely on when reviewing claims). Now admin-only; full_name / phone get
--      length limits.
--   4. Privilege cleanup: anon could SELECT the profiles table (RLS returned
--      nothing, but there is no reason to expose it) and EXECUTE several
--      helper functions (assert_max_len, is_own_storage_object,
--      current_user_role, ...). Only is_admin()/is_staff_or_admin() stay
--      executable by anon because RLS policies evaluated for anon call them.
--
-- Idempotent — safe to run more than once.
-- =========================================================

-- ---------------------------------------------------------
-- 1a. Role helpers: no staff/admin power while a password change is
--     pending or the account is restricted.
-- ---------------------------------------------------------
create or replace function public.current_user_role()
returns public.system_role_enum
language sql
security definer
stable
set search_path = public
as $$
  select case
           when p.must_change_password or p.is_restricted then 'user'::public.system_role_enum
           else p.role
         end
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select p.role = 'admin' and not p.must_change_password and not p.is_restricted
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select p.role in ('staff', 'admin') and not p.must_change_password and not p.is_restricted
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------
-- 1b. Password-change marker: remember the password hash at the moment
--     must_change_password became true. Not reachable through the API.
-- ---------------------------------------------------------
create table if not exists public.password_change_markers (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  hash_at_set text,
  set_at      timestamptz not null default now()
);
alter table public.password_change_markers enable row level security;
revoke all on public.password_change_markers from anon, authenticated;

create or replace function public.guard_must_change_password()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_current text;
  v_marker  public.password_change_markers%rowtype;
begin
  if new.must_change_password
     and (tg_op = 'INSERT' or not old.must_change_password) then
    select u.encrypted_password into v_current from auth.users u where u.id = new.id;
    insert into public.password_change_markers (user_id, hash_at_set, set_at)
    values (new.id, v_current, now())
    on conflict (user_id) do update set hash_at_set = excluded.hash_at_set, set_at = now();
    return new;
  end if;

  if tg_op = 'UPDATE' and old.must_change_password and not new.must_change_password then
    -- Service role / SQL editor (no JWT) and a real admin acting on
    -- someone else may clear it. The owner may only clear it after the
    -- password really changed.
    if uid is null or (public.is_admin() and new.id <> uid) then
      delete from public.password_change_markers where user_id = new.id;
      return new;
    end if;

    select u.encrypted_password into v_current from auth.users u where u.id = new.id;
    select * into v_marker from public.password_change_markers where user_id = new.id;
    if not found or v_current is null
       or v_current is not distinct from v_marker.hash_at_set then
      raise exception 'PASSWORD_CHANGE_REQUIRED: change your password first'
        using errcode = 'insufficient_privilege';
    end if;
    delete from public.password_change_markers where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_must_change_password on public.profiles;
create trigger trg_profiles_guard_must_change_password
  before insert or update on public.profiles
  for each row execute function public.guard_must_change_password();

-- Backfill markers for accounts that are already waiting for a change
-- (e.g. the seeded admin created before this migration).
insert into public.password_change_markers (user_id, hash_at_set)
select p.id, u.encrypted_password
from public.profiles p
join auth.users u on u.id = p.id
where p.must_change_password
on conflict (user_id) do nothing;

-- ---------------------------------------------------------
-- 1c. Server-side contexts (service role key, SQL editor: no JWT user)
--     may manage roles/flags. Before this, scripts/create-admin.ts and a
--     manual "update profiles set role='admin'" in the SQL editor both
--     failed with "Only admins can change role", because is_admin() is
--     false when there is no auth.uid(). anon cannot reach these paths
--     (no UPDATE grant / RLS requires id = auth.uid()).
-- ---------------------------------------------------------
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change role';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.is_restricted is distinct from old.is_restricted then
      raise exception 'Only admins can change is_restricted';
    end if;
    -- Owner may only clear it (true -> false); guard_must_change_password
    -- additionally requires that the password really changed.
    if new.must_change_password is distinct from old.must_change_password then
      if new.id <> auth.uid() then
        raise exception 'Only admins can change another user''s must_change_password';
      end if;
      if new.must_change_password is true then
        raise exception 'Users cannot set must_change_password back to true';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- 3. Profile fields: email / user_type are admin-only; length limits.
-- ---------------------------------------------------------
create or replace function public.guard_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.email is distinct from old.email
       or new.user_type is distinct from old.user_type
       or new.id is distinct from old.id
       or new.created_at is distinct from old.created_at then
      raise exception 'PROFILE_FORBIDDEN: only admins can change email or user type'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if char_length(btrim(coalesce(new.full_name, ''))) = 0 or char_length(new.full_name) > 120 then
    raise exception 'PROFILE_INVALID: full_name' using errcode = 'check_violation';
  end if;
  if new.phone is not null and char_length(new.phone) > 30 then
    raise exception 'PROFILE_INVALID: phone' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_identity on public.profiles;
create trigger trg_profiles_guard_identity
  before update on public.profiles
  for each row execute function public.guard_profile_identity_fields();

-- ---------------------------------------------------------
-- 2. Lock a found item's verification data once anyone has claimed it.
-- ---------------------------------------------------------
create or replace function public.guard_found_item_secret_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_staff_or_admin() then
    return new;
  end if;
  if (new.secret_details    is distinct from old.secret_details
      or new.serial_number  is distinct from old.serial_number
      or new.exact_location is distinct from old.exact_location
      or new.exact_time     is distinct from old.exact_time
      or new.private_image_url is distinct from old.private_image_url
      or new.category_id    is distinct from old.category_id)
     and exists (select 1 from public.claims c where c.found_item_id = old.id) then
    raise exception 'REPORT_LOCKED: verification details cannot change after a claim was made'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_found_items_secret_lock on public.found_items;
create trigger trg_found_items_secret_lock
  before update on public.found_items
  for each row execute function public.guard_found_item_secret_lock();

-- ---------------------------------------------------------
-- 4. Privilege cleanup
-- ---------------------------------------------------------
revoke all on public.profiles from anon;
revoke insert, delete, truncate on public.profiles from authenticated;
-- matches / notifications are written only by the service role (matching job,
-- notification writer) and SECURITY DEFINER functions; users just read
-- (and mark notifications read via the is_read column grant from 0020).
revoke insert, update, delete on public.matches from authenticated;
revoke insert, delete on public.notifications from authenticated;

-- Supabase grants every privilege on new tables to anon/authenticated.
-- TRUNCATE / REFERENCES / TRIGGER are never needed by API users (and
-- TRUNCATE is not subject to RLS), views are read-only, and anon never
-- writes anything.
do $$
declare t record;
begin
  for t in
    select c.oid::regclass as rel, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('revoke truncate, references, trigger on %s from anon, authenticated', t.rel);
    execute format('revoke insert, update, delete on %s from anon', t.rel);
    if t.relkind in ('v', 'm') then
      execute format('revoke insert, update, delete on %s from authenticated', t.rel);
    end if;
  end loop;
end $$;

-- Functions: anon may execute only the two role helpers used inside RLS
-- policies. Keep authenticated's existing access explicit (it may have come
-- through PUBLIC) before revoking PUBLIC.
do $$
declare
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')   -- skip extension members
  loop
    if f.proname in ('is_admin', 'is_staff_or_admin') then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
      continue;
    end if;
    if has_function_privilege('authenticated', f.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- Pure internal helpers used only inside SECURITY DEFINER code.
revoke execute on function public.assert_max_len(text, int, text) from authenticated;
revoke execute on function public.try_uuid(text) from authenticated;
revoke execute on function public.raise_risk_event(text, public.risk_level_enum, uuid, uuid, uuid, jsonb) from authenticated;
revoke execute on function public.contradicted_answer_keys(jsonb, jsonb) from authenticated;

-- New functions added later must repeat this pattern (revoke from public,
-- anon; grant to authenticated). supabase/tests/phase11_security.test.sql
-- fails if any other public function is executable by anon.
