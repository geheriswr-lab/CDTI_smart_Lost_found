-- =========================================================
-- 0017_profiles_protect_sensitive_fields.sql
-- Phase 2 fix.
--
-- 0002_profiles.sql's comment on `profiles_update_own` claims role AND
-- must_change_password are "protected by the trigger below", but the only
-- trigger that exists (trg_profiles_block_self_role_escalation) protects
-- `role` alone. As written, any authenticated user can PATCH their own
-- `must_change_password` and `is_restricted` columns to whatever they want
-- via profiles_update_own — e.g. clearing a staff-applied restriction, or
-- clearing must_change_password without actually changing their password.
--
-- This migration closes that gap with the same pattern already used for
-- role, so Phase 2's forced-password-change flow and later phases' account
-- restriction feature (Phase 7/10) are actually enforced server-side.
-- =========================================================

create or replace function public.protect_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    -- is_restricted: only admin may set or clear a restriction.
    if new.is_restricted is distinct from old.is_restricted then
      raise exception 'Only admins can change is_restricted';
    end if;

    -- must_change_password: owning user may only ever clear it themselves
    -- (true -> false), as the last step of the forced-password-change flow
    -- after actually calling supabase.auth.updateUser({ password }). They
    -- may never set it back to true, and staff (non-admin) may not touch it
    -- on someone else's row at all.
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

create trigger trg_profiles_protect_sensitive_fields
  before update on public.profiles
  for each row execute function public.protect_profile_sensitive_fields();
