-- =========================================================
-- 0021_phase6_claims.sql
-- Phase 6 — Claim + Ownership Verification
--
-- SECURITY FIX: the Phase 1 policies let a claimant INSERT/UPDATE their own
-- claims row with ANY column values — including status='approved'. From
-- now on clients cannot write `claims` at all; every write goes through a
-- SECURITY DEFINER function that enforces the rules:
--
--   submit_claim(found_item_id, answers, match_id)   claimant
--   cancel_claim(claim_id)                           claimant
--   review_claim(claim_id, outcome, checklist, note) staff / admin
--
-- Rules enforced here (not just in the UI):
--   * cannot claim your own found item; restricted accounts cannot claim
--   * one claim row per (claimant, found item); re-submission only after
--     'insufficient' or 'cancelled', after a 24h cooldown, max 3 attempts
--     (claim_attempt_count). 'rejected' is final.
--   * per-user rate limit: max 3 new claims / 24h, max 5 active claims
--   * verification_level = 'enhanced' for high-value categories
--   * enhanced claims can only be APPROVED after a 'verified' review step
--   * reviewer may not be the claimant or the finder
--   * claimant notifications use neutral wording and never say which
--     answer was wrong (anti-guessing)
--   * staff checklist + notes live in claim_reviews (staff-only), so they
--     are never readable by the claimant
-- =========================================================

-- ---------------------------------------------------------
-- 1. Questionnaire type per category
-- ---------------------------------------------------------
alter table public.categories
  add column if not exists claim_form text not null default 'general';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'categories_claim_form_check') then
    alter table public.categories
      add constraint categories_claim_form_check
      check (claim_form in ('general', 'wallet', 'key', 'electronics'));
  end if;
end $$;

update public.categories set claim_form = 'wallet'
  where name_en = 'Wallet' and claim_form = 'general';
update public.categories set claim_form = 'key'
  where name_en = 'Keys' and claim_form = 'general';
update public.categories set claim_form = 'electronics'
  where name_en in ('Mobile phone', 'Laptop / Tablet', 'Other electronics') and claim_form = 'general';

-- ---------------------------------------------------------
-- 2. claims: lock down direct writes
-- ---------------------------------------------------------
drop policy if exists claims_insert_claimant on public.claims;
drop policy if exists claims_update_claimant on public.claims;
drop policy if exists claims_update_staff on public.claims;

revoke insert, update, delete on public.claims from anon, authenticated;
revoke all on public.claims from anon;

create unique index if not exists uq_claims_claimant_item
  on public.claims (claimant_id, found_item_id);
create index if not exists idx_claims_found_item on public.claims (found_item_id);
create index if not exists idx_claims_status on public.claims (status, created_at desc);

-- ---------------------------------------------------------
-- 3. claim_reviews: staff checklist + decision history (staff-only)
-- ---------------------------------------------------------
create table if not exists public.claim_reviews (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims(id) on delete cascade,
  reviewer_id  uuid not null references public.profiles(id),
  from_status  public.claim_status_enum not null,
  outcome      public.claim_status_enum not null,
  checklist    jsonb not null default '{}'::jsonb,
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.claim_reviews enable row level security;

drop policy if exists claim_reviews_select_staff on public.claim_reviews;
create policy claim_reviews_select_staff
  on public.claim_reviews for select
  using (public.is_staff_or_admin());

revoke insert, update, delete on public.claim_reviews from anon, authenticated;
revoke all on public.claim_reviews from anon;
create index if not exists idx_claim_reviews_claim on public.claim_reviews (claim_id, created_at desc);

-- ---------------------------------------------------------
-- 4. claim_evidence: path + count guard
-- ---------------------------------------------------------
revoke all on public.claim_evidence from anon;

create or replace function public.guard_claim_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c public.claims%rowtype;
begin
  if uid is null then
    return new;  -- service context
  end if;

  select * into c from public.claims where id = new.claim_id;
  if not found or c.claimant_id <> uid then
    raise exception 'CLAIM_NOT_ALLOWED: not your claim' using errcode = 'insufficient_privilege';
  end if;
  if c.status not in ('pending', 'insufficient') then
    raise exception 'CLAIM_NOT_ALLOWED: evidence closed for this claim' using errcode = 'check_violation';
  end if;
  if new.evidence_url not like uid::text || '/claims/' || new.claim_id::text || '/%'
     or not public.is_own_storage_object('verification-private', new.evidence_url) then
    raise exception 'CLAIM_INVALID: evidence must be your own private upload for this claim' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.claim_evidence where claim_id = new.claim_id) >= 5 then
    raise exception 'CLAIM_INVALID: too many evidence files' using errcode = 'check_violation';
  end if;
  if new.description is not null and char_length(new.description) > 300 then
    raise exception 'CLAIM_INVALID: description too long' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_claim_evidence_guard on public.claim_evidence;
