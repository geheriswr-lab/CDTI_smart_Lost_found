-- =========================================================
-- 0023_phase8_custody_handover.sql
-- Phase 8 — Custody + Secure Handover
--
--   record_custody_transfer(found_item_id, to_status, location_id, note)  staff
--   issue_handover_code(claim_id) -> 6-digit code (shown once)             approved claimant
--   my_handover_info(claim_id)                                             approved claimant
--   complete_handover(claim_id, code, location_id, id_checked, id_doc, note) -> status text   staff
--
-- Security decisions:
--   * handover_codes is no longer readable by ANYONE through the API
--     (Phase 1 let staff SELECT code_hash; a 6-digit code has only 10^6
--     values, so a readable hash can be brute-forced offline). Codes are
--     checked only inside complete_handover().
--   * codes: crypto-random (gen_random_bytes), stored as bcrypt hash,
--     valid 48h, single use, 5 wrong entries -> code locked, max 5 issues
--     per claim. A wrong code returns a status (not an exception) so the
--     failed-attempt counter is actually saved.
--   * handover only for an APPROVED claim with no other active claim
--     (dispute), item must be in staff custody (transferred_to_staff /
--     in_storage), handled at an active handover location.
--   * enhanced (high-value) claims: staff must confirm the receiver's ID
--     document. Only the document TYPE is stored, never its number.
--   * staff who are the claimant or the finder cannot hand over.
--   * every custody move is recorded in custody_history (append-only for
--     clients) with who / where / when.
-- =========================================================

-- ---------------------------------------------------------
-- 1. handover_locations: validation (admin manages via existing policy)
-- ---------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'handover_locations_name_len') then
    alter table public.handover_locations add constraint handover_locations_name_len
      check (char_length(btrim(name)) between 1 and 120) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'handover_locations_address_len') then
    alter table public.handover_locations add constraint handover_locations_address_len
      check (address is null or char_length(address) <= 300) not valid;
  end if;
end $$;
-- Deactivate instead of delete: custody_history keeps pointing at old locations.
revoke delete on public.handover_locations from anon, authenticated;

-- ---------------------------------------------------------
-- 2. handover_codes: fully server-side
-- ---------------------------------------------------------
alter table public.handover_codes add column if not exists failed_attempts int not null default 0;
alter table public.handover_codes add column if not exists issue_count int not null default 0;

drop policy if exists handover_codes_select_staff on public.handover_codes;
drop policy if exists handover_codes_update_staff on public.handover_codes;
revoke all on public.handover_codes from anon, authenticated;

-- ---------------------------------------------------------
-- 3. handovers: the confirmation record
-- ---------------------------------------------------------
create table if not exists public.handovers (
  id                uuid primary key default gen_random_uuid(),
  claim_id          uuid not null unique references public.claims(id),
  found_item_id     uuid not null references public.found_items(id),
  handed_over_by    uuid not null references public.profiles(id),   -- staff at the counter
  received_by       uuid not null references public.profiles(id),   -- the approved claimant
  location_id       uuid not null references public.handover_locations(id),
  id_checked        boolean not null default false,
  id_document_type  text check (id_document_type is null or id_document_type in ('student_card', 'staff_card', 'national_id', 'passport', 'driver_license', 'other')),
  note              text check (note is null or char_length(note) <= 1000),
  created_at        timestamptz not null default now()
);

alter table public.handovers enable row level security;

drop policy if exists handovers_select_staff on public.handovers;
create policy handovers_select_staff on public.handovers for select using (public.is_staff_or_admin());
drop policy if exists handovers_select_receiver on public.handovers;
create policy handovers_select_receiver on public.handovers for select using (received_by = auth.uid());

revoke insert, update, delete on public.handovers from anon, authenticated;
revoke all on public.handovers from anon;

-- custody_history: clients read via existing policies, never write
revoke insert, update, delete on public.custody_history from anon, authenticated;
revoke all on public.custody_history from anon;
create index if not exists idx_custody_history_item on public.custody_history (found_item_id, created_at);

