-- =========================================================
-- Phase 7 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase7_risk_dispute.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

grant all on all tables in schema public to anon, authenticated;
revoke all on public.lost_items, public.found_items, public.matches, public.notifications,
              public.claims, public.claim_reviews, public.claim_evidence, public.risk_events from anon;
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
revoke insert, update, delete on public.claims, public.claim_reviews, public.risk_events from authenticated;

-- A, B claimants (B is a brand-new account), F finder, S staff, D admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@t','{"full_name":"A","user_type":"university_student"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@t','{"full_name":"B","user_type":"external_visitor"}'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','f@t','{"full_name":"F","user_type":"university_student"}'),
  ('55555555-5555-4555-8555-555555555555','s@t','{"full_name":"S","user_type":"teacher_staff"}'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','d@t','{"full_name":"D","user_type":"teacher_staff"}');
set session_replication_role = replica;
update public.profiles set role = 'staff' where id = '55555555-5555-4555-8555-555555555555';
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.profiles set created_at = now() - interval '200 days'
  where id <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set session_replication_role = origin;

-- Items: phone (high value), keys, and 8 misc items for frequency tests
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, custody_status)
select 'f0000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'โทรศัพท์','x','with_finder'
from public.categories where name_en = 'Mobile phone';
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, custody_status)
select 'f0000000-0000-4000-8000-000000000002','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'กุญแจ','x','with_finder'
from public.categories where name_en = 'Keys';
insert into public.found_items (id, finder_id, general_name, secret_details, custody_status)
select ('f2000000-0000-4000-8000-00000000000' || g)::uuid, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'ของ ' || g, 'x', 'with_finder'
from generate_series(1, 8) g;

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

create or replace function pg_temp.claim_of(item uuid, who uuid) returns uuid language sql as $$
  select id from public.claims where found_item_id = item and claimant_id = who $$;

-- =========================================================
-- 1. New account claims a high-value item -> signal
-- =========================================================
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"_form":"electronics","brand_model":"iPhone"}');
reset role;
do $$ begin
  if not exists (select 1 from public.risk_events where event_type = 'new_account_high_value'
                 and related_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and risk_level = 'medium') then
    raise exception 'FAIL: new_account_high_value not raised'; end if;
  raise notice 'PASS: new account + high-value item flagged';
end $$;

-- =========================================================
-- 2. Dispute: A claims the same phone
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"_form":"electronics","brand_model":"iPhone 15"}');
do $$ begin
  -- claimant sees only their own claim, collapsed to "in review" by the UI; they cannot see B's claim
  if (select count(*) from public.claims) <> 1 then raise exception 'FAIL: A can see other claims'; end if;
  if (select count(*) from public.risk_events) <> 0 then raise exception 'FAIL: claimant can see risk events'; end if;
  raise notice 'PASS: claimant cannot see other claimants or risk events';
end $$;
reset role;