create trigger trg_claim_evidence_guard
  before insert on public.claim_evidence
  for each row execute function public.guard_claim_evidence();

-- ---------------------------------------------------------
-- 5. submit_claim
-- ---------------------------------------------------------
create or replace function public.submit_claim(
  p_found_item_id uuid,
  p_answers jsonb,
  p_match_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_finder uuid;
  v_status public.found_item_status_enum;
  v_high boolean;
  v_claim public.claims%rowtype;
  v_count int;
begin
  if uid is null then
    raise exception 'CLAIM_NOT_ALLOWED: not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.profiles where id = uid and is_restricted) then
    raise exception 'CLAIM_NOT_ALLOWED: account restricted' using errcode = 'insufficient_privilege';
  end if;

  select fi.finder_id, fi.status, coalesce(c.is_high_value, false)
    into v_finder, v_status, v_high
  from public.found_items fi
  left join public.categories c on c.id = fi.category_id
  where fi.id = p_found_item_id;

  if not found or v_status not in ('reported', 'in_custody', 'matched', 'claim_pending') then
    raise exception 'CLAIM_NOT_AVAILABLE: item not open for claims' using errcode = 'check_violation';
  end if;
  if v_finder = uid then
    raise exception 'CLAIM_NOT_ALLOWED: cannot claim an item you reported as found' using errcode = 'insufficient_privilege';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 16000 then
    raise exception 'CLAIM_INVALID: answers' using errcode = 'check_violation';
  end if;

  -- A match may only be linked if it is the caller's own lost item matched to THIS found item.
  if p_match_id is not null and not exists (
    select 1 from public.matches m
    join public.lost_items li on li.id = m.lost_item_id
    where m.id = p_match_id and m.found_item_id = p_found_item_id and li.reporter_id = uid
  ) then
    p_match_id := null;
  end if;

  select * into v_claim from public.claims
  where claimant_id = uid and found_item_id = p_found_item_id
  for update;

  if found then
    if v_claim.status = 'rejected' or v_claim.claim_attempt_count >= 3 then
      raise exception 'CLAIM_LOCKED: no further attempts' using errcode = 'check_violation';
    end if;
    if v_claim.status not in ('insufficient', 'cancelled') then
      raise exception 'CLAIM_ALREADY_ACTIVE: claim in progress' using errcode = 'check_violation';
    end if;
    if v_claim.last_attempt_at > now() - interval '24 hours' then
      raise exception 'CLAIM_COOLDOWN: try again later' using errcode = 'check_violation';
    end if;

    update public.claims
    set answers = p_answers,
        status = 'pending',
        claim_attempt_count = claim_attempt_count + 1,
        last_attempt_at = now(),
        match_id = coalesce(p_match_id, match_id),
        reviewed_by = null,
        reviewed_at = null
    where id = v_claim.id
    returning * into v_claim;
  else
    select count(*) into v_count from public.claims
    where claimant_id = uid and created_at > now() - interval '24 hours';
    if v_count >= 3 then
      raise exception 'CLAIM_RATE_LIMIT: daily limit' using errcode = 'check_violation';
    end if;

    select count(*) into v_count from public.claims
    where claimant_id = uid and status in ('pending', 'needs_review', 'likely_owner', 'verified', 'disputed');
    if v_count >= 5 then
      raise exception 'CLAIM_RATE_LIMIT: too many active claims' using errcode = 'check_violation';
    end if;

    insert into public.claims (
      claimant_id, found_item_id, match_id, status, verification_level,
      answers, claim_attempt_count, last_attempt_at
    ) values (
      uid, p_found_item_id, p_match_id, 'pending',
      case when v_high then 'enhanced'::public.verification_level_enum else 'standard'::public.verification_level_enum end,
      p_answers, 1, now()
    )
    returning * into v_claim;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'claim.submitted', 'claim', v_claim.id, jsonb_build_object(
    'found_item_id', p_found_item_id,
    'attempt', v_claim.claim_attempt_count,
    'verification_level', v_claim.verification_level
  ));  -- never the answers

  insert into public.notifications (user_id, type, title, message, payload)
  select p.id, 'claim_review_required', 'มีคำขอรับของรอตรวจสอบ',
         'มีผู้ส่งคำขอรับของ 1 รายการ รอเจ้าหน้าที่ตรวจสอบ',
         jsonb_build_object('claim_id', v_claim.id)
  from public.profiles p
  where p.role in ('staff', 'admin') and p.id <> uid;

  return v_claim.id;
end;
$$;

-- ---------------------------------------------------------
-- 6. cancel_claim
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
  if v_claim.status not in ('pending', 'needs_review', 'insufficient') then
    raise exception 'CLAIM_NOT_ALLOWED: claim can no longer be cancelled' using errcode = 'check_violation';
  end if;

  update public.claims set status = 'cancelled' where id = p_claim_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'claim.cancelled', 'claim', p_claim_id, jsonb_build_object('from_status', v_claim.status));
