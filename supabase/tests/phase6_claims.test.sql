-- =========================================================
-- Phase 6 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase6_claims.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

-- Supabase default grants, then re-apply every migration-level revoke
grant all on all tables in schema public to anon, authenticated;
revoke all on public.lost_items, public.found_items, public.matches, public.notifications,
              public.claims, public.claim_reviews, public.claim_evidence from anon;
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
revoke insert, update, delete on public.claims, public.claim_reviews from authenticated;
grant select, insert on storage.objects to authenticated;
create policy stub_objects_all on storage.objects for all using (true) with check (true);

-- Users: claimant A, claimant B, finder F, staff S, admin D, restricted R
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@t','{"full_name":"A","user_type":"university_student"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@t','{"full_name":"B","user_type":"university_student"}'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','f@t','{"full_name":"F","user_type":"university_student"}'),
  ('55555555-5555-4555-8555-555555555555','s@t','{"full_name":"S","user_type":"teacher_staff"}'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','d@t','{"full_name":"D","user_type":"teacher_staff"}'),
  ('99999999-9999-4999-8999-999999999999','r@t','{"full_name":"R","user_type":"external_visitor"}');
set session_replication_role = replica;
update public.profiles set role = 'staff' where id = '55555555-5555-4555-8555-555555555555';
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.profiles set is_restricted = true where id = '99999999-9999-4999-8999-999999999999';
set session_replication_role = origin;

-- Found items: phone (high value -> enhanced) and keys (standard)
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, serial_number, custody_status)
select 'f0000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'โทรศัพท์', 'สติกเกอร์แมว', 'SN-1', 'with_finder'
from public.categories where name_en = 'Mobile phone';
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, custody_status)
select 'f0000000-0000-4000-8000-000000000002','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'กุญแจ', 'พวงกุญแจรูปปลา', 'with_finder'
from public.categories where name_en = 'Keys';
insert into public.found_items (id, finder_id, general_name, secret_details, custody_status, status)
values ('f0000000-0000-4000-8000-000000000003','ffffffff-ffff-4fff-8fff-ffffffffffff','ร่ม','x','released_to_owner','returned');

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.expect_fail(sql text, label text, pattern text default null) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if pattern is not null and sqlerrm !~ pattern then
      raise exception 'FAIL: % rejected with wrong error: %', label, sqlerrm;
    end if;
    raise notice 'PASS (rejected): % -> %', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: expected rejection: %', label;
end $$;

create or replace function pg_temp.backdate(claim uuid) returns void language sql as $$
  update public.claims set last_attempt_at = now() - interval '25 hours' where id = claim $$;

-- =========================================================
-- 1. Direct writes are blocked (the Phase 1 hole)
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$
  insert into public.claims (claimant_id, found_item_id, status)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','f0000000-0000-4000-8000-000000000002','approved') $q$,
  'claimant inserts an approved claim directly', 'permission denied');

-- =========================================================
-- 2. submit_claim happy path + field rules
-- =========================================================
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"identifying_marks":"สติกเกอร์แมว"}');
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"keychain":"ปลา"}');
reset role;
do $$ begin
  if (select verification_level from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001') <> 'enhanced' then
    raise exception 'FAIL: phone claim should be enhanced'; end if;
  if (select verification_level from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002') <> 'standard' then
    raise exception 'FAIL: keys claim should be standard'; end if;
  if (select count(*) from public.notifications where type = 'claim_review_required') <> 4 then
    raise exception 'FAIL: staff+admin should each get 2 review notifications'; end if;
  if exists (select 1 from public.audit_logs where action = 'claim.submitted' and metadata::text like '%สติกเกอร์%') then
    raise exception 'FAIL: audit leaks answers'; end if;
  raise notice 'PASS: claims created (enhanced/standard), staff notified, audit has no answers';
end $$;

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{}') $q$,
  'resubmit while claim is active', 'CLAIM_ALREADY_ACTIVE');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000003', '{}') $q$,
  'claim a returned item', 'CLAIM_NOT_AVAILABLE');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000002', '"not an object"') $q$,
  'answers not a JSON object', 'CLAIM_');

-- Claimant cannot read claim_reviews, finder data or other claimants
do $$ begin
  if (select count(*) from public.found_items) <> 0 then raise exception 'FAIL: claimant reads found_items'; end if;
  raise notice 'PASS: claimant cannot read found_items (secret_details)';
end $$;
reset role;

select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{}') $q$,
  'finder claims own item', 'CLAIM_NOT_ALLOWED');
do $$ begin
  if (select count(*) from public.claims) <> 0 then raise exception 'FAIL: finder can see claims'; end if;
  raise notice 'PASS: finder cannot see who claimed their item';
end $$;
reset role;

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{}') $q$,
  'restricted account claims', 'CLAIM_NOT_ALLOWED');
reset role;

-- B only sees own claims
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  if (select count(*) from public.claims) <> 0 then raise exception 'FAIL: B sees A''s claims'; end if;
  raise notice 'PASS: other users cannot see A''s claims';
end $$;
reset role;

-- =========================================================
-- 3. Reviews: staff only, conflict of interest, enhanced two-step
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$
  select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'), 'approved') $q$,
  'claimant reviews own claim', 'CLAIM_FORBIDDEN');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
-- enhanced phone claim: approving straight from pending is refused
select pg_temp.expect_fail($q$
  select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001'), 'approved') $q$,
  'approve enhanced claim without verified step', 'CLAIM_ENHANCED');
select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001'),
  'verified', '{"answers_match_secret":"yes"}', 'ตรงกับจุดสังเกต');
select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001'), 'approved');
reset role;

