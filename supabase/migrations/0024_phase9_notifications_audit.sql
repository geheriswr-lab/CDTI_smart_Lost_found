-- =========================================================
-- 0024_phase9_notifications_audit.sql
-- Phase 9 — Notifications + Audit
--
-- NOTIFICATIONS
--   * claim_received: the claimant gets a confirmation for every
--     submission / re-submission (other README types already exist:
--     potential_match, claim_more_info, claim_approved, claim_rejected,
--     handover_ready, handover_completed, claim_review_required,
--     dispute_review_required).
--   * DB guard: a notification is REJECTED if its payload carries a
--     forbidden key (secret_details, serial_number, answers, code, ...)
--     or if its title/message/payload contains the secret details,
--     serial number or exact location of any found item it refers to
--     (or the private ownership details of a lost item it refers to).
--     This makes "notifications never reveal secret_details" a database
--     guarantee, not just a coding convention.
--
-- AUDIT
--   * audit_logs is now immutable for EVERYONE, including the table owner
--     and the service role: UPDATE / DELETE / TRUNCATE raise an error.
--   * new events:
--       lost_item.edited / found_item.edited  (changed field NAMES only;
--         lifecycle-only changes are covered by their own events)
--       profile.role_changed / profile.restriction_changed /
--         profile.password_flag_changed
--       reference.created / reference.updated / reference.deleted
--         (categories, locations, handover_locations)
--       internal_note.created / internal_note.deleted
-- =========================================================

-- ---------------------------------------------------------
-- 0. helper
-- ---------------------------------------------------------
create or replace function public.try_uuid(p text)
returns uuid
language sql
immutable
as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

-- ---------------------------------------------------------
-- 1. Notification content guard
-- ---------------------------------------------------------
create or replace function public.guard_notification_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text := lower(coalesce(new.title, '') || ' ' || coalesce(new.message, '') || ' ' || coalesce(new.payload::text, ''));
  v_alnum text := regexp_replace(v_text, '[^a-z0-9]', '', 'g');
  v_found uuid[] := '{}';
  v_lost uuid[] := '{}';
  r record;
begin
  if new.payload is not null and jsonb_typeof(new.payload) = 'object'
     and new.payload ?| array['secret_details', 'serial_number', 'exact_location', 'exact_time',
                              'private_image_url', 'private_ownership_details', 'answers',
                              'code', 'code_hash', 'evidence_url', 'finder_id', 'claimant_id'] then
    raise exception 'NOTIFY_FORBIDDEN: payload contains a private field' using errcode = 'check_violation';
  end if;

  -- found items referenced directly, via a list, or via a claim
  v_found := array_remove(array[public.try_uuid(new.payload->>'found_item_id')], null);
  if jsonb_typeof(new.payload->'found_item_ids') = 'array' then
    v_found := v_found || array(select public.try_uuid(x) from jsonb_array_elements_text(new.payload->'found_item_ids') x
                                 where public.try_uuid(x) is not null);
  end if;
  if public.try_uuid(new.payload->>'claim_id') is not null then
    v_found := v_found || array(select found_item_id from public.claims where id = public.try_uuid(new.payload->>'claim_id'));
  end if;
  v_lost := array_remove(array[public.try_uuid(new.payload->>'lost_item_id')], null);

  for r in select secret_details, serial_number, exact_location from public.found_items where id = any(v_found) loop
    if (char_length(btrim(coalesce(r.secret_details, ''))) >= 4 and position(lower(btrim(r.secret_details)) in v_text) > 0)
       or (char_length(btrim(coalesce(r.exact_location, ''))) >= 4 and position(lower(btrim(r.exact_location)) in v_text) > 0)
       or (char_length(regexp_replace(lower(coalesce(r.serial_number, '')), '[^a-z0-9]', '', 'g')) >= 4
           and position(regexp_replace(lower(r.serial_number), '[^a-z0-9]', '', 'g') in v_alnum) > 0) then
      raise exception 'NOTIFY_LEAK: notification would reveal found-item secrets' using errcode = 'check_violation';
    end if;
  end loop;

  for r in select private_ownership_details from public.lost_items where id = any(v_lost) loop
    if char_length(btrim(coalesce(r.private_ownership_details, ''))) >= 4
       and position(lower(btrim(r.private_ownership_details)) in v_text) > 0 then
      raise exception 'NOTIFY_LEAK: notification would reveal private ownership details' using errcode = 'check_violation';
    end if;
  end loop;

  if char_length(coalesce(new.title, '')) > 200 or char_length(coalesce(new.message, '')) > 1000 then
    raise exception 'NOTIFY_INVALID: too long' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notifications_guard on public.notifications;
