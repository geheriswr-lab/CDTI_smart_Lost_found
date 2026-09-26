-- =========================================================
-- 0025_phase10_admin_dashboard.sql
-- Phase 10 — Admin Dashboard
--
--   admin_stats(from, to)          staff: aggregate statistics only (no per-person risk data)
--   admin_custody_anomalies()      staff: custody / handover situations that need attention
--   escalate_case(type, id, reason) staff: escalate a claim / risk event / found item to admins
--   resolve_escalation(id, note)   admin: close an escalation
--
-- Also:
--   * internal_notes: length + entity checks; only the AUTHOR or an ADMIN
--     may delete a note (Phase 1 let any staff delete anyone's note).
--   * categories / locations: name validation; delete revoked (deactivate
--     instead) so existing reports keep their references. Admin writes stay
--     governed by the Phase 1 *_write_admin RLS policies.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Reference data validation
-- ---------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'categories_name_len') then
    alter table public.categories add constraint categories_name_len
      check (char_length(btrim(name_th)) between 1 and 80 and (name_en is null or char_length(name_en) <= 80)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_name_len') then
    alter table public.locations add constraint locations_name_len
      check (char_length(btrim(name)) between 1 and 120 and (description is null or char_length(description) <= 300)) not valid;
  end if;
end $$;
revoke delete on public.categories, public.locations from anon, authenticated;

-- ---------------------------------------------------------
-- 2. Internal notes
-- ---------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'internal_notes_note_len') then
    alter table public.internal_notes add constraint internal_notes_note_len
      check (char_length(btrim(note)) between 1 and 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'internal_notes_entity_type_check') then
    alter table public.internal_notes add constraint internal_notes_entity_type_check
      check (entity_type in ('claim', 'found_item', 'lost_item', 'risk_event', 'user', 'escalation')) not valid;
  end if;
end $$;

drop policy if exists internal_notes_delete_staff on public.internal_notes;
drop policy if exists internal_notes_delete_author_or_admin on public.internal_notes;
create policy internal_notes_delete_author_or_admin
  on public.internal_notes for delete
  using (public.is_staff_or_admin() and (author_id = auth.uid() or public.is_admin()));

revoke update on public.internal_notes from anon, authenticated;  -- notes are append-only (no edit)
revoke all on public.internal_notes from anon;
create index if not exists idx_internal_notes_entity on public.internal_notes (entity_type, entity_id, created_at);

-- ---------------------------------------------------------
-- 3. Escalations
-- ---------------------------------------------------------
create table if not exists public.case_escalations (
  id               uuid primary key default gen_random_uuid(),
  entity_type      text not null check (entity_type in ('claim', 'risk_event', 'found_item')),
  entity_id        uuid not null,
  reason           text not null check (char_length(btrim(reason)) between 5 and 1000),
  escalated_by     uuid not null references public.profiles(id),
  status           text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by      uuid references public.profiles(id),
  resolved_at      timestamptz,
  resolution_note  text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at       timestamptz not null default now()
);

alter table public.case_escalations enable row level security;
drop policy if exists case_escalations_select_staff on public.case_escalations;
create policy case_escalations_select_staff on public.case_escalations for select using (public.is_staff_or_admin());
revoke insert, update, delete on public.case_escalations from anon, authenticated;
revoke all on public.case_escalations from anon;
create unique index if not exists uq_case_escalations_open
  on public.case_escalations (entity_type, entity_id) where status = 'open';
create index if not exists idx_case_escalations_status on public.case_escalations (status, created_at desc);

