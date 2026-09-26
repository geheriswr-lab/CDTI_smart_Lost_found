-- =========================================================
-- 0022_phase7_risk_dispute.sql
-- Phase 7 — Risk Detection + Dispute
--
-- Everything runs as triggers on public.claims, so it fires regardless of
-- which code path changed a claim and cannot be skipped by a client.
--
-- RISK SIGNALS (written to risk_events, staff-only):
--   frequent_claims         >= 5 new claims in 7 days (medium), >= 8 (high)
--   repeated_rejections     >= 3 rejected/insufficient outcomes in 30 days (medium), >= 5 (high)
--   duplicate_claim_target  2nd attempt on the same item (low), 3rd (medium)
--   answer_changed          >= 2 answers contradict the previous attempt (medium)
--   new_account_high_value  account < 7 days old claims a high-value item (medium)
-- Signals only FLAG for human review. Nothing is decided automatically,
-- and labels are neutral — the DB rejects any resolution outside a fixed
-- neutral vocabulary (no "thief"/"scammer" etc.).
--
-- DISPUTES:
--   When a claim becomes active (new or re-submitted) while another active
--   claim exists for the same found item, ALL active claims on that item
--   become 'disputed' and staff are notified. A claim cannot be APPROVED
--   while any other active claim exists on the same item — that is the
--   handover suspension (Phase 8 hands over only approved claims).
--   Claimants still only see "อยู่ระหว่างตรวจสอบ"; they are never told
--   that someone else claimed the item.
-- =========================================================

-- ---------------------------------------------------------
-- 1. risk_events: details, neutral vocabulary, locked writes
-- ---------------------------------------------------------
alter table public.risk_events add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.risk_events add column if not exists resolution_note text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'risk_events_event_type_check') then
    alter table public.risk_events add constraint risk_events_event_type_check
      check (event_type in ('frequent_claims', 'repeated_rejections', 'duplicate_claim_target',
                            'answer_changed', 'new_account_high_value')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'risk_events_resolution_check') then
    alter table public.risk_events add constraint risk_events_resolution_check
      check (resolution is null or resolution in ('needs_review', 'suspicious_activity', 'cleared', 'account_restricted')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'risk_events_resolution_note_len') then
    alter table public.risk_events add constraint risk_events_resolution_note_len
      check (resolution_note is null or char_length(resolution_note) <= 1000) not valid;
  end if;
end $$;

-- Staff change risk events only through resolve_risk_event() (audited).
drop policy if exists risk_events_update_staff on public.risk_events;
revoke insert, update, delete on public.risk_events from anon, authenticated;
revoke all on public.risk_events from anon;

create index if not exists idx_risk_events_open on public.risk_events (resolved_at, created_at desc);
create index if not exists idx_risk_events_user on public.risk_events (related_user_id, created_at desc);

-- ---------------------------------------------------------
-- 2. Internal helper: raise (or escalate) a risk event
-- ---------------------------------------------------------
create or replace function public.raise_risk_event(
  p_type text,
  p_level public.risk_level_enum,
  p_user uuid,
  p_item uuid,
  p_claim uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.risk_events%rowtype;
begin
  -- De-duplicate: one open event per (type, user, claim-or-item) per 7 days;
  -- a repeat only escalates the level and refreshes details.
  select * into v_existing from public.risk_events
  where event_type = p_type
    and related_user_id is not distinct from p_user
    and coalesce(related_claim_id, related_item_id) is not distinct from coalesce(p_claim, p_item)
    and resolved_at is null
    and created_at > now() - interval '7 days'
  order by created_at desc
  limit 1
  for update;

  if found then
    update public.risk_events
    set risk_level = greatest(risk_level, p_level),
        details = p_details
    where id = v_existing.id;
    return;
  end if;

  insert into public.risk_events (event_type, risk_level, related_user_id, related_item_id, related_claim_id, details)
  values (p_type, p_level, p_user, p_item, p_claim, coalesce(p_details, '{}'::jsonb));

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'risk.flagged', 'user', p_user,
          jsonb_build_object('event_type', p_type, 'risk_level', p_level, 'claim_id', p_claim));
end;
$$;

