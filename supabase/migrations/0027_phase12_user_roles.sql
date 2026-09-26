-- =========================================================
-- 0027_phase12_user_roles.sql
-- Phase 12 — Production readiness: appoint / remove staff from the app.
--
-- Until now the only way to make someone staff was an UPDATE in the SQL
-- editor. set_user_role() gives admins a safe, audited way:
--   * admin only (is_admin(): not while a password change is pending)
--   * cannot change your own role (no accidental self-demotion)
--   * cannot remove the last active admin
--   * reason required; audit_logs gets profile.role_changed (0024 trigger)
--     plus a 'user.role_set' entry with the reason
--   * the user gets a neutral notification
-- Idempotent.
-- =========================================================

create or replace function public.set_user_role(p_user_id uuid, p_role public.system_role_enum, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_old public.system_role_enum;
begin
  if not public.is_admin() then
    raise exception 'ROLE_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = uid then
    raise exception 'ROLE_FORBIDDEN: cannot change your own role' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'ROLE_INVALID: reason required (3-500 characters)' using errcode = 'check_violation';
  end if;

  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'ROLE_INVALID: user not found' using errcode = 'check_violation';
  end if;
  if v_old = p_role then
    return;
  end if;
  if v_old = 'admin' and (select count(*) from public.profiles
                          where role = 'admin' and not is_restricted and id <> p_user_id) = 0 then
    raise exception 'ROLE_FORBIDDEN: cannot remove the last admin' using errcode = 'check_violation';
  end if;

  update public.profiles set role = p_role where id = p_user_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'user.role_set', 'user', p_user_id,
          jsonb_build_object('from', v_old, 'to', p_role, 'reason', btrim(p_reason)));

  insert into public.notifications (user_id, type, title, message, payload)
  values (p_user_id, 'role_changed', 'สิทธิ์การใช้งานของคุณเปลี่ยนแปลง',
          case p_role when 'user' then 'บัญชีของคุณกลับเป็นผู้ใช้ทั่วไป'
                      when 'staff' then 'บัญชีของคุณได้รับสิทธิ์เจ้าหน้าที่'
                      else 'บัญชีของคุณได้รับสิทธิ์ผู้ดูแลระบบ' end,
          '{}'::jsonb);
end;
$$;

revoke all on function public.set_user_role(uuid, public.system_role_enum, text) from public, anon;
grant execute on function public.set_user_role(uuid, public.system_role_enum, text) to authenticated;

create index if not exists profiles_role_idx on public.profiles (role) where role <> 'user';
create index if not exists profiles_email_lower_idx on public.profiles (lower(email));