create or replace function public.escalate_case(p_entity_type text, p_entity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_staff_or_admin() then
    raise exception 'ESCALATE_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  if p_entity_type not in ('claim', 'risk_event', 'found_item') then
    raise exception 'ESCALATE_INVALID: entity type' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'ESCALATE_INVALID: reason must be 5-1000 characters' using errcode = 'check_violation';
  end if;
  if not (
    (p_entity_type = 'claim' and exists (select 1 from public.claims where id = p_entity_id)) or
    (p_entity_type = 'risk_event' and exists (select 1 from public.risk_events where id = p_entity_id)) or
    (p_entity_type = 'found_item' and exists (select 1 from public.found_items where id = p_entity_id))
  ) then
    raise exception 'ESCALATE_INVALID: not found' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.case_escalations where entity_type = p_entity_type and entity_id = p_entity_id and status = 'open') then
    raise exception 'ESCALATE_DUPLICATE: already escalated' using errcode = 'check_violation';
  end if;

  insert into public.case_escalations (entity_type, entity_id, reason, escalated_by)
  values (p_entity_type, p_entity_id, btrim(p_reason), uid)
  returning id into v_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'case.escalated', p_entity_type, p_entity_id, jsonb_build_object('escalation_id', v_id));  -- reason stays in the table

  insert into public.notifications (user_id, type, title, message, payload)
  select p.id, 'case_escalated', 'มีเรื่องส่งต่อให้ admin พิจารณา',
         'เจ้าหน้าที่ส่งต่อเรื่อง 1 รายการให้ admin ตรวจสอบ',
         jsonb_build_object('escalation_id', v_id)
  from public.profiles p where p.role = 'admin' and p.id <> uid;

  return v_id;
end;
$$;

create or replace function public.resolve_escalation(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v public.case_escalations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'ESCALATE_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.case_escalations where id = p_id for update;
  if not found or v.status <> 'open' then
    raise exception 'ESCALATE_INVALID: not open' using errcode = 'check_violation';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'ESCALATE_INVALID: note too long' using errcode = 'check_violation';
  end if;

  update public.case_escalations
  set status = 'resolved', resolved_by = uid, resolved_at = now(), resolution_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'case.escalation_resolved', v.entity_type, v.entity_id, jsonb_build_object('escalation_id', p_id));
end;
$$;

