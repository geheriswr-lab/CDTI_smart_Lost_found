-- =========================================================
-- 0028_phase13_social_enterprise.sql
-- Social Enterprise revenue model (docs/SE_BUSINESS_MODEL.md).
--
-- Principle: the core Lost & Found service is ALWAYS free. Money never
-- decides whether an item is returned.
--
--   1. Voluntary thank-you reward ("สินน้ำใจสำหรับผู้พบ") + platform fee
--      * the OWNER may pledge an amount on their lost report, or offer one
--        after getting the item back — never the finder, never required
--      * a pledge becomes payable ONLY after a completed handover (Returned)
--        of a claim linked to that lost report
--      * claim review and handover never read rewards (no condition, no bias)
--      * the amount is never shown in public listings or to finders before
--        the return (anti-"ransom", anti-staged "finds")
--      * payments run in DEMO mode (no real money) until the institution
--        approves a payment provider; the flow is complete for presentation
--      * fee = max(amount × fee_percent, fee_min), configurable by admin
--      * the finder may receive the thank-you or donate it to the project
--   2. Institutional subscription / 3. partner sponsorship are recorded in
--      funding_records (append-only, void with reason)
--   3. Partner perks: approved partners fund small perks (coupons); every
--      completed return gives the finder one voucher (limited per 30 days).
--      Partners never receive user data.
--
-- Idempotent.
-- =========================================================

-- ---------------------------------------------------------
-- 0. Settings (single row)
-- ---------------------------------------------------------
create table if not exists public.platform_settings (
  id                     int primary key default 1 check (id = 1),
  reward_fee_percent     numeric(5,2) not null default 2.00 check (reward_fee_percent between 0 and 20),
  reward_fee_min         numeric(10,2) not null default 0 check (reward_fee_min between 0 and 100),
  reward_min             int not null default 20 check (reward_min >= 1),
  reward_max             int not null default 5000 check (reward_max between 1 and 100000),
  reward_offer_days      int not null default 30 check (reward_offer_days between 1 and 365),
  vouchers_per_finder_30d int not null default 3 check (vouchers_per_finder_30d between 0 and 50),
  payment_mode           text not null default 'demo' check (payment_mode in ('demo')),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles(id),
  check (reward_min <= reward_max)
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings for select using (true);
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to anon, authenticated;

-- ---------------------------------------------------------
-- 1. Rewards
-- ---------------------------------------------------------
create table if not exists public.rewards (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id),
  lost_item_id   uuid references public.lost_items(id),
  claim_id       uuid unique references public.claims(id),
  finder_id      uuid references public.profiles(id),
  amount         numeric(10,2) not null check (amount > 0 and amount = trunc(amount)),
  fee_percent    numeric(5,2),
  fee_amount     numeric(10,2) check (fee_amount is null or fee_amount >= 0),
  finder_amount  numeric(10,2) check (finder_amount is null or finder_amount >= 0),
  status         text not null default 'pledged'
                 check (status in ('pledged', 'payable', 'paid', 'disbursed', 'donated', 'cancelled')),
  finder_choice  text check (finder_choice is null or finder_choice in ('receive', 'donate')),
  payment_ref    text,
  cancel_reason  text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  payable_at     timestamptz,
  paid_at        timestamptz,
  settled_at     timestamptz,
  check (lost_item_id is not null or claim_id is not null),
  check (status = 'pledged' or status = 'cancelled' or (claim_id is not null and finder_id is not null and fee_amount is not null))
);
create unique index if not exists rewards_one_pledge_per_lost_item
  on public.rewards (lost_item_id) where status = 'pledged';
create index if not exists rewards_owner_idx on public.rewards (owner_id);
create index if not exists rewards_finder_idx on public.rewards (finder_id);
create index if not exists rewards_status_idx on public.rewards (status);

alter table public.rewards enable row level security;
-- Owners/finders read through my_rewards() (no identities); staff read the table.
drop policy if exists rewards_select_staff on public.rewards;
create policy rewards_select_staff on public.rewards for select using (public.is_staff_or_admin());
revoke all on public.rewards from anon, authenticated;
grant select on public.rewards to authenticated;