create trigger trg_notifications_guard
  before insert or update on public.notifications
  for each row execute function public.guard_notification_content();

-- ---------------------------------------------------------
-- 2. claim_received confirmation
-- ---------------------------------------------------------
create or replace function public.claims_notify_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.claim_attempt_count > old.claim_attempt_count then
    insert into public.notifications (user_id, type, title, message, payload)
    values (new.claimant_id, 'claim_received', 'ได้รับคำขอรับของแล้ว',
            'เจ้าหน้าที่จะตรวจสอบข้อมูลและแจ้งผลให้ทราบผ่านหน้าการแจ้งเตือน',
            jsonb_build_object('claim_id', new.id));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_claims_notify_received on public.claims;
create trigger trg_claims_notify_received
  after insert or update on public.claims
  for each row execute function public.claims_notify_received();

-- ---------------------------------------------------------
-- 3. audit_logs: immutable for everyone
-- ---------------------------------------------------------
create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AUDIT_IMMUTABLE: audit_logs cannot be modified or deleted' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists trg_audit_logs_no_update on public.audit_logs;
create trigger trg_audit_logs_no_update
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

drop trigger if exists trg_audit_logs_no_truncate on public.audit_logs;
create trigger trg_audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.audit_logs_immutable();

revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;
revoke all on public.audit_logs from anon;

create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists idx_audit_logs_actor on public.audit_logs (actor_id, created_at desc);
create index if not exists idx_audit_logs_action on public.audit_logs (action, created_at desc);

-- ---------------------------------------------------------
-- 4. Item edits (field NAMES only — never values of private fields)
-- ---------------------------------------------------------
create or replace function public.audit_item_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed text[];
begin
  select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value
    and n.key not in ('updated_at');

  -- Pure lifecycle changes (status / custody) have their own events
  -- (claim.reviewed, custody.changed, handover.completed).
  if v_changed <@ array['status', 'custody_status'] then
    return null;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(),
          case tg_table_name when 'lost_items' then 'lost_item.edited' else 'found_item.edited' end,
          case tg_table_name when 'lost_items' then 'lost_item' else 'found_item' end,
          new.id,
          jsonb_build_object('changed_fields', to_jsonb(v_changed)));
  return null;
end;
$$;

drop trigger if exists trg_lost_items_audit_edit on public.lost_items;
create trigger trg_lost_items_audit_edit
  after update on public.lost_items
  for each row execute function public.audit_item_edit();

drop trigger if exists trg_found_items_audit_edit on public.found_items;
create trigger trg_found_items_audit_edit
  after update on public.found_items
  for each row execute function public.audit_item_edit();

-- ---------------------------------------------------------
-- 5. Profile admin changes
-- ---------------------------------------------------------
create or replace function public.audit_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'profile.role_changed', 'user', new.id,
            jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  -- set_account_restriction() writes its own account.restricted event
  if new.is_restricted is distinct from old.is_restricted
     and coalesce(current_setting('cdti.audit_skip_restriction', true), '') <> 'on' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'profile.restriction_changed', 'user', new.id,
            jsonb_build_object('restricted', new.is_restricted));
  end if;
  if new.must_change_password is distinct from old.must_change_password then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'profile.password_flag_changed', 'user', new.id,
            jsonb_build_object('must_change_password', new.must_change_password));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_profiles_audit on public.profiles;