do $$ begin
  if (select count(*) from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001' and status = 'disputed') <> 2 then
    raise exception 'FAIL: both claims should be disputed'; end if;
  if (select count(*) from public.notifications where type = 'dispute_review_required') <> 2 then
    raise exception 'FAIL: staff + admin should be notified of dispute'; end if;
  if not exists (select 1 from public.audit_logs where action = 'claim.disputed') then
    raise exception 'FAIL: dispute not audited'; end if;
  raise notice 'PASS: second claimant -> both claims disputed, staff notified, audited';
end $$;

-- Approval is blocked while the dispute stands (handover suspended)
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(pg_temp.claim_of('f0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'verified');
select pg_temp.expect_fail(format($q$ select public.review_claim(%L, 'approved') $q$,
  pg_temp.claim_of('f0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
  'approve while another claim is active', 'CLAIM_DISPUTED');

-- Resolve: reject B, then A can be approved
select public.review_claim(pg_temp.claim_of('f0000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'rejected');
select public.review_claim(pg_temp.claim_of('f0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'approved');
reset role;
do $$ begin
  if (select status from public.claims where id = pg_temp.claim_of('f0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 'approved' then
    raise exception 'FAIL: approve after dispute resolved'; end if;
  if exists (select 1 from public.notifications
             where user_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
               and (message ~ '(ผู้ขอรับมากกว่า|ข้อพิพาท|คนอื่น)' or type = 'dispute_review_required')) then
    raise exception 'FAIL: claimants were told about the other claimant'; end if;
  raise notice 'PASS: dispute resolved by staff, then approval allowed; claimants never told about each other';
end $$;

-- A claimant can withdraw from a dispute
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"_form":"key","keychain":"ปลา","identifying_marks":"ปลอกแดง"}');
reset role;
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"_form":"key","keychain":"นก"}');
select public.cancel_claim(pg_temp.claim_of('f0000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
reset role;
do $$ begin
  if (select status from public.claims where id = pg_temp.claim_of('f0000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 'cancelled' then
    raise exception 'FAIL: withdraw from dispute'; end if;
  raise notice 'PASS: claimant can withdraw from a dispute';
end $$;

-- =========================================================
-- 3. Re-submission signals: duplicate target + answer changed
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(pg_temp.claim_of('f0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'insufficient');
reset role;
update public.claims set last_attempt_at = now() - interval '25 hours'
where id = pg_temp.claim_of('f0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
-- keychain + marks contradict the first attempt
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"_form":"key","keychain":"แมว","identifying_marks":"ปลอกน้ำเงิน"}');
reset role;
do $$
declare d jsonb;
begin
  if not exists (select 1 from public.risk_events where event_type = 'duplicate_claim_target'
                 and related_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'FAIL: duplicate_claim_target not raised'; end if;
  select details into d from public.risk_events where event_type = 'answer_changed'
    and related_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if d is null then raise exception 'FAIL: answer_changed not raised'; end if;
  if d::text ~ '(แมว|ปลา|น้ำเงิน|แดง)' then raise exception 'FAIL: risk details leak answer text: %', d; end if;
  if not (d->'changed_fields' ? 'keychain' and d->'changed_fields' ? 'identifying_marks') then
    raise exception 'FAIL: changed_fields wrong: %', d; end if;
  raise notice 'PASS: re-submission flagged; answer_changed stores field names only';
end $$;

-- Refining an answer (adding detail) is NOT a contradiction
do $$ begin
  if array_length(public.contradicted_answer_keys('{"keychain":"ปลา","identifying_marks":"ปลอกแดง"}',
                                                  '{"keychain":"ปลาสีฟ้า","identifying_marks":"ปลอกแดง มีรอย"}'), 1) is not null then
    raise exception 'FAIL: refinement counted as contradiction'; end if;
  raise notice 'PASS: refined answers are not treated as changed';
end $$;

-- =========================================================
-- 4. Repeated negative outcomes -> repeated_rejections
-- =========================================================
-- move B's earlier claims out of the 24h rate-limit window (still inside 30 days)
update public.claims set created_at = now() - interval '2 days'
where claimant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select public.submit_claim('f2000000-0000-4000-8000-000000000001', '{}');
select public.submit_claim('f2000000-0000-4000-8000-000000000002', '{}');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(pg_temp.claim_of('f2000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'rejected');
select public.review_claim(pg_temp.claim_of('f2000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'rejected');
reset role;
do $$ begin
  -- B: rejected on phone (1) + 2 more = 3 negative outcomes in 30 days
  if not exists (select 1 from public.risk_events where event_type = 'repeated_rejections'
                 and related_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and risk_level = 'medium') then
    raise exception 'FAIL: repeated_rejections not raised'; end if;
  raise notice 'PASS: 3 negative outcomes in 30 days flagged';
end $$;

-- =========================================================
-- 5. Frequent claims (>= 5 in 7 days), and de-duplication
-- =========================================================
-- give A older claims inside the 7-day window (bypasses the 24h rate limit for the test)
set session_replication_role = replica;
insert into public.claims (claimant_id, found_item_id, status, created_at)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ('f2000000-0000-4000-8000-00000000000' || g)::uuid, 'cancelled', now() - interval '3 days'
from generate_series(3, 5) g;
set session_replication_role = origin;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f2000000-0000-4000-8000-000000000006', '{}');
reset role;
do $$ begin
  if (select count(*) from public.risk_events where event_type = 'frequent_claims'
      and related_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then
    raise exception 'FAIL: frequent_claims should be raised exactly once'; end if;
  raise notice 'PASS: frequent claims flagged once (de-duplicated)';
end $$;

-- =========================================================
-- 6. Neutral vocabulary enforced by the DB
-- =========================================================
select pg_temp.expect_fail($q$ update public.risk_events set resolution = 'thief' $q$,
  'accusatory resolution word', 'risk_events_resolution_check');
select pg_temp.expect_fail($q$
  insert into public.risk_events (event_type) values ('scammer_detected') $q$,
  'accusatory event type', 'risk_events_event_type_check');

-- =========================================================
-- 7. Resolution + restriction permissions
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$ update public.risk_events set resolution = 'cleared' $q$, 'user edits risk events directly', 'permission denied');
select pg_temp.expect_fail(format($q$ select public.resolve_risk_event(%L, 'cleared') $q$,
  (select id from public.risk_events limit 1)), 'user resolves a risk event', 'RISK_FORBIDDEN');
select pg_temp.expect_fail($q$ select public.set_account_restriction('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true) $q$,
  'user restricts an account', 'RISK_FORBIDDEN');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail(format($q$ select public.resolve_risk_event(%L, 'thief') $q$,
  (select id from public.risk_events limit 1)), 'staff uses a non-neutral resolution', 'RISK_INVALID');
select public.resolve_risk_event(
  (select id from public.risk_events where event_type = 'frequent_claims' limit 1), 'cleared', 'นักศึกษาทำของหายหลายชิ้นจริง');
select pg_temp.expect_fail($q$ select public.set_account_restriction('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true) $q$,
  'staff (non-admin) restricts an account', 'RISK_FORBIDDEN');
reset role;

select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.set_account_restriction('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true, 'ตรวจสอบแล้ว มีสัญญาณหลายรายการ');
select pg_temp.expect_fail($q$ select public.set_account_restriction('dddddddd-dddd-4ddd-8ddd-dddddddddddd', true) $q$,
  'admin restricts self', 'RISK_CONFLICT');
reset role;

do $$ begin
  if not (select is_restricted from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'FAIL: restriction not applied'; end if;
  if exists (select 1 from public.risk_events where related_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and resolved_at is null) then
    raise exception 'FAIL: open events should close as account_restricted'; end if;
  if (select resolved_at from public.risk_events where event_type = 'frequent_claims' limit 1) is null then
    raise exception 'FAIL: cleared event should be closed'; end if;
  if exists (select 1 from public.audit_logs where action = 'account.restricted' and metadata::text like '%สัญญาณ%') then
    raise exception 'FAIL: restriction reason leaked into audit log'; end if;
  if (select message from public.notifications where type = 'account_restricted') ~ '(โจร|ขโมย|ทุจริต|สัญญาณ)' then
    raise exception 'FAIL: restriction notice is not neutral'; end if;
  raise notice 'PASS: staff resolve with neutral outcomes; only admin restricts; user gets a neutral notice';
end $$;

-- restricted user can no longer claim (Phase 6 rule still holds)
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.expect_fail($q$ select public.submit_claim('f2000000-0000-4000-8000-000000000007', '{}') $q$,
  'restricted user submits a claim', 'CLAIM_NOT_ALLOWED');
reset role;

-- anon: nothing
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect_fail($q$ select * from public.risk_events $q$, 'anon reads risk events', 'permission denied');
reset role;

\o
select 'ALL PHASE 7 DB TESTS PASSED';