revoke all on function public.raise_risk_event(text, public.risk_level_enum, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 3. Answer comparison: how many answers contradict the previous attempt
--    (an answer that is merely extended/refined does not count)
-- ---------------------------------------------------------
create or replace function public.contradicted_answer_keys(p_old jsonb, p_new jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(o.key order by o.key), '{}')
  from jsonb_each_text(coalesce(p_old, '{}'::jsonb)) o
  join jsonb_each_text(coalesce(p_new, '{}'::jsonb)) n on n.key = o.key
  where o.key not in ('_form', 'where_when')
    and btrim(o.value) <> '' and btrim(n.value) <> ''
    and position(lower(btrim(o.value)) in lower(n.value)) = 0
    and position(lower(btrim(n.value)) in lower(o.value)) = 0;
$$;

-- ---------------------------------------------------------
-- 4. BEFORE trigger: dispute status + approval block
-- ---------------------------------------------------------
create or replace function public.claims_dispute_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_attempt boolean := tg_op = 'INSERT' or new.claim_attempt_count > old.claim_attempt_count;
begin
  if v_new_attempt
     and new.status in ('pending', 'needs_review', 'likely_owner', 'verified')
     and exists (
       select 1 from public.claims c
       where c.found_item_id = new.found_item_id and c.id <> new.id
         and c.status in ('pending', 'needs_review', 'likely_owner', 'verified', 'disputed')
     ) then
    new.status := 'disputed';
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved')
     and exists (
       select 1 from public.claims c
       where c.found_item_id = new.found_item_id and c.id <> new.id
         and c.status in ('pending', 'needs_review', 'likely_owner', 'verified', 'disputed')
     ) then
    raise exception 'CLAIM_DISPUTED: other active claims exist for this item' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_claims_dispute_guard on public.claims;
create trigger trg_claims_dispute_guard
  before insert or update on public.claims
  for each row execute function public.claims_dispute_guard();

-- ---------------------------------------------------------
-- 5. AFTER trigger: spread dispute + risk signals
-- ---------------------------------------------------------
create or replace function public.claims_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_attempt boolean := tg_op = 'INSERT' or new.claim_attempt_count > old.claim_attempt_count;
  v_count int;
  v_changed text[];
  v_created timestamptz;
begin
  -- ---- dispute ----
  if v_new_attempt and new.status = 'disputed' then
    update public.claims
    set status = 'disputed'
    where found_item_id = new.found_item_id and id <> new.id
      and status in ('pending', 'needs_review', 'likely_owner', 'verified');

    select count(*) into v_count from public.claims
    where found_item_id = new.found_item_id and status = 'disputed';

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'claim.disputed', 'found_item', new.found_item_id,
            jsonb_build_object('active_claims', v_count, 'trigger_claim_id', new.id));

    insert into public.notifications (user_id, type, title, message, payload)
    select p.id, 'dispute_review_required', 'มีข้อพิพาทรอตรวจสอบ',
           'สิ่งของ 1 รายการมีผู้ขอรับมากกว่า 1 คน — ระงับการอนุมัติไว้จนกว่าเจ้าหน้าที่จะตรวจสอบ',
           jsonb_build_object('found_item_id', new.found_item_id)
    from public.profiles p
    where p.role in ('staff', 'admin') and p.id <> new.claimant_id;
  end if;

  -- ---- risk signals on a new attempt ----
  if v_new_attempt then
    if new.verification_level = 'enhanced' then
      select created_at into v_created from public.profiles where id = new.claimant_id;
      if v_created > now() - interval '7 days' then
        perform public.raise_risk_event('new_account_high_value', 'medium', new.claimant_id, new.found_item_id, new.id,
          jsonb_build_object('account_age_days', floor(extract(epoch from now() - v_created) / 86400)));
      end if;
    end if;

    if tg_op = 'INSERT' then
      select count(*) into v_count from public.claims
      where claimant_id = new.claimant_id and created_at > now() - interval '7 days';
      if v_count >= 5 then
        perform public.raise_risk_event('frequent_claims',
          case when v_count >= 8 then 'high'::public.risk_level_enum else 'medium'::public.risk_level_enum end,
          new.claimant_id, null, null, jsonb_build_object('claims_7d', v_count));
      end if;
    else
      perform public.raise_risk_event('duplicate_claim_target',
        case when new.claim_attempt_count >= 3 then 'medium'::public.risk_level_enum else 'low'::public.risk_level_enum end,
        new.claimant_id, new.found_item_id, new.id, jsonb_build_object('attempt', new.claim_attempt_count));

      v_changed := public.contradicted_answer_keys(old.answers, new.answers);
      if array_length(v_changed, 1) >= 2 then
        -- field NAMES only, never the answer text
        perform public.raise_risk_event('answer_changed', 'medium', new.claimant_id, new.found_item_id, new.id,
          jsonb_build_object('changed_fields', to_jsonb(v_changed), 'attempt', new.claim_attempt_count));
      end if;
    end if;
  end if;

  -- ---- risk signal on a negative outcome ----
  if tg_op = 'UPDATE' and new.status in ('rejected', 'insufficient') and old.status is distinct from new.status then
    -- review_claim() updates the claim BEFORE inserting its claim_reviews row,
    -- so count past reviews + this outcome.
    select count(*) + 1 into v_count
    from public.claim_reviews r
    join public.claims c on c.id = r.claim_id
    where c.claimant_id = new.claimant_id
      and r.outcome in ('rejected', 'insufficient')
      and r.created_at > now() - interval '30 days';
    if v_count >= 3 then
      perform public.raise_risk_event('repeated_rejections',
        case when v_count >= 5 then 'high'::public.risk_level_enum else 'medium'::public.risk_level_enum end,
        new.claimant_id, null, null, jsonb_build_object('negative_outcomes_30d', v_count));
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_claims_after_change on public.claims;
create trigger trg_claims_after_change
  after insert or update on public.claims
  for each row execute function public.claims_after_change();