drop trigger if exists trg_rewards_updated_at on public.rewards;
create trigger trg_rewards_updated_at before update on public.rewards
  for each row execute function public.set_updated_at();

-- Fee for an amount under the current settings.
create or replace function public.reward_fee(p_amount numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select least(p_amount, greatest(round(p_amount * s.reward_fee_percent / 100, 2), s.reward_fee_min))
  from public.platform_settings s where s.id = 1;
$$;

create or replace function public.assert_reward_amount(p_amount numeric)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.platform_settings%rowtype;
begin
  select * into s from public.platform_settings where id = 1;
  if p_amount is null or p_amount <> trunc(p_amount) or p_amount < s.reward_min or p_amount > s.reward_max then
    raise exception 'REWARD_INVALID: amount must be a whole number between % and %', s.reward_min, s.reward_max
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Owner pledges (or changes) a thank-you on their own open lost report.
create or replace function public.pledge_reward(p_lost_item_id uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_item public.lost_items%rowtype;
  v_id uuid;
begin
  if uid is null then
    raise exception 'REWARD_FORBIDDEN: login required' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.profiles where id = uid and is_restricted) then
    raise exception 'REWARD_FORBIDDEN: account restricted' using errcode = 'insufficient_privilege';
  end if;
  select * into v_item from public.lost_items where id = p_lost_item_id;
  if not found or v_item.reporter_id <> uid then
    raise exception 'REWARD_FORBIDDEN: not your lost report' using errcode = 'insufficient_privilege';
  end if;
  if v_item.status not in ('reported', 'matched', 'claim_pending') then
    raise exception 'REWARD_CLOSED: lost report is closed' using errcode = 'check_violation';
  end if;
  perform public.assert_reward_amount(p_amount);

  select id into v_id from public.rewards where lost_item_id = p_lost_item_id and status = 'pledged' for update;
  if found then
    update public.rewards set amount = p_amount where id = v_id;
  else
    insert into public.rewards (owner_id, lost_item_id, amount) values (uid, p_lost_item_id, p_amount)
    returning id into v_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'reward.pledged', 'reward', v_id, jsonb_build_object('amount', p_amount));
  return v_id;
end;
$$;

create or replace function public.cancel_reward_pledge(p_reward_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  update public.rewards set status = 'cancelled', cancel_reason = 'ผู้ให้ยกเลิกก่อนได้ของคืน'
  where id = p_reward_id and owner_id = uid and status = 'pledged';
  if not found then
    raise exception 'REWARD_FORBIDDEN: no open pledge' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'reward.pledge_cancelled', 'reward', p_reward_id, '{}'::jsonb);
end;
$$;

-- Internal: pledge/offer → payable for a completed handover.
create or replace function public.make_reward_payable(p_reward_id uuid, p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.rewards%rowtype;
  v_finder uuid;
  v_fee numeric;
  v_pct numeric;
begin
  select * into v_reward from public.rewards where id = p_reward_id for update;
  select fi.finder_id into v_finder
  from public.claims c join public.found_items fi on fi.id = c.found_item_id where c.id = p_claim_id;

  if v_finder is null or v_finder = v_reward.owner_id then
    update public.rewards set status = 'cancelled', claim_id = p_claim_id,
           cancel_reason = 'ไม่มีผู้พบที่รับสินน้ำใจได้' where id = p_reward_id;
    return;
  end if;

  select reward_fee_percent into v_pct from public.platform_settings where id = 1;
  v_fee := public.reward_fee(v_reward.amount);
  update public.rewards
     set status = 'payable', claim_id = p_claim_id, finder_id = v_finder,
         fee_percent = v_pct, fee_amount = v_fee, finder_amount = v_reward.amount - v_fee, payable_at = now()
   where id = p_reward_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'reward.payable', 'reward', p_reward_id,
          jsonb_build_object('amount', v_reward.amount, 'fee', v_fee));

  insert into public.notifications (user_id, type, title, message, payload) values
    (v_reward.owner_id, 'reward_payable', 'ยืนยันสินน้ำใจสำหรับผู้พบ',
     format('คุณตั้งสินน้ำใจ %s บาทไว้สำหรับผู้พบ หากยังต้องการมอบ กดยืนยันได้ที่หน้าคำขอรับของ (ไม่บังคับ)', v_reward.amount::int),
     jsonb_build_object('claim_id', p_claim_id)),
    (v_finder, 'reward_offered', 'เจ้าของมอบสินน้ำใจขอบคุณ',
     format('เจ้าของของที่คุณช่วยส่งคืนมอบสินน้ำใจ %s บาท (หลังหักค่าดำเนินการระบบ) คุณเลือกรับหรือมอบให้โครงการได้ในหน้า "สินน้ำใจและสิทธิประโยชน์"',
            to_char(v_reward.amount - v_fee, 'FM999990.00')),
     '{}'::jsonb);
