-- =========================================================
-- Phase 12 — Core flows end to end (README Phase 12 "ตรวจ Core Flow ครบวงจร")
--   Flow 1: Lost → Match → Claim → Verification → Review → Secure Handover → Returned
--   Flow 2: Found → Custody → Match → Claim → Verification (enhanced) → Handover → Returned
-- Throwaway Postgres only (same setup as phase11_security.test.sql):
--   psql -d t -f supabase/tests/supabase_stub.sql
--   psql -d t -c "alter default privileges in schema public grant all on tables to anon, authenticated;
--                 alter default privileges in schema public grant all on sequences to anon, authenticated;
--                 alter default privileges in schema public grant execute on functions to anon, authenticated;"
--   psql -d t -f supabase/setup_all.sql
--   psql -d t -v ON_ERROR_STOP=1 -f supabase/tests/phase12_core_flow.test.sql
-- The matching step inserts matches/notifications the way src/lib/matching/persist.ts
-- does with the service role (no JWT), since scoring runs in the app.
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner1@t','{"full_name":"Owner1","user_type":"university_student"}','h1'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','owner2@t','{"full_name":"Owner2","user_type":"teacher_staff"}','h2'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','finder@t','{"full_name":"Finder","user_type":"university_student"}','h3'),
  ('55555555-5555-4555-8555-555555555555','staff@t','{"full_name":"Staff","user_type":"teacher_staff"}','h4'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','admin@t','{"full_name":"Admin","user_type":"teacher_staff"}','h5'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','admin2@t','{"full_name":"Admin2","user_type":"teacher_staff"}','h6');
update public.profiles set role = 'staff' where id = '55555555-5555-4555-8555-555555555555';
update public.profiles set role = 'admin' where id in ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
set session_replication_role = replica;
update public.profiles set created_at = now() - interval '200 days';   -- not "new accounts"
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

-- =========================================================
-- Flow 1: Lost → Match → Claim → Verification → Review → Secure Handover → Returned
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.lost_items (id, reporter_id, category_id, item_name, color, private_ownership_details)
select 'a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'ร่มพับสีน้ำเงิน', 'น้ำเงิน', 'ด้ามมีสติกเกอร์รูปดาว'
from public.categories where name_en = 'Other';
select pg_temp.service();

select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
insert into public.found_items (id, finder_id, category_id, general_name, color, secret_details, custody_status)
select 'f1000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'ร่มพับ', 'น้ำเงิน', 'สติกเกอร์รูปดาวที่ด้าม', 'with_finder'
from public.categories where name_en = 'Other';
select pg_temp.service();

-- Match (service role, as persist.ts)
insert into public.matches (id, lost_item_id, found_item_id, score, score_breakdown)
values ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 82, '{"category":30}');
insert into public.notifications (user_id, type, title, message, payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'potential_match', 'พบรายการที่อาจตรงกับของที่คุณแจ้งหาย',
        'มีประกาศพบของ 1 รายการที่อาจตรงกับของที่คุณแจ้งหาย',
        '{"lost_item_id":"a1000000-0000-4000-8000-000000000001","found_item_ids":["f1000000-0000-4000-8000-000000000001"],"likelihood":"high"}');

-- Owner sees the match, then claims through it
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.assert((select count(*) from public.matches) = 1, 'owner sees own match');
select pg_temp.assert((select count(*) from public.notifications where type = 'potential_match') = 1, 'owner notified of match');
select public.submit_claim('f1000000-0000-4000-8000-000000000001', '{"secret":"สติกเกอร์ดาวที่ด้าม"}', 'c1000000-0000-4000-8000-000000000001');
select id as claim1 from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000001' \gset
select pg_temp.service();
select pg_temp.assert((select status from public.claims where id = :'claim1') = 'pending', 'claim pending');
select pg_temp.assert((select verification_level from public.claims where id = :'claim1') = 'standard', 'umbrella is standard');

-- Finder hands it to staff; staff stores it
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.record_custody_transfer('f1000000-0000-4000-8000-000000000001', 'in_storage', '10000000-0000-4000-8000-000000000001', 'รับจากผู้พบ');
-- Verification + review
select public.review_claim(:'claim1', 'needs_review', '{"answers_match": true}', 'ตรวจคำตอบ');
select public.review_claim(:'claim1', 'likely_owner', '{"answers_match": true}');
select public.review_claim(:'claim1', 'approved');
select pg_temp.service();
select pg_temp.assert((select status from public.claims where id = :'claim1') = 'approved', 'claim approved');

