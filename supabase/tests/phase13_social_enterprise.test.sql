-- =========================================================
-- Phase 13 — Social Enterprise model (0028): voluntary thank-you + fee,
-- partner perks, funding records. Same setup as phase11/12 tests
-- (Supabase-like default grants, then setup_all.sql).
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner1@t','{"full_name":"Owner1","user_type":"university_student"}','h1'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','owner2@t','{"full_name":"Owner2","user_type":"university_student"}','h2'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','finder@t','{"full_name":"Finder","user_type":"university_student"}','h3'),
  ('55555555-5555-4555-8555-555555555555','staff@t','{"full_name":"Staff","user_type":"teacher_staff"}','h4'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','admin@t','{"full_name":"Admin","user_type":"teacher_staff"}','h5');
update public.profiles set role = 'staff' where id = '55555555-5555-4555-8555-555555555555';
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
set session_replication_role = replica;
update public.profiles set created_at = now() - interval '200 days';
set session_replication_role = origin;
insert into public.handover_locations (id, name) values ('10000000-0000-4000-8000-000000000001', 'ห้องประชาสัมพันธ์');

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', msg; end if;
end $$;
create or replace function pg_temp.expect_fail(q text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm !~ pattern then raise exception 'FAIL: % -> wrong error %', q, sqlerrm; end if;
    return;
  end;
  raise exception 'FAIL: expected rejection: %', q;
end $$;
grant execute on function pg_temp.expect_fail(text, text), pg_temp.assert(boolean, text) to anon, authenticated;

-- =========================================================
-- 1. Settings: public read, admin-only write, fee formula
-- =========================================================
set role anon;
select pg_temp.assert((select reward_fee_percent from public.platform_settings) = 2.00, 'default fee 2%');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ select public.update_platform_settings(5, 0, 20, 5000, 30, 3) $q$, 'SETTINGS_FORBIDDEN');
select pg_temp.expect_fail($q$ update public.platform_settings set reward_fee_percent = 50 $q$, 'permission denied');
select pg_temp.assert(public.reward_fee(500) = 10.00 and public.reward_fee(100) = 2.00, 'fee = 2% of amount');
select pg_temp.service();
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.update_platform_settings(2, 5, 20, 5000, 30, 3);
select pg_temp.assert(public.reward_fee(100) = 5.00 and public.reward_fee(500) = 10.00, 'fee floor 5 baht applies to small amounts');
select public.update_platform_settings(2, 0, 20, 5000, 30, 3);
select pg_temp.service();
do $$ begin raise notice 'PASS 1: settings readable by all, changed only by admin (audited); fee = max(amount×%%, floor)'; end $$;

-- =========================================================
-- 2. Partners & perks (admin), public sponsor list
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ insert into public.partners (name) values ('ร้านทดสอบ') $q$, 'row-level security');
select pg_temp.service();
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.partners (id, name, description, website, internal_note)
values ('0a000000-0000-4000-8000-000000000001', 'ร้านกาแฟหน้าสถาบัน', 'สนับสนุนโครงการคืนของ', 'https://example.org', 'ติดต่อคุณ ก. 08x');
insert into public.partner_perks (id, partner_id, name, description, quota, valid_days)
values ('0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'คูปองส่วนลด 20 บาท', 'ใช้ได้ทุกเมนู', 10, 60);
select pg_temp.expect_fail($q$ update public.partner_perks set issued_count = 0 $q$, 'permission denied');
select pg_temp.service();
set role anon;
select pg_temp.assert((select count(*) from public.public_partners) = 1, 'anon sees active partner');
select pg_temp.assert((select perks[1] from public.public_partners) = 'คูปองส่วนลด 20 บาท', 'anon sees perk name');
select pg_temp.expect_fail($q$ select internal_note from public.public_partners $q$, 'does not exist');
select pg_temp.expect_fail($q$ select * from public.partners $q$, 'permission denied');
reset role;
do $$ begin
  perform pg_temp.assert((select count(*) from public.audit_logs where action = 'reference.created' and entity_type in ('partners', 'partner_perks')) = 2, 'partner changes audited');
  raise notice 'PASS 2: partners/perks admin-only + audited; public list shows names only';
end $$;

-- =========================================================
-- 3. Pledge: owner only, validated, never public, never visible to finder
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.lost_items (id, reporter_id, item_name, private_ownership_details)
values ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'กระเป๋าสตางค์สีน้ำตาล', 'บัตรนักศึกษาชื่อ A');
select pg_temp.expect_fail($q$ select public.pledge_reward('a1000000-0000-4000-8000-000000000001', 10) $q$, 'REWARD_INVALID');
select pg_temp.expect_fail($q$ select public.pledge_reward('a1000000-0000-4000-8000-000000000001', 12.5) $q$, 'REWARD_INVALID');
select pg_temp.expect_fail($q$ select public.pledge_reward('a1000000-0000-4000-8000-000000000001', 99999) $q$, 'REWARD_INVALID');
select public.pledge_reward('a1000000-0000-4000-8000-000000000001', 300);
select public.pledge_reward('a1000000-0000-4000-8000-000000000001', 500);   -- change amount
select pg_temp.assert((select count(*) from public.my_rewards() where status = 'pledged' and amount = 500) = 1, 'one pledge, updated to 500');
select pg_temp.assert((select count(*) from public.rewards) = 0, 'owner cannot read the rewards table directly');
select pg_temp.service();