end;
$$;

-- Owner offers a thank-you AFTER getting the item back (no pledge needed).
create or replace function public.offer_reward_after_return(p_claim_id uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_done timestamptz;
  v_days int;
  v_id uuid;
begin
  select h.created_at into v_done
  from public.handovers h join public.claims c on c.id = h.claim_id
  where h.claim_id = p_claim_id and c.claimant_id = uid;
  if v_done is null then
    raise exception 'REWARD_FORBIDDEN: only after you received the item' using errcode = 'insufficient_privilege';
  end if;
  select reward_offer_days into v_days from public.platform_settings where id = 1;
  if v_done < now() - make_interval(days => v_days) then
    raise exception 'REWARD_CLOSED: offer period ended' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.rewards where claim_id = p_claim_id) then
    raise exception 'REWARD_EXISTS: a thank-you already exists for this claim' using errcode = 'check_violation';
  end if;
  perform public.assert_reward_amount(p_amount);

  insert into public.rewards (owner_id, claim_id, amount) values (uid, p_claim_id, p_amount) returning id into v_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'reward.offered', 'reward', v_id, jsonb_build_object('amount', p_amount));
  perform public.make_reward_payable(v_id, p_claim_id);
  return v_id;
end;
$$;

-- Owner confirms payment. DEMO: no money moves; a reference is recorded.
create or replace function public.pay_reward_demo(p_reward_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  v_ref text := 'DEMO-' || upper(encode(gen_random_bytes(5), 'hex'));
begin
  update public.rewards set status = 'paid', paid_at = now(), payment_ref = v_ref
  where id = p_reward_id and owner_id = uid and status = 'payable';
  if not found then
    raise exception 'REWARD_FORBIDDEN: nothing to pay' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'reward.paid', 'reward', p_reward_id, jsonb_build_object('mode', 'demo'));
  return v_ref;
end;
$$;

-- Finder: receive the thank-you or donate it to the project.
create or replace function public.set_reward_choice(p_reward_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if p_choice not in ('receive', 'donate') then
    raise exception 'REWARD_INVALID: choice' using errcode = 'check_violation';
  end if;
  update public.rewards set finder_choice = p_choice
  where id = p_reward_id and finder_id = uid and status in ('payable', 'paid');
  if not found then
    raise exception 'REWARD_FORBIDDEN: not your thank-you' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'reward.choice', 'reward', p_reward_id, jsonb_build_object('choice', p_choice));
end;
$$;