do $$ begin
  if (select status from public.found_items where id = 'f0000000-0000-4000-8000-000000000001') <> 'verified' then
    raise exception 'FAIL: approving should mark found item verified'; end if;
  if (select count(*) from public.claim_reviews) <> 2 then raise exception 'FAIL: expected 2 review rows'; end if;
  if (select message from public.notifications where type = 'claim_approved') ~ '(สติกเกอร์|SN-1|แมว)' then
    raise exception 'FAIL: approval notification leaks secrets'; end if;
  raise notice 'PASS: enhanced two-step approval, item verified, reviews recorded';
end $$;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$
  select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001'), 'rejected') $q$,
  'change a final (approved) claim', 'CLAIM_FINAL');
reset role;

-- Claimant cannot read staff checklist / notes
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  if (select count(*) from public.claim_reviews) <> 0 then raise exception 'FAIL: claimant reads claim_reviews'; end if;
  raise notice 'PASS: claimant cannot read staff checklist/notes';
end $$;
reset role;

-- Reviewer who is the finder is blocked (make finder staff temporarily)
set session_replication_role = replica;
update public.profiles set role = 'staff' where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
set session_replication_role = origin;
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select pg_temp.expect_fail($q$
  select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'), 'needs_review') $q$,
  'finder (as staff) reviews claim on own found item', 'CLAIM_CONFLICT');
reset role;
set session_replication_role = replica;
update public.profiles set role = 'user' where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
set session_replication_role = origin;

-- =========================================================
-- 4. Insufficient -> cooldown -> resubmit -> attempt limit (anti-guessing)
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'), 'insufficient');
reset role;

do $$ begin
  if (select message from public.notifications where type = 'claim_more_info' limit 1) ~ '(ปลา|พวงกุญแจ|ข้อที่|คำถามที่)' then
    raise exception 'FAIL: insufficient message hints at the answer'; end if;
  raise notice 'PASS: insufficient message is neutral';
end $$;

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"keychain":"นก"}') $q$,
  'resubmit inside 24h cooldown', 'CLAIM_COOLDOWN');
reset role;

-- attempt 2
select pg_temp.backdate((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'));
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"keychain":"นก"}');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'), 'insufficient');
reset role;
-- attempt 3
select pg_temp.backdate((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'));
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"keychain":"แมว"}');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'), 'insufficient');
reset role;
-- attempt 4 refused
select pg_temp.backdate((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'));
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"keychain":"หมา"}') $q$,
  '4th attempt on same item', 'CLAIM_LOCKED');
reset role;
do $$ begin
  if (select claim_attempt_count from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002') <> 3 then
    raise exception 'FAIL: attempt count should be 3'; end if;
  raise notice 'PASS: cooldown + 3-attempt limit enforced';
end $$;

-- =========================================================
-- 5. Per-user daily rate limit
-- =========================================================
insert into public.found_items (id, finder_id, general_name, secret_details, custody_status)
select ('f1000000-0000-4000-8000-00000000000' || g)::uuid, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'ของ ' || g, 'x', 'with_finder'
from generate_series(1, 4) g;
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.submit_claim('f1000000-0000-4000-8000-000000000001', '{}');
select public.submit_claim('f1000000-0000-4000-8000-000000000002', '{}');
select public.submit_claim('f1000000-0000-4000-8000-000000000003', '{}');
select pg_temp.expect_fail($q$ select public.submit_claim('f1000000-0000-4000-8000-000000000004', '{}') $q$,
  '4th new claim within 24h', 'CLAIM_RATE_LIMIT');

-- cancel own claim; cannot cancel someone else's
select public.cancel_claim((select id from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$
  select public.cancel_claim((select c.id from public.claims c where c.found_item_id = 'f1000000-0000-4000-8000-000000000002')) $q$,
  'cancel another user''s claim', 'CLAIM_NOT_ALLOWED');
reset role;
do $$ begin
  if (select status from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000001') <> 'cancelled' then
    raise exception 'FAIL: cancel'; end if;
  raise notice 'PASS: daily rate limit + cancel own claim only';
end $$;

-- =========================================================
-- 6. Evidence guard
-- =========================================================
insert into storage.objects (bucket_id, name, owner_id) values
  ('verification-private', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/claims/' ||
     (select id from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000002') || '/e1.jpg',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('item-images-public', 'found/pub.jpg', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.claim_evidence (claim_id, evidence_url)
select id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/claims/' || id || '/e1.jpg'
from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000002';
select pg_temp.expect_fail($q$
  insert into public.claim_evidence (claim_id, evidence_url)
  select id, 'found/pub.jpg' from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000003' $q$,
  'evidence pointing at a public-bucket file', 'CLAIM_INVALID');
reset role;
select id as bclaim from public.claims where found_item_id = 'f1000000-0000-4000-8000-000000000002' \gset
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail(
  format('insert into public.claim_evidence (claim_id, evidence_url) values (%L, %L)',
         :'bclaim', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/claims/' || :'bclaim' || '/e1.jpg'),
  'evidence on another user''s claim (id known)', 'CLAIM_NOT_ALLOWED');
reset role;
do $$ begin
  if (select count(*) from public.claim_evidence) <> 1 then raise exception 'FAIL: evidence count'; end if;
  raise notice 'PASS: evidence guard';
end $$;

-- Anon: nothing
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect_fail($q$ select * from public.claims $q$, 'anon reads claims', 'permission denied');
select pg_temp.expect_fail($q$ select public.submit_claim('f1000000-0000-4000-8000-000000000004', '{}') $q$, 'anon submits claim', 'permission denied');
reset role;

\o
select 'ALL PHASE 6 DB TESTS PASSED';