-- ---------------------------------------------------------
-- 4. record_custody_transfer (staff)
-- ---------------------------------------------------------
create or replace function public.record_custody_transfer(
  p_found_item_id uuid,
  p_to_status public.custody_status_enum,
  p_location_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_item public.found_items%rowtype;
  v_claimant uuid;
begin
  if not public.is_staff_or_admin() then
    raise exception 'CUSTODY_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  if p_to_status = 'released_to_owner' then
    raise exception 'CUSTODY_INVALID: release only through complete_handover' using errcode = 'check_violation';
  end if;
  if p_to_status = 'with_finder' then
    raise exception 'CUSTODY_INVALID: cannot move back to finder' using errcode = 'check_violation';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'CUSTODY_INVALID: note too long' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.handover_locations where id = p_location_id and is_active) then
    raise exception 'CUSTODY_INVALID: location must be an active handover location' using errcode = 'check_violation';
  end if;

  select * into v_item from public.found_items where id = p_found_item_id for update;
  if not found then
    raise exception 'CUSTODY_INVALID: item not found' using errcode = 'check_violation';
  end if;
  if v_item.custody_status = 'released_to_owner' or v_item.status in ('returned', 'closed') then
    raise exception 'CUSTODY_INVALID: item already returned/closed' using errcode = 'check_violation';
  end if;

  update public.found_items
  set custody_status = p_to_status,
      status = case when status = 'reported' then 'in_custody'::public.found_item_status_enum else status end
  where id = p_found_item_id;

  insert into public.custody_history (found_item_id, from_status, to_status, handled_by, location_id, notes)
  values (p_found_item_id, v_item.custody_status, p_to_status, uid, p_location_id, nullif(btrim(coalesce(p_note, '')), ''));

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'custody.changed', 'found_item', p_found_item_id,
          jsonb_build_object('from', v_item.custody_status, 'to', p_to_status, 'location_id', p_location_id));

  -- If an approved claim is waiting, tell the claimant the item is ready.
  select c.claimant_id into v_claimant from public.claims c
  where c.found_item_id = p_found_item_id and c.status = 'approved'
    and not exists (select 1 from public.handovers h where h.claim_id = c.id)
  limit 1;
  if v_claimant is not null and v_item.custody_status = 'with_finder' then
    insert into public.notifications (user_id, type, title, message, payload)
    select v_claimant, 'handover_ready', 'ของพร้อมให้รับแล้ว',
           'กรุณาเปิดหน้าคำขอรับของเพื่อดูสถานที่รับของ และขอรหัสรับของเมื่อพร้อมไปรับ',
           jsonb_build_object('claim_id', c.id)
    from public.claims c where c.found_item_id = p_found_item_id and c.status = 'approved' limit 1;
  end if;
end;
$$;

-- Approved while the item is already with staff -> claimant is ready to pick up.
create or replace function public.claims_handover_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and exists (select 1 from public.found_items fi where fi.id = new.found_item_id
                 and fi.custody_status in ('transferred_to_staff', 'in_storage')) then
    insert into public.notifications (user_id, type, title, message, payload)
    values (new.claimant_id, 'handover_ready', 'ของพร้อมให้รับแล้ว',
            'กรุณาเปิดหน้าคำขอรับของเพื่อดูสถานที่รับของ และขอรหัสรับของเมื่อพร้อมไปรับ',
            jsonb_build_object('claim_id', new.id));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_claims_handover_ready on public.claims;
create trigger trg_claims_handover_ready
  after update on public.claims
  for each row execute function public.claims_handover_ready();