-- Staff records that a paid thank-you was settled (paid out / donated).
create or replace function public.settle_reward(p_reward_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v public.rewards%rowtype;
  v_status text;
begin
  if not public.is_staff_or_admin() then
    raise exception 'REWARD_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.rewards where id = p_reward_id for update;
  if not found or v.status <> 'paid' then
    raise exception 'REWARD_INVALID: only paid thank-yous can be settled' using errcode = 'check_violation';
  end if;
  if uid in (v.owner_id, v.finder_id) then
    raise exception 'REWARD_CONFLICT: staff involved' using errcode = 'insufficient_privilege';
  end if;
  v_status := case when v.finder_choice = 'donate' then 'donated' else 'disbursed' end;
  update public.rewards set status = v_status, settled_at = now() where id = p_reward_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'reward.settled', 'reward', p_reward_id, jsonb_build_object('to', v_status));
  if v_status = 'disbursed' then
    insert into public.notifications (user_id, type, title, message, payload)
    values (v.finder_id, 'reward_settled', 'โอนสินน้ำใจแล้ว',
            format('เจ้าหน้าที่บันทึกการโอนสินน้ำใจ %s บาทให้คุณแล้ว ขอบคุณที่ช่วยส่งคืนทรัพย์สิน', to_char(v.finder_amount, 'FM999990.00')),
            '{}'::jsonb);
  end if;
  return v_status;
end;
$$;