end;
$$;

-- ---------------------------------------------------------
-- 7. review_claim (staff / admin)
-- ---------------------------------------------------------
create or replace function public.review_claim(
  p_claim_id uuid,
  p_outcome public.claim_status_enum,
  p_checklist jsonb default '{}'::jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_claim public.claims%rowtype;
  v_finder uuid;
  v_item_status public.found_item_status_enum;
begin
  if not public.is_staff_or_admin() then
    raise exception 'CLAIM_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  if p_outcome not in ('insufficient', 'needs_review', 'likely_owner', 'verified', 'approved', 'rejected') then
    raise exception 'CLAIM_INVALID: outcome' using errcode = 'check_violation';
  end if;
  if p_checklist is null or jsonb_typeof(p_checklist) <> 'object' or pg_column_size(p_checklist) > 8000 then
    raise exception 'CLAIM_INVALID: checklist' using errcode = 'check_violation';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'CLAIM_INVALID: note too long' using errcode = 'check_violation';
  end if;

  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found then
    raise exception 'CLAIM_INVALID: claim not found' using errcode = 'check_violation';
  end if;
  if v_claim.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'CLAIM_FINAL: claim already closed' using errcode = 'check_violation';
  end if;

  select finder_id, status into v_finder, v_item_status from public.found_items where id = v_claim.found_item_id;
  if uid = v_claim.claimant_id or uid = v_finder then
    raise exception 'CLAIM_CONFLICT: reviewer is involved in this claim' using errcode = 'insufficient_privilege';
  end if;

  if p_outcome = 'approved' then
    if v_item_status not in ('reported', 'in_custody', 'matched', 'claim_pending') then
      raise exception 'CLAIM_NOT_AVAILABLE: item no longer available' using errcode = 'check_violation';
    end if;
    if v_claim.verification_level = 'enhanced' and v_claim.status <> 'verified' then
      raise exception 'CLAIM_ENHANCED: enhanced claims must be verified before approval' using errcode = 'check_violation';
    end if;
    if v_claim.verification_level = 'standard' and v_claim.status not in ('likely_owner', 'verified') then
      raise exception 'CLAIM_INVALID: approve only after likely_owner or verified' using errcode = 'check_violation';
    end if;
  end if;

  update public.claims
  set status = p_outcome, reviewed_by = uid, reviewed_at = now()
  where id = p_claim_id;

  insert into public.claim_reviews (claim_id, reviewer_id, from_status, outcome, checklist, note)
  values (p_claim_id, uid, v_claim.status, p_outcome, p_checklist, p_note);

  if p_outcome = 'approved' then
    update public.found_items set status = 'verified' where id = v_claim.found_item_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'claim.reviewed', 'claim', p_claim_id,
          jsonb_build_object('from_status', v_claim.status, 'outcome', p_outcome));

  -- Claimant-facing messages: neutral, never say which answer was wrong.
  -- Intermediate outcomes (needs_review / likely_owner / verified) send nothing.
  if p_outcome in ('insufficient', 'approved', 'rejected') then
    insert into public.notifications (user_id, type, title, message, payload)
    values (
      v_claim.claimant_id,
      case p_outcome when 'approved' then 'claim_approved'
                     when 'rejected' then 'claim_rejected'
                     else 'claim_more_info' end,
      case p_outcome when 'approved' then 'คำขอรับของผ่านการตรวจสอบแล้ว'
                     when 'rejected' then 'ผลการตรวจสอบคำขอรับของ'
                     else 'ต้องการข้อมูลเพิ่มเติม' end,
      case p_outcome
        when 'approved' then 'เจ้าหน้าที่จะแจ้งขั้นตอนและสถานที่รับของให้ทราบ กรุณาเตรียมบัตรประจำตัวมาในวันรับของ'
        when 'rejected' then 'ไม่สามารถยืนยันความเป็นเจ้าของได้จากข้อมูลที่ได้รับ หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่'
        else 'ข้อมูลที่ได้รับยังไม่เพียงพอสำหรับการยืนยัน คุณสามารถส่งข้อมูลเพิ่มเติมได้หลังครบระยะเวลารอ 24 ชั่วโมง'
      end,
      jsonb_build_object('claim_id', p_claim_id)
    );
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------
revoke all on function public.submit_claim(uuid, jsonb, uuid) from public, anon;
revoke all on function public.cancel_claim(uuid) from public, anon;
revoke all on function public.review_claim(uuid, public.claim_status_enum, jsonb, text) from public, anon;
grant execute on function public.submit_claim(uuid, jsonb, uuid) to authenticated;
grant execute on function public.cancel_claim(uuid) to authenticated;
grant execute on function public.review_claim(uuid, public.claim_status_enum, jsonb, text) to authenticated;