select id as pledge1 from public.rewards where lost_item_id = 'a1000000-0000-4000-8000-000000000001' \gset
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.expect_fail($q$ select public.pledge_reward('a1000000-0000-4000-8000-000000000001', 100) $q$, 'REWARD_FORBIDDEN');
select pg_temp.expect_fail(format($q$ select public.cancel_reward_pledge(%L) $q$, :'pledge1'), 'REWARD_FORBIDDEN');
select pg_temp.service();

select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
insert into public.found_items (id, finder_id, general_name, secret_details, custody_status)
values ('f1000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'กระเป๋าสตางค์', 'บัตรนักศึกษาข้างใน', 'transferred_to_staff'),
       ('f2000000-0000-4000-8000-000000000002', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'ร่ม', 'ด้ามมีสติกเกอร์', 'transferred_to_staff');
select pg_temp.assert((select count(*) from public.my_rewards()) = 0, 'finder sees nothing before the return');
select pg_temp.assert((select count(*) from public.rewards) = 0, 'finder cannot read rewards');
select pg_temp.service();
do $$ begin
  perform pg_temp.assert(not exists (select 1 from information_schema.columns
      where table_name in ('public_lost_items', 'public_found_items') and column_name ~ 'reward'), 'no reward columns in public views');
  raise notice 'PASS 3: only the owner pledges (whole baht, within limits); hidden from public and finders';
end $$;

-- =========================================================
-- 4. Return happens regardless of the reward; then payable + voucher
-- =========================================================
insert into public.matches (id, lost_item_id, found_item_id, score, score_breakdown)
values ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 80, '{}');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f1000000-0000-4000-8000-000000000001', '{"secret":"บัตรนักศึกษา"}', 'c1000000-0000-4000-8000-000000000001');
select id as claim1 from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000001' \gset
select pg_temp.service();
select set_config('t.claim1', :'claim1', false);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.record_custody_transfer('f1000000-0000-4000-8000-000000000001', 'in_storage', '10000000-0000-4000-8000-000000000001');
select public.review_claim(:'claim1', 'likely_owner');
select public.review_claim(:'claim1', 'approved');
select pg_temp.service();
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'claim1') as code1 \gset
select pg_temp.service();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.complete_handover(:'claim1', :'code1', '10000000-0000-4000-8000-000000000001', true, 'student_card') as done1 \gset
select pg_temp.service();
select set_config('t.done1', :'done1', false);
do $$
declare c uuid := current_setting('t.claim1')::uuid; r public.rewards%rowtype;
begin
  perform pg_temp.assert(current_setting('t.done1') = 'completed', 'handover completes with an unpaid pledge');
  select * into r from public.rewards where claim_id = c;
  perform pg_temp.assert(r.status = 'payable' and r.fee_amount = 10 and r.finder_amount = 490
                         and r.finder_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'pledge became payable: 500 → fee 10, finder 490');
  perform pg_temp.assert((select count(*) from public.notifications where user_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' and type = 'reward_offered') = 1, 'finder told');
  perform pg_temp.assert((select count(*) from public.notifications where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and type = 'reward_payable') = 1, 'owner asked to confirm');
  perform pg_temp.assert((select count(*) from public.perk_vouchers where claim_id = c and finder_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') = 1, 'finder got a partner voucher');
  perform pg_temp.assert((select issued_count from public.partner_perks) = 1, 'perk quota counted');
  perform pg_temp.assert(not exists (select 1 from public.notifications where to_jsonb(notifications)::text ~ '(Owner1|Finder|owner1@t|finder@t)'), 'no identities in notices');
  raise notice 'PASS 4: return completed without payment; pledge → payable after Returned; voucher issued';
end $$;

select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select pg_temp.assert((select count(*) from public.my_rewards() where my_role = 'finder' and finder_amount = 490 and claim_id is null) = 1, 'finder sees own thank-you without claim/owner');
select pg_temp.assert((select count(*) from public.my_vouchers() where status = 'issued' and code ~ '^[A-Z2-9]{8}$') = 1, 'finder sees voucher code');
select code as vcode from public.my_vouchers() \gset
select pg_temp.expect_fail(format($q$ select public.pay_reward_demo(%L) $q$, (select id from public.my_rewards() limit 1)), 'REWARD_FORBIDDEN');
select public.set_reward_choice(id, 'donate') from public.my_rewards() where my_role = 'finder';
select pg_temp.expect_fail($q$ select public.redeem_perk_voucher('AAAAAAAA') $q$, 'VOUCHER_FORBIDDEN');
select pg_temp.service();

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.assert((select count(*) from public.perk_vouchers) + (select count(*) from public.my_vouchers()) = 0, 'others cannot see the voucher');
select pg_temp.service();

-- Owner pays (demo) → staff settles (finder chose donate)
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.pay_reward_demo(id) as ref1 from public.my_rewards() where my_role = 'owner' \gset
select pg_temp.expect_fail(format($q$ select public.settle_reward(%L) $q$, (select id from public.my_rewards() limit 1)), 'REWARD_FORBIDDEN');
select pg_temp.service();
select set_config('t.ref1', :'ref1', false);
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.settle_reward(id) as settled1 from public.rewards where claim_id = :'claim1' \gset
select public.redeem_perk_voucher(:'vcode') as red1 \gset
select public.redeem_perk_voucher(:'vcode') as red2 \gset
select public.redeem_perk_voucher('ZZZZ2222') as red3 \gset
select pg_temp.service();
select set_config('t.settled1', :'settled1', false), set_config('t.red', :'red1' || ',' || :'red2' || ',' || :'red3', false);
do $$ begin
  perform pg_temp.assert(current_setting('t.ref1') ~ '^DEMO-[0-9A-F]{10}$', 'demo payment reference');
  perform pg_temp.assert(current_setting('t.settled1') = 'donated', 'finder donation recorded');
  perform pg_temp.assert(current_setting('t.red') = 'redeemed,already_redeemed,not_found', 'voucher redeem once: ' || current_setting('t.red'));
  raise notice 'PASS 5: owner pays (demo) → finder chooses → staff settles; voucher redeemed once';
end $$;

-- =========================================================
-- 6. Thank-you offered AFTER return (no pledge) + voucher limit
-- =========================================================
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.update_platform_settings(2, 0, 20, 5000, 30, 1);   -- 1 voucher / finder / 30 days
select pg_temp.service();
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.submit_claim('f2000000-0000-4000-8000-000000000002', '{"secret":"สติกเกอร์"}');
select id as claim2 from public.claims where found_item_id = 'f2000000-0000-4000-8000-000000000002' \gset
select pg_temp.expect_fail(format($q$ select public.offer_reward_after_return(%L, 100) $q$, :'claim2'), 'REWARD_FORBIDDEN');
select pg_temp.service();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.record_custody_transfer('f2000000-0000-4000-8000-000000000002', 'in_storage', '10000000-0000-4000-8000-000000000001');
select public.review_claim(:'claim2', 'likely_owner');
select public.review_claim(:'claim2', 'approved');
select pg_temp.service();
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.issue_handover_code(:'claim2') as code2 \gset
select pg_temp.service();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.complete_handover(:'claim2', :'code2', '10000000-0000-4000-8000-000000000001');
select pg_temp.service();
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail(format($q$ select public.offer_reward_after_return(%L, 100) $q$, :'claim2'), 'REWARD_FORBIDDEN');
select pg_temp.service();
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.offer_reward_after_return(:'claim2', 100);
select pg_temp.expect_fail(format($q$ select public.offer_reward_after_return(%L, 100) $q$, :'claim2'), 'REWARD_EXISTS');
select public.pay_reward_demo(id) from public.my_rewards() where my_role = 'owner';
select pg_temp.service();
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select public.set_reward_choice(id, 'receive') from public.my_rewards() where my_role = 'finder' and status = 'paid';
select pg_temp.service();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.settle_reward(id) from public.rewards where claim_id = :'claim2';
select pg_temp.service();
select set_config('t.claim2', :'claim2', false);
do $$ declare r public.rewards%rowtype; begin
  select * into r from public.rewards where claim_id = current_setting('t.claim2')::uuid;
  perform pg_temp.assert(r.status = 'disbursed' and r.fee_amount = 2 and r.finder_amount = 98, 'post-return thank-you 100 → fee 2 → finder 98');
  perform pg_temp.assert(not exists (select 1 from public.perk_vouchers where claim_id = current_setting('t.claim2')::uuid), 'voucher limit per finder respected');
  perform pg_temp.assert((select count(*) from public.notifications where type = 'reward_settled' and user_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') = 1, 'finder told money sent');
  raise notice 'PASS 6: thank-you after return works once per claim, only by the receiver; voucher limit holds';
end $$;

-- =========================================================
-- 7. Funding records, summaries, public impact, audit, guest access
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ select public.record_funding('institution_subscription', 'CDTI', 12000, current_date) $q$, 'FUNDING_FORBIDDEN');
select pg_temp.service();
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.record_funding('institution_subscription', 'สถาบันเทคโนโลยีจิตรลดา', 12000, current_date, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date);
select public.record_funding('partner_sponsorship', 'ร้านกาแฟหน้าสถาบัน', 1500, current_date, null, null, '0a000000-0000-4000-8000-000000000001');
select public.record_funding('donation', 'พิมพ์ผิด', 999, current_date) as wrong_id \gset
select public.void_funding(:'wrong_id', 'บันทึกผิด');
select public.se_summary(current_date - 1, current_date)::text as se \gset
select pg_temp.service();
select set_config('t.se', :'se', false);
do $$ declare s jsonb := current_setting('t.se')::jsonb; begin
  perform pg_temp.assert((s->>'returns')::int = 2 and (s->>'returns_with_reward')::int = 2, 'returns ' || s::text);
  perform pg_temp.assert((s->>'fee_income')::numeric = 12 and (s->>'donated_to_project')::numeric = 490 and (s->>'to_finders')::numeric = 98, 'money ' || s::text);
  perform pg_temp.assert((s->'funding'->>'institution_subscription')::numeric = 12000 and (s->'funding'->>'partner_sponsorship')::numeric = 1500
                         and s->'funding'->'donation' is null, 'funding (voided excluded) ' || s::text);
  perform pg_temp.assert((s->>'vouchers_issued')::int = 1 and (s->>'vouchers_redeemed')::int = 1, 'vouchers ' || s::text);
  raise notice 'PASS 7a: funding append-only with void; SE summary adds up (fee 12, donated 490, finders 98, subscription 12,000)';
end $$;

set role anon;
select pg_temp.assert((select items_returned = 2 and thank_yous = 2 and perks_given = 1 and active_partners = 1 from public.public_impact), 'public impact aggregates');
select pg_temp.expect_fail($q$ select * from public.rewards $q$, 'permission denied');
select pg_temp.expect_fail($q$ select * from public.funding_records $q$, 'permission denied');
select pg_temp.expect_fail($q$ select * from public.perk_vouchers $q$, 'permission denied');
select pg_temp.expect_fail($q$ select public.my_rewards() $q$, 'permission denied');
select pg_temp.expect_fail($q$ select public.se_summary(current_date, current_date) $q$, 'permission denied');
reset role;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$ select public.se_summary(current_date, current_date) $q$, 'STATS_FORBIDDEN');
select pg_temp.expect_fail($q$ insert into public.rewards (owner_id, lost_item_id, amount) values (auth.uid(), 'a1000000-0000-4000-8000-000000000001', 50) $q$, 'permission denied');
select pg_temp.expect_fail($q$ select public.make_reward_payable(gen_random_uuid(), gen_random_uuid()) $q$, 'permission denied');
select pg_temp.service();
do $$ begin
  perform pg_temp.assert(not exists (
    select 1 from unnest(array['reward.pledged','reward.payable','reward.paid','reward.choice','reward.settled','reward.offered',
                               'voucher.issued','voucher.redeemed','funding.recorded','funding.voided','settings.updated']) a
    where not exists (select 1 from public.audit_logs l where l.action = a)), 'every SE action audited');
  raise notice 'PASS 7b: guests see only public impact numbers; users cannot write rewards directly; everything audited';
end $$;

\o
select ' ALL PHASE 13 SOCIAL ENTERPRISE TESTS PASSED';