-- Secure handover
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'claim1') as code1 \gset
select pg_temp.service();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.complete_handover(:'claim1', '000000', '10000000-0000-4000-8000-000000000001') as wrong1 \gset
select public.complete_handover(:'claim1', :'code1', '10000000-0000-4000-8000-000000000001', true, 'student_card') as done1 \gset
select pg_temp.service();
select set_config('t.wrong1', :'wrong1', false), set_config('t.done1', :'done1', false), set_config('t.claim1', :'claim1', false);
do $$
declare c uuid := current_setting('t.claim1')::uuid;
begin
  perform pg_temp.assert(current_setting('t.wrong1') = 'invalid_code', 'wrong code refused (' || current_setting('t.wrong1') || ')');
  perform pg_temp.assert(current_setting('t.done1') = 'completed', 'handover completed (' || current_setting('t.done1') || ')');
  perform pg_temp.assert((select status from public.found_items where id = 'f1000000-0000-4000-8000-000000000001') = 'returned', 'found item returned');
  perform pg_temp.assert((select custody_status from public.found_items where id = 'f1000000-0000-4000-8000-000000000001') = 'released_to_owner', 'custody released');
  perform pg_temp.assert((select status from public.lost_items where id = 'a1000000-0000-4000-8000-000000000001') = 'returned', 'linked lost report closed as returned');
  perform pg_temp.assert((select count(*) from public.handovers where claim_id = c) = 1, 'one handover record');
  perform pg_temp.assert(
    (select array_agg(to_status::text order by created_at) from public.custody_history where found_item_id = 'f1000000-0000-4000-8000-000000000001')
    @> array['with_finder', 'in_storage', 'released_to_owner'], 'custody chain with_finder → in_storage → released_to_owner');
  perform pg_temp.assert((select count(*) from public.notifications where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and type = 'handover_completed') = 1, 'owner told it is done');
  perform pg_temp.assert((select count(*) from public.notifications where user_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' and type = 'item_returned') = 1, 'finder told it was returned');
  perform pg_temp.assert(not exists (
      select 1 from unnest(array['lost_item.created','found_item.created','claim.submitted','custody.changed','claim.reviewed',
                                 'handover.code_issued','handover.code_failed','handover.completed']) a
      where not exists (select 1 from public.audit_logs l where l.action = a)), 'audit trail for every step');
  perform pg_temp.assert(not exists (select 1 from public.public_found_items where id = 'f1000000-0000-4000-8000-000000000001'), 'returned item left the public list');
  raise notice 'PASS Flow 1: Lost → Match → Claim → Verification → Review → Secure Handover → Returned';
end $$;

-- =========================================================
-- Flow 2: Found → Custody → Match → Claim → Verification (enhanced) → Handover → Returned
-- =========================================================
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
insert into public.found_items (id, finder_id, category_id, general_name, color, secret_details, serial_number, custody_status)
select 'f2000000-0000-4000-8000-000000000002', 'ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'โทรศัพท์มือถือ', 'ดำ', 'เคสลายหินอ่อน รอยร้าวมุมขวาบน', 'IMEI-3569', 'transferred_to_staff'
from public.categories where name_en = 'Mobile phone';
select pg_temp.service();
select pg_temp.assert((select is_high_value from public.categories c join public.found_items f on f.category_id = c.id
                       where f.id = 'f2000000-0000-4000-8000-000000000002'), 'phone is a high-value category');

-- Custody: staff confirms receipt before anyone claims
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.record_custody_transfer('f2000000-0000-4000-8000-000000000002', 'in_storage', '10000000-0000-4000-8000-000000000001', 'ยืนยันรับของจากผู้พบ');
select pg_temp.service();

-- Owner reports it lost afterwards; matching links them
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.lost_items (id, reporter_id, category_id, item_name, color, private_ownership_details)
select 'a2000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id, 'มือถือสีดำ', 'ดำ', 'เคสหินอ่อน จอร้าวมุมขวา'
from public.categories where name_en = 'Mobile phone';
select pg_temp.service();
insert into public.matches (id, lost_item_id, found_item_id, score, score_breakdown)
values ('c2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 76, '{"category":30}');

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.submit_claim('f2000000-0000-4000-8000-000000000002', '{"case":"ลายหินอ่อน","damage":"ร้าวมุมขวาบน"}', 'c2000000-0000-4000-8000-000000000002');
select id as claim2 from public.claims where found_item_id = 'f2000000-0000-4000-8000-000000000002' \gset
select pg_temp.service();
select pg_temp.assert((select verification_level from public.claims where id = :'claim2') = 'enhanced', 'phone claim is enhanced');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(:'claim2', 'likely_owner', '{"answers_match": true}');
select set_config('t.claim2', :'claim2', false);
do $$ begin
  begin
    perform public.review_claim(current_setting('t.claim2')::uuid, 'approved');
    raise exception 'FAIL: enhanced claim approved without the verified step';
  exception when others then
    if sqlerrm !~ 'CLAIM_ENHANCED' then raise; end if;
  end;
end $$;
select public.review_claim(:'claim2', 'verified', '{"proof_of_purchase": true}');
select public.review_claim(:'claim2', 'approved');
select pg_temp.service();

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.issue_handover_code(:'claim2') as code2 \gset
select pg_temp.service();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
do $$ begin
  begin
    perform public.complete_handover(current_setting('t.claim2')::uuid, '123456', '10000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: enhanced handover without ID check';
  exception when others then
    if sqlerrm !~ 'HANDOVER_ID_REQUIRED' then raise; end if;
  end;
end $$;
select public.complete_handover(:'claim2', :'code2', '10000000-0000-4000-8000-000000000001', true, 'national_id', 'ตรวจบัตรแล้ว') as done2 \gset
select pg_temp.service();
select set_config('t.done2', :'done2', false);
do $$
declare c uuid := current_setting('t.claim2')::uuid;
begin
  perform pg_temp.assert(current_setting('t.done2') = 'completed', 'enhanced handover completed');
  perform pg_temp.assert((select status from public.found_items where id = 'f2000000-0000-4000-8000-000000000002') = 'returned', 'phone returned');
  perform pg_temp.assert((select status from public.lost_items where id = 'a2000000-0000-4000-8000-000000000002') = 'returned', 'owner''s lost report closed');
  perform pg_temp.assert((select id_checked and id_document_type = 'national_id' from public.handovers where claim_id = c), 'ID check recorded');
  perform pg_temp.assert((select count(*) from public.claim_reviews where claim_id = c) = 3, 'three review steps recorded (likely_owner, verified, approved)');
  raise notice 'PASS Flow 2: Found → Custody → Match → Claim → Verification (enhanced) → Handover → Returned';
end $$;

-- =========================================================
-- After both flows: nothing can be re-claimed; statistics add up
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  begin
    perform public.submit_claim('f2000000-0000-4000-8000-000000000002', '{}');
    raise exception 'FAIL: returned phone claimable';
  exception when others then
    if sqlerrm !~ 'CLAIM_NOT_AVAILABLE' then raise; end if;
  end;
end $$;
select pg_temp.service();
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.admin_stats(current_date - 1, current_date)::text as stats \gset
select pg_temp.service();
select set_config('t.stats', :'stats', false);
do $$
declare s jsonb := current_setting('t.stats')::jsonb;
begin
  perform pg_temp.assert((s->>'returns')::int = 2 and (s->>'claims_approved')::int = 2, 'stats count 2 returns / 2 approvals: ' || s::text);
  raise notice 'PASS: returned items closed to new claims; statistics consistent';
end $$;

-- =========================================================
-- User roles (0027): appoint staff from the app, audited, with guard rails
-- =========================================================
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
grant execute on function pg_temp.expect_fail(text, text) to anon, authenticated;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ select public.set_user_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff', 'ทดสอบ') $q$, 'ROLE_FORBIDDEN');
select pg_temp.service();
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select pg_temp.expect_fail($q$ select public.set_user_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff', '') $q$, 'ROLE_INVALID');
select pg_temp.expect_fail($q$ select public.set_user_role('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'user', 'ลดสิทธิ์ตัวเอง') $q$, 'own role');
select public.set_user_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff', 'คำสั่งแต่งตั้งที่ 1/2569');
select public.set_user_role('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'user', 'ย้ายหน่วยงาน');
select pg_temp.service();
select pg_temp.act_as('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select pg_temp.expect_fail($q$ select public.set_user_role('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'user', 'x x x') $q$, 'ROLE_FORBIDDEN');
select pg_temp.service();
-- restore a second admin; demote D from E; E still cannot touch its own role
update public.profiles set role = 'admin' where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
select pg_temp.act_as('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select public.set_user_role('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'user', 'ทดสอบ admin คนสุดท้าย');
select pg_temp.service();
select pg_temp.act_as('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select pg_temp.expect_fail($q$ select public.set_user_role('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'user', 'ทดสอบ') $q$, 'own role');
select pg_temp.service();
set role anon;
select pg_temp.expect_fail($q$ select public.set_user_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'xxx') $q$, 'permission denied');
reset role;
do $$ begin
  perform pg_temp.assert((select role from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'staff', 'user appointed staff');
  perform pg_temp.assert((select count(*) from public.audit_logs where action = 'user.role_set' and metadata->>'reason' = 'คำสั่งแต่งตั้งที่ 1/2569') = 1, 'appointment audited with reason');
  perform pg_temp.assert((select count(*) from public.audit_logs where action = 'profile.role_changed') >= 3, 'role trigger audit');
  perform pg_temp.assert((select count(*) from public.notifications where type = 'role_changed' and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'user notified');
  raise notice 'PASS: roles changed only by admins, never own role, audited with reason';
end $$;

\o
select ' ALL PHASE 12 CORE FLOW TESTS PASSED';