-- ---------------------------------------------------------
-- 6. Claimant may withdraw from a dispute as well
-- ---------------------------------------------------------
create or replace function public.cancel_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_claim public.claims%rowtype;
begin
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found or v_claim.claimant_id is distinct from uid then
    raise exception 'CLAIM_NOT_ALLOWED: not your claim' using errcode = 'insufficient_privilege';
  end if;
  if v_claim.status not in ('pending', 'needs_review', 'insufficient', 'disputed') then
    raise exception 'CLAIM_NOT_ALLOWED: claim can no longer be cancelled' using errcode = 'check_violation';
  end if;

  update public.claims set status = 'cancelled' where id = p_claim_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'claim.cancelled', 'claim', p_claim_id, jsonb_build_object('from_status', v_claim.status));
end;
$$;

-- ---------------------------------------------------------
-- 7. resolve_risk_event (staff) — neutral outcomes only
-- ---------------------------------------------------------
create or replace function public.resolve_risk_event(
  p_event_id uuid,
  p_resolution text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_user uuid;
begin
  if not public.is_staff_or_admin() then
    raise exception 'RISK_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  if p_resolution not in ('needs_review', 'suspicious_activity', 'cleared') then
    raise exception 'RISK_INVALID: resolution' using errcode = 'check_violation';
  end if;

  select related_user_id into v_user from public.risk_events where id = p_event_id;
  if not found then
    raise exception 'RISK_INVALID: event not found' using errcode = 'check_violation';
  end if;
  if v_user = uid then
    raise exception 'RISK_CONFLICT: cannot resolve an event about yourself' using errcode = 'insufficient_privilege';
  end if;

  update public.risk_events
  set resolution = p_resolution,
      resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
      -- 'needs_review' keeps the event open; the other two close it
      resolved_by = case when p_resolution = 'needs_review' then null else uid end,
      resolved_at = case when p_resolution = 'needs_review' then null else now() end
  where id = p_event_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'risk.resolved', 'risk_event', p_event_id, jsonb_build_object('resolution', p_resolution));
end;
$$;

-- ---------------------------------------------------------
-- 8. set_account_restriction (admin only)
-- ---------------------------------------------------------
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

  update public.profiles set is_restricted = p_restricted where id = p_user_id;
  if not found then
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
          'user', p_user_id, '{}'::jsonb);  -- reason stays in risk_events (staff-only), not in the log

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

revoke all on function public.resolve_risk_event(uuid, text, text) from public, anon;
revoke all on function public.set_account_restriction(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_claim(uuid) from public, anon;
grant execute on function public.resolve_risk_event(uuid, text, text) to authenticated;
grant execute on function public.set_account_restriction(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_claim(uuid) to authenticated;
revoke all on function public.contradicted_answer_keys(jsonb, jsonb) from public, anon, authenticated;