create or replace function public.cancel_reward_admin(p_reward_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'REWARD_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'REWARD_INVALID: reason required' using errcode = 'check_violation';
  end if;
  update public.rewards set status = 'cancelled', cancel_reason = btrim(p_reason)
  where id = p_reward_id and status in ('pledged', 'payable', 'paid');
  if not found then
    raise exception 'REWARD_INVALID: cannot cancel' using errcode = 'check_violation';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'reward.cancelled', 'reward', p_reward_id, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- What the caller may see about their own thank-yous (no identities).
create or replace function public.my_rewards()
returns table (
  id uuid, my_role text, item_name text, claim_id uuid, lost_item_id uuid,
  amount numeric, fee_amount numeric, finder_amount numeric,
  status text, finder_choice text, payment_ref text, created_at timestamptz, payable_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, 'owner', coalesce(li.item_name, fi.general_name), r.claim_id, r.lost_item_id,
         r.amount, r.fee_amount, r.finder_amount, r.status, r.finder_choice, r.payment_ref, r.created_at, r.payable_at
  from public.rewards r
  left join public.lost_items li on li.id = r.lost_item_id
  left join public.claims c on c.id = r.claim_id
  left join public.found_items fi on fi.id = c.found_item_id
  where r.owner_id = auth.uid()
  union all
  select r.id, 'finder', fi.general_name, null, null,
         r.amount, r.fee_amount, r.finder_amount, r.status, r.finder_choice, null, r.created_at, r.payable_at
  from public.rewards r
  join public.claims c on c.id = r.claim_id
  join public.found_items fi on fi.id = c.found_item_id
  where r.finder_id = auth.uid() and r.status <> 'pledged' and r.status <> 'cancelled'
  order by 12 desc;
$$;

-- ---------------------------------------------------------
-- 2. Partners, perks, vouchers
-- ---------------------------------------------------------
create table if not exists public.partners (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  description  text check (description is null or char_length(description) <= 500),
  website      text check (website is null or website ~ '^https://[^\s]{4,}$' and char_length(website) <= 300),
  internal_note text check (internal_note is null or char_length(internal_note) <= 1000),  -- staff only
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create table if not exists public.partner_perks (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id),
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  description   text check (description is null or char_length(description) <= 500),
  quota         int check (quota is null or quota >= 0),
  issued_count  int not null default 0 check (issued_count >= 0),
  valid_days    int not null default 60 check (valid_days between 1 and 365),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create table if not exists public.perk_vouchers (
  id           uuid primary key default gen_random_uuid(),
  perk_id      uuid not null references public.partner_perks(id),
  finder_id    uuid not null references public.profiles(id),
  claim_id     uuid not null unique references public.claims(id),
  code         text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  status       text not null default 'issued' check (status in ('issued', 'redeemed', 'revoked')),
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_at  timestamptz,
  redeemed_by  uuid references public.profiles(id)
);
create index if not exists perk_vouchers_finder_idx on public.perk_vouchers (finder_id, issued_at);

alter table public.partners enable row level security;
alter table public.partner_perks enable row level security;
alter table public.perk_vouchers enable row level security;

drop policy if exists partners_select_staff on public.partners;
create policy partners_select_staff on public.partners for select using (public.is_staff_or_admin());
drop policy if exists partners_write_admin on public.partners;
create policy partners_write_admin on public.partners for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists partner_perks_select_staff on public.partner_perks;
create policy partner_perks_select_staff on public.partner_perks for select using (public.is_staff_or_admin());
drop policy if exists partner_perks_write_admin on public.partner_perks;
create policy partner_perks_write_admin on public.partner_perks for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists perk_vouchers_select_own_or_staff on public.perk_vouchers;
create policy perk_vouchers_select_own_or_staff on public.perk_vouchers
  for select using (finder_id = auth.uid() or public.is_staff_or_admin());

revoke all on public.partners, public.partner_perks, public.perk_vouchers from anon, authenticated;
grant select, insert, update on public.partners, public.partner_perks to authenticated;  -- RLS: admin writes
grant select on public.perk_vouchers to authenticated;
-- issued_count is maintained by the system only
revoke update on public.partner_perks from authenticated;
grant update (name, description, quota, valid_days, is_active) on public.partner_perks to authenticated;

drop trigger if exists trg_partners_audit on public.partners;
create trigger trg_partners_audit after insert or update or delete on public.partners
  for each row execute function public.audit_reference_change();
drop trigger if exists trg_partner_perks_audit on public.partner_perks;
create trigger trg_partner_perks_audit after insert or update or delete on public.partner_perks
  for each row execute function public.audit_reference_change();

-- Public sponsor list: names, descriptions, active perk names. Nothing else.
create or replace view public.public_partners
with (security_invoker = false) as
select p.id, p.name, p.description, p.website,
       coalesce((select array_agg(pp.name order by pp.created_at)
                 from public.partner_perks pp
                 where pp.partner_id = p.id and pp.is_active
                   and (pp.quota is null or pp.issued_count < pp.quota)), '{}') as perks
from public.partners p
where p.is_active;
revoke all on public.public_partners from anon, authenticated;
grant select on public.public_partners to anon, authenticated;

-- Internal: one voucher per completed return, for the finder.
create or replace function public.issue_perk_voucher(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_finder uuid;
  v_owner uuid;
  v_perk public.partner_perks%rowtype;
  v_partner text;
  v_limit int;
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  i int;
begin
  select fi.finder_id, c.claimant_id into v_finder, v_owner
  from public.claims c join public.found_items fi on fi.id = c.found_item_id where c.id = p_claim_id;
  if v_finder is null or v_finder = v_owner then return; end if;
  if exists (select 1 from public.perk_vouchers where claim_id = p_claim_id) then return; end if;

  select vouchers_per_finder_30d into v_limit from public.platform_settings where id = 1;
  if (select count(*) from public.perk_vouchers
      where finder_id = v_finder and issued_at > now() - interval '30 days' and status <> 'revoked') >= v_limit then
    return;
  end if;

  select pp.* into v_perk
  from public.partner_perks pp join public.partners p on p.id = pp.partner_id
  where pp.is_active and p.is_active and (pp.quota is null or pp.issued_count < pp.quota)
  order by pp.issued_count, pp.created_at
  limit 1
  for update of pp skip locked;
  if not found then return; end if;
  select name into v_partner from public.partners where id = v_perk.partner_id;

  loop
    v_bytes := gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.perk_vouchers where code = v_code);
  end loop;

  insert into public.perk_vouchers (perk_id, finder_id, claim_id, code, expires_at)
  values (v_perk.id, v_finder, p_claim_id, v_code, now() + make_interval(days => v_perk.valid_days));
  update public.partner_perks set issued_count = issued_count + 1 where id = v_perk.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'voucher.issued', 'partner_perks', v_perk.id, jsonb_build_object('name', v_perk.name));
  insert into public.notifications (user_id, type, title, message, payload)
  values (v_finder, 'perk_voucher', 'ขอบคุณที่ช่วยส่งคืนทรัพย์สิน',
          format('คุณได้รับสิทธิ์ "%s" จาก %s ดูรหัสคูปองได้ในหน้า "สินน้ำใจและสิทธิประโยชน์"', v_perk.name, v_partner),
          '{}'::jsonb);
end;
$$;

create or replace function public.redeem_perk_voucher(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v public.perk_vouchers%rowtype;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_staff_or_admin() then
    raise exception 'VOUCHER_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.perk_vouchers where code = v_code for update;
  if not found then return 'not_found'; end if;
  if v.finder_id = uid then
    raise exception 'VOUCHER_CONFLICT: your own voucher' using errcode = 'insufficient_privilege';
  end if;
  if v.status = 'redeemed' then return 'already_redeemed'; end if;
  if v.status = 'revoked' then return 'revoked'; end if;
  if v.expires_at <= now() then return 'expired'; end if;
  update public.perk_vouchers set status = 'redeemed', redeemed_at = now(), redeemed_by = uid where id = v.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'voucher.redeemed', 'partner_perks', v.perk_id, '{}'::jsonb);
  return 'redeemed';
end;
$$;

create or replace function public.revoke_perk_voucher(p_voucher_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'VOUCHER_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'VOUCHER_INVALID: reason required' using errcode = 'check_violation';
  end if;
  update public.perk_vouchers set status = 'revoked' where id = p_voucher_id and status = 'issued';
  if not found then
    raise exception 'VOUCHER_INVALID: cannot revoke' using errcode = 'check_violation';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'voucher.revoked', 'perk_voucher', p_voucher_id, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

create or replace function public.my_vouchers()
returns table (id uuid, perk_name text, perk_description text, partner_name text,
               code text, status text, issued_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, pp.name, pp.description, p.name, v.code,
         case when v.status = 'issued' and v.expires_at <= now() then 'expired' else v.status end,
         v.issued_at, v.expires_at
  from public.perk_vouchers v
  join public.partner_perks pp on pp.id = v.perk_id
  join public.partners p on p.id = pp.partner_id
  where v.finder_id = auth.uid()
  order by v.issued_at desc;
$$;

-- ---------------------------------------------------------
-- 3. Handover → reward payable + perk voucher (after the fact only)
-- ---------------------------------------------------------
create or replace function public.se_on_handover()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lost uuid;
  v_reward uuid;
begin
  select m.lost_item_id into v_lost
  from public.claims c join public.matches m on m.id = c.match_id where c.id = new.claim_id;
  if v_lost is not null then
    select r.id into v_reward from public.rewards r
    where r.lost_item_id = v_lost and r.owner_id = new.received_by and r.status = 'pledged';
    if v_reward is not null then
      perform public.make_reward_payable(v_reward, new.claim_id);
    end if;
  end if;
  perform public.issue_perk_voucher(new.claim_id);
  return null;
end;
$$;

drop trigger if exists trg_handovers_se on public.handovers;
create trigger trg_handovers_se after insert on public.handovers
  for each row execute function public.se_on_handover();

-- ---------------------------------------------------------
-- 4. Funding records (institution subscription, sponsorship, donation)
-- ---------------------------------------------------------
create table if not exists public.funding_records (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('institution_subscription', 'partner_sponsorship', 'donation')),
  source_name   text not null check (char_length(btrim(source_name)) between 2 and 200),
  partner_id    uuid references public.partners(id),
  amount        numeric(12,2) not null check (amount > 0),
  period_start  date,
  period_end    date,
  received_on   date not null default (now() at time zone 'Asia/Bangkok')::date,
  note          text check (note is null or char_length(note) <= 500),
  is_void       boolean not null default false,
  void_reason   text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  check (period_start is null or period_end is null or period_start <= period_end)
);
alter table public.funding_records enable row level security;
drop policy if exists funding_records_select_staff on public.funding_records;
create policy funding_records_select_staff on public.funding_records for select using (public.is_staff_or_admin());
revoke all on public.funding_records from anon, authenticated;
grant select on public.funding_records to authenticated;

create or replace function public.record_funding(
  p_kind text, p_source_name text, p_amount numeric, p_received_on date,
  p_period_start date default null, p_period_end date default null,
  p_partner_id uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'FUNDING_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  insert into public.funding_records (kind, source_name, partner_id, amount, period_start, period_end, received_on, note, created_by)
  values (p_kind, btrim(p_source_name), p_partner_id, p_amount, p_period_start, p_period_end,
          coalesce(p_received_on, (now() at time zone 'Asia/Bangkok')::date), nullif(btrim(coalesce(p_note, '')), ''), uid)
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'funding.recorded', 'funding', v_id, jsonb_build_object('kind', p_kind, 'amount', p_amount));
  return v_id;
end;
$$;

create or replace function public.void_funding(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'FUNDING_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'FUNDING_INVALID: reason required' using errcode = 'check_violation';
  end if;
  update public.funding_records set is_void = true, void_reason = btrim(p_reason) where id = p_id and not is_void;
  if not found then
    raise exception 'FUNDING_INVALID: not found' using errcode = 'check_violation';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'funding.voided', 'funding', p_id, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

create or replace function public.update_platform_settings(
  p_fee_percent numeric, p_fee_min numeric, p_reward_min int, p_reward_max int,
  p_offer_days int, p_vouchers_per_finder int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'SETTINGS_FORBIDDEN: admin only' using errcode = 'insufficient_privilege';
  end if;
  update public.platform_settings
     set reward_fee_percent = p_fee_percent, reward_fee_min = p_fee_min,
         reward_min = p_reward_min, reward_max = p_reward_max,
         reward_offer_days = p_offer_days, vouchers_per_finder_30d = p_vouchers_per_finder,
         updated_at = now(), updated_by = uid
   where id = 1;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (uid, 'settings.updated', 'settings', null, jsonb_build_object(
    'fee_percent', p_fee_percent, 'fee_min', p_fee_min, 'reward_min', p_reward_min, 'reward_max', p_reward_max,
    'offer_days', p_offer_days, 'vouchers_per_finder', p_vouchers_per_finder));
end;
$$;

-- ---------------------------------------------------------
-- 5. Summaries
-- ---------------------------------------------------------
create or replace function public.se_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Bangkok');
  v_to   timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Bangkok');
  v jsonb;
begin
  if not public.is_staff_or_admin() then
    raise exception 'STATS_FORBIDDEN: staff only' using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'STATS_INVALID: date range' using errcode = 'check_violation';
  end if;
  select jsonb_build_object(
    'returns', (select count(*) from public.handovers where created_at >= v_from and created_at < v_to),
    'returns_with_reward', (select count(*) from public.rewards r join public.handovers h on h.claim_id = r.claim_id
                            where h.created_at >= v_from and h.created_at < v_to and r.status <> 'cancelled'),
    'pledges_open', (select count(*) from public.rewards where status = 'pledged'),
    'pledged_amount_open', (select coalesce(sum(amount), 0) from public.rewards where status = 'pledged'),
    'rewards_payable', (select count(*) from public.rewards where status = 'payable'),
    'rewards_paid_amount', (select coalesce(sum(amount), 0) from public.rewards
                            where status in ('paid', 'disbursed', 'donated') and paid_at >= v_from and paid_at < v_to),
    'fee_income', (select coalesce(sum(fee_amount), 0) from public.rewards
                   where status in ('paid', 'disbursed', 'donated') and paid_at >= v_from and paid_at < v_to),
    'to_finders', (select coalesce(sum(finder_amount), 0) from public.rewards
                   where status = 'disbursed' and settled_at >= v_from and settled_at < v_to),
    'donated_to_project', (select coalesce(sum(finder_amount), 0) from public.rewards
                           where status = 'donated' and settled_at >= v_from and settled_at < v_to),
    'awaiting_settlement', (select count(*) from public.rewards where status = 'paid'),
    'vouchers_issued', (select count(*) from public.perk_vouchers where issued_at >= v_from and issued_at < v_to),
    'vouchers_redeemed', (select count(*) from public.perk_vouchers where redeemed_at >= v_from and redeemed_at < v_to),
    'active_partners', (select count(*) from public.partners where is_active),
    'funding', (select coalesce(jsonb_object_agg(kind, total), '{}'::jsonb) from (
                  select kind, sum(amount) as total from public.funding_records
                  where not is_void and received_on between p_from and p_to group by kind) f)
  ) into v;
  return v;
end;
$$;

-- Public impact numbers (aggregates only) for /impact.
create or replace view public.public_impact
with (security_invoker = false) as
select
  (select count(*) from public.handovers) as items_returned,
  (select count(*) from public.handovers where created_at > now() - interval '30 days') as items_returned_30d,
  (select count(*) from public.rewards where status in ('paid', 'disbursed', 'donated')) as thank_yous,
  (select coalesce(sum(finder_amount), 0) from public.rewards where status = 'disbursed') as thank_you_to_finders,
  (select coalesce(sum(finder_amount), 0) from public.rewards where status = 'donated') as donated_by_finders,
  (select count(*) from public.perk_vouchers where status <> 'revoked') as perks_given,
  (select count(*) from public.partners where is_active) as active_partners,
  (select reward_fee_percent from public.platform_settings where id = 1) as reward_fee_percent;
revoke all on public.public_impact from anon, authenticated;
grant select on public.public_impact to anon, authenticated;

-- ---------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------
revoke all on function public.reward_fee(numeric) from public, anon;
revoke all on function public.assert_reward_amount(numeric) from public, anon, authenticated;
revoke all on function public.make_reward_payable(uuid, uuid) from public, anon, authenticated;
revoke all on function public.issue_perk_voucher(uuid) from public, anon, authenticated;
revoke all on function public.se_on_handover() from public, anon, authenticated;
revoke all on function public.pledge_reward(uuid, numeric) from public, anon;
revoke all on function public.cancel_reward_pledge(uuid) from public, anon;
revoke all on function public.offer_reward_after_return(uuid, numeric) from public, anon;
revoke all on function public.pay_reward_demo(uuid) from public, anon;
revoke all on function public.set_reward_choice(uuid, text) from public, anon;
revoke all on function public.settle_reward(uuid) from public, anon;
revoke all on function public.cancel_reward_admin(uuid, text) from public, anon;
revoke all on function public.my_rewards() from public, anon;
revoke all on function public.redeem_perk_voucher(text) from public, anon;
revoke all on function public.revoke_perk_voucher(uuid, text) from public, anon;
revoke all on function public.my_vouchers() from public, anon;
revoke all on function public.record_funding(text, text, numeric, date, date, date, uuid, text) from public, anon;
revoke all on function public.void_funding(uuid, text) from public, anon;
revoke all on function public.update_platform_settings(numeric, numeric, int, int, int, int) from public, anon;
revoke all on function public.se_summary(date, date) from public, anon;

grant execute on function public.reward_fee(numeric) to authenticated;
grant execute on function public.pledge_reward(uuid, numeric) to authenticated;
grant execute on function public.cancel_reward_pledge(uuid) to authenticated;
grant execute on function public.offer_reward_after_return(uuid, numeric) to authenticated;
grant execute on function public.pay_reward_demo(uuid) to authenticated;
grant execute on function public.set_reward_choice(uuid, text) to authenticated;
grant execute on function public.settle_reward(uuid) to authenticated;
grant execute on function public.cancel_reward_admin(uuid, text) to authenticated;
grant execute on function public.my_rewards() to authenticated;
grant execute on function public.redeem_perk_voucher(text) to authenticated;
grant execute on function public.revoke_perk_voucher(uuid, text) to authenticated;
grant execute on function public.my_vouchers() to authenticated;
grant execute on function public.record_funding(text, text, numeric, date, date, date, uuid, text) to authenticated;
grant execute on function public.void_funding(uuid, text) to authenticated;
grant execute on function public.update_platform_settings(numeric, numeric, int, int, int, int) to authenticated;
grant execute on function public.se_summary(date, date) to authenticated;