-- ---------------------------------------------------------
-- 5. Where to pick up (claimant view, no custody internals)
-- ---------------------------------------------------------
create or replace function public.my_handover_info(p_claim_id uuid)
returns table (
  ready boolean,
  completed boolean,
  location_name text,
  location_address text,
  code_active boolean,
  code_expires_at timestamptz,
  codes_left int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_custody public.custody_status_enum;
  v_loc uuid;
  v_code public.handover_codes%rowtype;
begin
  select * into v_claim from public.claims where id = p_claim_id;
  if not found or v_claim.claimant_id is distinct from uid or v_claim.status <> 'approved' then
    return;  -- nothing for anyone else
  end if;

  select custody_status into v_custody from public.found_items where id = v_claim.found_item_id;
  select location_id into v_loc from public.custody_history
  where found_item_id = v_claim.found_item_id and location_id is not null
  order by created_at desc limit 1;
  select * into v_code from public.handover_codes where claim_id = p_claim_id;

  return query
  select
    v_custody in ('transferred_to_staff', 'in_storage'),
    exists (select 1 from public.handovers h where h.claim_id = p_claim_id),
    hl.name,
    hl.address,
    v_code.id is not null and v_code.used_at is null and v_code.expires_at > now() and v_code.failed_attempts < 5,
    case when v_code.used_at is null then v_code.expires_at end,
    5 - coalesce(v_code.issue_count, 0)
  from (select 1) dummy
  left join public.handover_locations hl on hl.id = v_loc;
end;
$$;

-- ---------------------------------------------------------
-- 6. issue_handover_code (approved claimant) -> plaintext code ONCE
-- ---------------------------------------------------------
create or replace function public.issue_handover_code(p_claim_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_custody public.custody_status_enum;
  v_issued int;
  v_code text;
begin
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found or v_claim.claimant_id is distinct from uid then
    raise exception 'HANDOVER_FORBIDDEN: not your claim' using errcode = 'insufficient_privilege';
  end if;
  if v_claim.status <> 'approved' then
    raise exception 'HANDOVER_NOT_READY: claim not approved' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.handovers where claim_id = p_claim_id) then
    raise exception 'HANDOVER_DONE: already handed over' using errcode = 'check_violation';
  end if;
  select custody_status into v_custody from public.found_items where id = v_claim.found_item_id;
  if v_custody not in ('transferred_to_staff', 'in_storage') then
    raise exception 'HANDOVER_NOT_READY: item not yet with staff' using errcode = 'check_violation';
  end if;

  select issue_count into v_issued from public.handover_codes where claim_id = p_claim_id;
  if coalesce(v_issued, 0) >= 5 then
    raise exception 'HANDOVER_LOCKED: too many codes issued' using errcode = 'check_violation';
  end if;

  -- 6 digits from a CSPRNG (random() is not suitable for secrets)
  v_code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  insert into public.handover_codes (claim_id, code_hash, expires_at, used_at, used_by, failed_attempts, issue_count)
  values (p_claim_id, crypt(v_code, gen_salt('bf', 8)), now() + interval '48 hours', null, null, 0, 1)
  on conflict (claim_id) do update
  set code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      used_at = null,
      used_by = null,
      failed_attempts = 0,
      issue_count = public.handover_codes.issue_count + 1,
      created_at = now();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'handover.code_issued', 'claim', p_claim_id, jsonb_build_object('issue', coalesce(v_issued, 0) + 1));

  return v_code;
end;
$$;