create trigger trg_profiles_audit
  after update on public.profiles
  for each row execute function public.audit_profile_change();

-- set_account_restriction(): mark its own update so the generic trigger
-- does not log the same restriction twice. (Body identical to 0022 plus
-- the set_config line.)
create or replace function public.set_account_restriction(
  p_user_id uuid,
  p_restricted boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_rows int;
begin
  if not public.is_admin() then
    raise exception 'RISK_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = uid then
    raise exception 'RISK_CONFLICT: cannot restrict yourself' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'RISK_INVALID: reason too long' using errcode = 'check_violation';
  end if;

  perform set_config('cdti.audit_skip_restriction', 'on', true);
  update public.profiles set is_restricted = p_restricted where id = p_user_id;
  get diagnostics v_rows = row_count;
  perform set_config('cdti.audit_skip_restriction', 'off', true);
  if v_rows = 0 then
    raise exception 'RISK_INVALID: user not found' using errcode = 'check_violation';
  end if;

  if p_restricted then
    update public.risk_events
    set resolution = 'account_restricted', resolution_note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), resolution_note),
        resolved_by = uid, resolved_at = now()
    where related_user_id = p_user_id and resolved_at is null;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, case when p_restricted then 'account.restricted' else 'account.unrestricted' end,
          'user', p_user_id, '{}'::jsonb);

  insert into public.notifications (user_id, type, title, message, payload)
  values (p_user_id,
          case when p_restricted then 'account_restricted' else 'account_unrestricted' end,
          case when p_restricted then 'บัญชีของคุณถูกจำกัดสิทธิ์ชั่วคราว' else 'บัญชีของคุณกลับมาใช้งานได้ตามปกติ' end,
          case when p_restricted
               then 'บางฟังก์ชัน เช่น การแจ้งรายการและการขอรับของ จะใช้ไม่ได้ชั่วคราว หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่'
               else 'คุณสามารถใช้งานระบบได้ตามปกติแล้ว' end,
          '{}'::jsonb);
end;
$$;

revoke all on function public.set_account_restriction(uuid, boolean, text) from public, anon;
grant execute on function public.set_account_restriction(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------
-- 6. Reference data (admin actions)
-- ---------------------------------------------------------
create or replace function public.audit_reference_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(),
          'reference.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
          tg_table_name,
          (v_row->>'id')::uuid,
          jsonb_strip_nulls(jsonb_build_object(
            'name', coalesce(v_row->>'name_th', v_row->>'name'),
            'is_active', v_row->'is_active',
            'changed_fields', to_jsonb(v_changed))));
  return null;
end;
$$;

drop trigger if exists trg_categories_audit on public.categories;
create trigger trg_categories_audit after insert or update or delete on public.categories
  for each row execute function public.audit_reference_change();
drop trigger if exists trg_locations_audit on public.locations;
create trigger trg_locations_audit after insert or update or delete on public.locations
  for each row execute function public.audit_reference_change();
drop trigger if exists trg_handover_locations_audit on public.handover_locations;
create trigger trg_handover_locations_audit after insert or update or delete on public.handover_locations
  for each row execute function public.audit_reference_change();

-- ---------------------------------------------------------
-- 7. Internal notes (staff) — note text stays in internal_notes, not in the log
-- ---------------------------------------------------------
create or replace function public.audit_internal_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'internal_note.created', new.entity_type, new.entity_id, jsonb_build_object('note_id', new.id));
  else
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'internal_note.deleted', old.entity_type, old.entity_id,
            jsonb_build_object('note_id', old.id, 'author_id', old.author_id));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_internal_notes_audit on public.internal_notes;
create trigger trg_internal_notes_audit after insert or delete on public.internal_notes
  for each row execute function public.audit_internal_note();

revoke all on function public.try_uuid(text) from public, anon;
grant execute on function public.try_uuid(text) to authenticated;