-- ---------------------------------------------------------
-- 4. Statistics (aggregates only)
-- ---------------------------------------------------------
create or replace function public.admin_stats(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_from timestamptz := (p_from::text || ' 00:00:00+07')::timestamptz;
  v_to   timestamptz := ((p_to + 1)::text || ' 00:00:00+07')::timestamptz;
  v jsonb;
begin
  if not public.is_staff_or_admin() then
    raise exception 'STATS_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 731 then
    raise exception 'STATS_INVALID: range' using errcode = 'check_violation';
  end if;

  with
  s_lost as (select count(*) n from public.lost_items where created_at >= v_from and created_at < v_to),
  s_found as (select count(*) n from public.found_items where created_at >= v_from and created_at < v_to),
  s_match as (select count(*) n from public.matches where created_at >= v_from and created_at < v_to),
  s_claims as (select count(*) n,
               count(*) filter (where status = 'approved') approved,
               count(*) filter (where status = 'rejected') rejected
        from public.claims where created_at >= v_from and created_at < v_to),
  s_ret as (select count(*) n,
               avg(extract(epoch from (h.created_at - fi.created_at)) / 3600.0) avg_hours
        from public.handovers h join public.found_items fi on fi.id = h.found_item_id
        where h.created_at >= v_from and h.created_at < v_to),
  -- success rate: of found items REPORTED in the range, how many are returned now
  s_rate as (select count(*) total, count(*) filter (where status = 'returned') returned
        from public.found_items where created_at >= v_from and created_at < v_to),
  monthly as (
    select to_char(date_trunc('month', d at time zone 'Asia/Bangkok'), 'YYYY-MM') ym,
           count(*) filter (where kind = 'lost') n_lost,
           count(*) filter (where kind = 'found') n_found,
           count(*) filter (where kind = 'returned') n_returned
    from (
      select created_at d, 'lost' kind from public.lost_items where created_at >= v_from and created_at < v_to
      union all select created_at, 'found' from public.found_items where created_at >= v_from and created_at < v_to
      union all select created_at, 'returned' from public.handovers where created_at >= v_from and created_at < v_to
    ) x group by 1 order by 1
  )
  select jsonb_build_object(
    'lost_reports', (select n from s_lost),
    'found_reports', (select n from s_found),
    'matches', (select n from s_match),
    'claims', (select n from s_claims),
    'claims_approved', (select approved from s_claims),
    'claims_rejected', (select rejected from s_claims),
    'returns', (select n from s_ret),
    'avg_return_hours', (select round(avg_hours::numeric, 1) from s_ret),
    'found_in_range', (select total from s_rate),
    'found_returned', (select returned from s_rate),
    'return_success_rate', (select case when total = 0 then null else round(returned::numeric * 100 / total, 1) end from s_rate),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', ym, 'lost', n_lost, 'found', n_found, 'returned', n_returned)) from monthly), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------
-- 5. Custody anomalies
-- ---------------------------------------------------------
create or replace function public.admin_custody_anomalies()
returns table (kind text, found_item_id uuid, claim_id uuid, since timestamptz, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_staff_or_admin() then
    raise exception 'STATS_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;

  return query
  -- high-value item still with the finder > 2 days, any item > 7 days
  select 'with_finder_too_long'::text, fi.id, null::uuid, fi.created_at,
         case when coalesce(c.is_high_value, false) then 'ของมูลค่าสูงยังอยู่กับผู้พบเกิน 2 วัน' else 'ของยังอยู่กับผู้พบเกิน 7 วัน' end
  from public.found_items fi left join public.categories c on c.id = fi.category_id
  where fi.custody_status = 'with_finder'
    and fi.status in ('reported', 'in_custody', 'matched', 'claim_pending', 'verified')
    and fi.created_at < now() - case when coalesce(c.is_high_value, false) then interval '2 days' else interval '7 days' end
  union all
  -- finder says "handed to staff" but no staff has confirmed for > 3 days
  select 'unconfirmed_transfer', fi.id, null, fi.created_at, 'ผู้พบแจ้งว่าส่งให้เจ้าหน้าที่แล้ว แต่ยังไม่มีเจ้าหน้าที่ยืนยันเกิน 3 วัน'
  from public.found_items fi
  where fi.custody_status = 'transferred_to_staff'
    and not exists (select 1 from public.custody_history ch where ch.found_item_id = fi.id and ch.handled_by <> fi.finder_id)
    and fi.created_at < now() - interval '3 days'
  union all
  -- approved but not picked up for > 7 days
  select 'approved_not_collected', cl.found_item_id, cl.id, coalesce(cl.reviewed_at, cl.updated_at), 'อนุมัติแล้วแต่ยังไม่มารับเกิน 7 วัน'
  from public.claims cl
  where cl.status = 'approved'
    and not exists (select 1 from public.handovers h where h.claim_id = cl.id)
    and coalesce(cl.reviewed_at, cl.updated_at) < now() - interval '7 days'
  union all
  -- repeated wrong handover codes (possible guessing at the counter)
  select 'handover_code_failures', cl.found_item_id, hc.claim_id, hc.created_at,
         'กรอกรหัสรับของผิด ' || hc.failed_attempts || ' ครั้ง'
  from public.handover_codes hc join public.claims cl on cl.id = hc.claim_id
  where hc.failed_attempts >= 3 and hc.used_at is null
  union all
  -- inconsistent state
  select 'state_mismatch', fi.id, null, fi.updated_at, 'สถานะรายการกับสถานะการครอบครองไม่สอดคล้องกัน'
  from public.found_items fi
  where (fi.status = 'returned') <> (fi.custody_status = 'released_to_owner')
  order by 4;
end;
$$;

-- ---------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------
revoke all on function public.escalate_case(text, uuid, text) from public, anon;
revoke all on function public.resolve_escalation(uuid, text) from public, anon;
revoke all on function public.admin_stats(date, date) from public, anon;
revoke all on function public.admin_custody_anomalies() from public, anon;
grant execute on function public.escalate_case(text, uuid, text) to authenticated;
grant execute on function public.resolve_escalation(uuid, text) to authenticated;
grant execute on function public.admin_stats(date, date) to authenticated;
grant execute on function public.admin_custody_anomalies() to authenticated;