-- ---------------------------------------------------------
-- 7. complete_handover (staff) -> 'completed' | 'invalid_code' | 'expired' | 'locked' | 'no_code'
-- ---------------------------------------------------------
create or replace function public.complete_handover(
  p_claim_id uuid,
  p_code text,
  p_location_id uuid,
  p_id_checked boolean default false,
  p_id_document_type text default null,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_item public.found_items%rowtype;
  v_code public.handover_codes%rowtype;
  v_lost uuid;
begin
  if not public.is_staff_or_admin() then
    raise exception 'HANDOVER_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'approved' then
    raise exception 'HANDOVER_NOT_READY: claim not approved' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.handovers where claim_id = p_claim_id) then
    raise exception 'HANDOVER_DONE: already handed over' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.claims c where c.found_item_id = v_claim.found_item_id and c.id <> p_claim_id
             and c.status in ('pending', 'needs_review', 'likely_owner', 'verified', 'disputed')) then
    raise exception 'HANDOVER_DISPUTED: other active claims exist' using errcode = 'check_violation';
  end if;

  select * into v_item from public.found_items where id = v_claim.found_item_id for update;
  if uid = v_claim.claimant_id or uid = v_item.finder_id then
    raise exception 'HANDOVER_CONFLICT: staff involved in this item' using errcode = 'insufficient_privilege';
  end if;
  if v_item.custody_status not in ('transferred_to_staff', 'in_storage') then
    raise exception 'HANDOVER_NOT_READY: item not in staff custody' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.handover_locations where id = p_location_id and is_active) then
    raise exception 'HANDOVER_INVALID: location' using errcode = 'check_violation';
  end if;
  if v_claim.verification_level = 'enhanced' and (not coalesce(p_id_checked, false) or p_id_document_type is null) then
    raise exception 'HANDOVER_ID_REQUIRED: enhanced items require ID check' using errcode = 'check_violation';
  end if;
  if p_id_document_type is not null and p_id_document_type not in
     ('student_card', 'staff_card', 'national_id', 'passport', 'driver_license', 'other') then
    raise exception 'HANDOVER_INVALID: id document type' using errcode = 'check_violation';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'HANDOVER_INVALID: note too long' using errcode = 'check_violation';
  end if;

  -- ---- code check (returns a status so failed attempts are persisted) ----
  select * into v_code from public.handover_codes where claim_id = p_claim_id for update;
  if not found then
    return 'no_code';
  end if;
  if v_code.used_at is not null or v_code.failed_attempts >= 5 then
    return 'locked';
  end if;
  if v_code.expires_at <= now() then
    return 'expired';
  end if;
  if p_code is null or p_code !~ '^\d{6}$' or crypt(p_code, v_code.code_hash) <> v_code.code_hash then
    update public.handover_codes set failed_attempts = failed_attempts + 1 where id = v_code.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (uid, 'handover.code_failed', 'claim', p_claim_id, jsonb_build_object('attempt', v_code.failed_attempts + 1));
    return case when v_code.failed_attempts + 1 >= 5 then 'locked' else 'invalid_code' end;
  end if;

  -- ---- success ----
  update public.handover_codes set used_at = now(), used_by = uid where id = v_code.id;

  insert into public.handovers (claim_id, found_item_id, handed_over_by, received_by, location_id,
                                id_checked, id_document_type, note)
  values (p_claim_id, v_item.id, uid, v_claim.claimant_id, p_location_id,
          coalesce(p_id_checked, false), p_id_document_type, nullif(btrim(coalesce(p_note, '')), ''));

  update public.found_items set custody_status = 'released_to_owner', status = 'returned' where id = v_item.id;

  insert into public.custody_history (found_item_id, from_status, to_status, handled_by, location_id, notes)
  values (v_item.id, v_item.custody_status, 'released_to_owner', uid, p_location_id, 'ส่งมอบให้ผู้ขอรับที่ผ่านการตรวจสอบ');

  -- the claimant's own lost report (if linked) is closed as returned
  select m.lost_item_id into v_lost from public.matches m where m.id = v_claim.match_id;
  if v_lost is not null then
    update public.lost_items set status = 'returned' where id = v_lost and reporter_id = v_claim.claimant_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'handover.completed', 'claim', p_claim_id, jsonb_build_object(
    'found_item_id', v_item.id, 'location_id', p_location_id, 'id_checked', coalesce(p_id_checked, false),
    'verification_level', v_claim.verification_level));

  insert into public.notifications (user_id, type, title, message, payload) values
    (v_claim.claimant_id, 'handover_completed', 'รับของคืนเรียบร้อย',
     'บันทึกการรับของคืนเรียบร้อยแล้ว ขอบคุณที่ใช้ระบบ', jsonb_build_object('claim_id', p_claim_id)),
    (v_item.finder_id, 'item_returned', 'ของที่คุณแจ้งพบได้คืนเจ้าของแล้ว',
     'ขอบคุณที่ช่วยส่งคืนของให้เจ้าของ', jsonb_build_object('found_item_id', v_item.id));

  return 'completed';
end;
$$;

-- ---------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------
revoke all on function public.record_custody_transfer(uuid, public.custody_status_enum, uuid, text) from public, anon;
revoke all on function public.my_handover_info(uuid) from public, anon;
revoke all on function public.issue_handover_code(uuid) from public, anon;
revoke all on function public.complete_handover(uuid, text, uuid, boolean, text, text) from public, anon;
grant execute on function public.record_custody_transfer(uuid, public.custody_status_enum, uuid, text) to authenticated;
grant execute on function public.my_handover_info(uuid) to authenticated;
grant execute on function public.issue_handover_code(uuid) to authenticated;
grant execute on function public.complete_handover(uuid, text, uuid, boolean, text, text) to authenticated;
