-- =========================================================
-- Phase 8 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase8_custody_handover.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

grant all on all tables in schema public to anon, authenticated;
revoke all on public.lost_items, public.found_items, public.matches, public.notifications, public.claims,
              public.claim_reviews, public.claim_evidence, public.risk_events, public.handover_codes,
              public.handovers, public.custody_history from anon;
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
revoke insert, update, delete on public.claims, public.claim_reviews, public.risk_events,
              public.handovers, public.custody_history from authenticated;
revoke all on public.handover_codes from authenticated;
revoke delete on public.handover_locations from authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@t','{"full_name":"Owner","user_type":"university_student"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@t','{"full_name":"Other","user_type":"university_student"}'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','f@t','{"full_name":"Finder","user_type":"university_student"}'),
  ('55555555-5555-4555-8555-555555555555','s@t','{"full_name":"Staff","user_type":"teacher_staff"}'),
  ('66666666-6666-4666-8666-666666666666','s2@t','{"full_name":"Staff2","user_type":"teacher_staff"}'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','d@t','{"full_name":"Admin","user_type":"teacher_staff"}');
set session_replication_role = replica;
update public.profiles set role = 'staff' where id in ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666');
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.profiles set created_at = now() - interval '100 days';
set session_replication_role = origin;

insert into public.handover_locations (id, name, address) values
  ('10000000-0000-4000-8000-000000000001', 'จุดรับของกลาง', 'อาคาร 1 ชั้น 1'),
  ('10000000-0000-4000-8000-000000000002', 'จุดเก่า (ปิดแล้ว)', null);
update public.handover_locations set is_active = false where id = '10000000-0000-4000-8000-000000000002';

-- phone (enhanced) + keys (standard)
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, custody_status)
select 'f0000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'โทรศัพท์','x','with_finder'
from public.categories where name_en = 'Mobile phone';
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, custody_status)
select 'f0000000-0000-4000-8000-000000000002','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'กุญแจ','x','with_finder'
from public.categories where name_en = 'Keys';

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

-- Owner claims keys, staff approves (standard: likely_owner -> approved)
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{"_form":"key"}');
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"_form":"electronics"}');
reset role;
select id as keys_claim from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002' \gset
select id as phone_claim from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001' \gset

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(:'keys_claim', 'likely_owner');
select public.review_claim(:'keys_claim', 'approved');
select public.review_claim(:'phone_claim', 'verified');
select public.review_claim(:'phone_claim', 'approved');
reset role;

-- =========================================================
-- 1. Not ready while the item is still with the finder
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail(format($q$ select public.issue_handover_code(%L) $q$, :'keys_claim'),
  'code before item is with staff', 'HANDOVER_NOT_READY');
reset role;

-- =========================================================
-- 2. Custody transfers (staff only, active location, no direct release)
-- =========================================================
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select pg_temp.expect_fail($q$ select public.record_custody_transfer('f0000000-0000-4000-8000-000000000002','in_storage','10000000-0000-4000-8000-000000000001') $q$,
  'finder records custody transfer', 'CUSTODY_FORBIDDEN');
select pg_temp.expect_fail($q$ insert into public.custody_history (found_item_id, to_status) values ('f0000000-0000-4000-8000-000000000002','in_storage') $q$,
  'finder writes custody_history directly', 'permission denied');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ select public.record_custody_transfer('f0000000-0000-4000-8000-000000000002','released_to_owner','10000000-0000-4000-8000-000000000001') $q$,
  'release without handover', 'CUSTODY_INVALID');
select pg_temp.expect_fail($q$ select public.record_custody_transfer('f0000000-0000-4000-8000-000000000002','in_storage','10000000-0000-4000-8000-000000000002') $q$,
  'custody to inactive location', 'CUSTODY_INVALID');
select public.record_custody_transfer('f0000000-0000-4000-8000-000000000002','in_storage','10000000-0000-4000-8000-000000000001','รับจากผู้พบที่เคาน์เตอร์');
select public.record_custody_transfer('f0000000-0000-4000-8000-000000000001','in_storage','10000000-0000-4000-8000-000000000001');
reset role;

do $$ begin
  if (select count(*) from public.custody_history where found_item_id = 'f0000000-0000-4000-8000-000000000002') <> 2 then
    raise exception 'FAIL: expected initial + transfer custody rows'; end if;
  if (select handled_by from public.custody_history where found_item_id = 'f0000000-0000-4000-8000-000000000002' and to_status = 'in_storage')
     <> '55555555-5555-4555-8555-555555555555' then raise exception 'FAIL: handled_by'; end if;
  if not exists (select 1 from public.notifications where type = 'handover_ready' and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'FAIL: claimant not told item is ready'; end if;
  raise notice 'PASS: custody transfer recorded (who/where/when) and claimant notified';
end $$;

-- Finder can read their item's custody trail; others cannot
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
do $$ begin
  if (select count(*) from public.custody_history) < 2 then raise exception 'FAIL: finder custody trail'; end if;
end $$;
reset role;
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  if (select count(*) from public.custody_history) <> 0 then raise exception 'FAIL: stranger reads custody'; end if;
  raise notice 'PASS: finder sees custody trail of own item; others see nothing';
end $$;
reset role;

-- =========================================================
-- 3. Codes: only the approved claimant, never readable
-- =========================================================
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.expect_fail(format($q$ select public.issue_handover_code(%L) $q$, :'keys_claim'),
  'someone else requests the code', 'HANDOVER_FORBIDDEN');
reset role;

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'keys_claim') as code1 \gset
select set_config('t.code1', :'code1', false);
select public.issue_handover_code(:'keys_claim') as code2 \gset
select set_config('t.code2', :'code2', false);
select pg_temp.expect_fail($q$ select code_hash from public.handover_codes $q$, 'claimant reads code hash', 'permission denied');
do $$ begin
  if not (select code_active from public.my_handover_info((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'))) then
    raise exception 'FAIL: my_handover_info should show an active code'; end if;
  if (select location_name from public.my_handover_info((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'))) <> 'จุดรับของกลาง' then
    raise exception 'FAIL: pickup location'; end if;
  raise notice 'PASS: claimant gets code + pickup location; hash not readable';
end $$;
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ select code_hash from public.handover_codes $q$, 'staff reads code hash', 'permission denied');
reset role;

do $$ begin
  if current_setting('t.code1') !~ '^\d{6}$' then raise exception 'FAIL: code format'; end if;
  if exists (select 1 from public.handover_codes where code_hash like '%' || current_setting('t.code2') || '%') then
    raise exception 'FAIL: plaintext stored'; end if;
  if exists (select 1 from public.audit_logs where metadata::text like '%' || current_setting('t.code2') || '%') then
    raise exception 'FAIL: code in audit log'; end if;
  raise notice 'PASS: 6-digit code, only bcrypt hash stored, not in audit';
end $$;

-- =========================================================
-- 4. complete_handover rules
-- =========================================================
-- conflict: finder temporarily staff
set session_replication_role = replica;
update public.profiles set role = 'staff' where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
set session_replication_role = origin;
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select pg_temp.expect_fail(format($q$ select public.complete_handover(%L, %L, '10000000-0000-4000-8000-000000000001') $q$, :'keys_claim', :'code2'),
  'finder (as staff) hands over own found item', 'HANDOVER_CONFLICT');
reset role;
set session_replication_role = replica;
update public.profiles set role = 'user' where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
set session_replication_role = origin;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
-- the FIRST code was replaced by the re-issue
do $$ begin
  if public.complete_handover((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'),
       current_setting('t.code1'), '10000000-0000-4000-8000-000000000001') <> 'invalid_code' and current_setting('t.code1') <> current_setting('t.code2') then
    raise exception 'FAIL: superseded code accepted'; end if;
  raise notice 'PASS: re-issuing a code invalidates the previous one';
end $$;
reset role;

-- enhanced phone requires ID check
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'phone_claim') as phone_code \gset
select set_config('t.phone_code', :'phone_code', false);
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail(format($q$ select public.complete_handover(%L, %L, '10000000-0000-4000-8000-000000000001') $q$, :'phone_claim', :'phone_code'),
  'enhanced handover without ID check', 'HANDOVER_ID_REQUIRED');
do $$ begin
  if public.complete_handover((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001'),
       current_setting('t.phone_code'), '10000000-0000-4000-8000-000000000001', true, 'student_card', 'ตรวจบัตรนักศึกษาแล้ว') <> 'completed' then
    raise exception 'FAIL: enhanced handover with ID'; end if;
  raise notice 'PASS: enhanced item handed over only with ID check';
end $$;
-- single use
do $$ begin
  begin
    perform public.complete_handover((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001'),
       current_setting('t.phone_code'), '10000000-0000-4000-8000-000000000001', true, 'student_card');
    raise exception 'FAIL: code reused';
  exception when others then
    if sqlerrm !~ 'HANDOVER_(DONE|NOT_READY)' then raise; end if;
  end;
  raise notice 'PASS: handover code cannot be reused';
end $$;
reset role;

-- brute force: 5 wrong codes lock it, then even the right code fails
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
do $$
declare r text; i int; cid uuid := (select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002');
begin
  for i in 1..5 loop
    r := public.complete_handover(cid, lpad(i::text, 6, '9'), '10000000-0000-4000-8000-000000000001');
  end loop;
  if r <> 'locked' then raise exception 'FAIL: 5th wrong code should lock, got %', r; end if;
end $$;
reset role;
do $$ begin
  if (select failed_attempts from public.handover_codes where claim_id = (select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002')) <> 5 then
    raise exception 'FAIL: failed attempts not persisted'; end if;
  if (select count(*) from public.audit_logs where action = 'handover.code_failed') < 5 then
    raise exception 'FAIL: failed attempts not audited'; end if;
end $$;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
do $$ begin
  if public.complete_handover((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'),
       current_setting('t.code2'), '10000000-0000-4000-8000-000000000001') <> 'locked' then
    raise exception 'FAIL: correct code accepted after lock'; end if;
  raise notice 'PASS: 5 wrong codes lock the code (persisted + audited), correct code then refused';
end $$;
reset role;

-- claimant issues a fresh code, standard item handed over without ID check
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'keys_claim') as code3 \gset
select set_config('t.code3', :'code3', false);
reset role;
-- expired code
update public.handover_codes set expires_at = now() - interval '1 minute' where claim_id = :'keys_claim';
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
do $$ begin
  if public.complete_handover((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'),
       current_setting('t.code3'), '10000000-0000-4000-8000-000000000001') <> 'expired' then raise exception 'FAIL: expired code'; end if;
  raise notice 'PASS: expired code refused';
end $$;
reset role;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'keys_claim') as code4 \gset
select set_config('t.code4', :'code4', false);
reset role;
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
do $$ begin
  if public.complete_handover((select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'),
       current_setting('t.code4'), '10000000-0000-4000-8000-000000000001', false, null, 'รับด้วยตนเอง') <> 'completed' then
    raise exception 'FAIL: standard handover'; end if;
end $$;
reset role;

-- =========================================================
-- 5. After handover
-- =========================================================
do $$ begin
  if (select status::text || '/' || custody_status::text from public.found_items where id = 'f0000000-0000-4000-8000-000000000002') <> 'returned/released_to_owner' then
    raise exception 'FAIL: item not returned'; end if;
  if (select count(*) from public.handovers) <> 2 then raise exception 'FAIL: handovers'; end if;
  if (select received_by from public.handovers where claim_id = (select id from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000002'))
     <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then raise exception 'FAIL: received_by'; end if;
  if not exists (select 1 from public.custody_history where to_status = 'released_to_owner') then raise exception 'FAIL: custody release'; end if;
  if (select count(*) from public.notifications where type = 'item_returned' and user_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') <> 2 then
    raise exception 'FAIL: finder thank-you'; end if;
  if exists (select 1 from public.notifications where user_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' and message ~ 'Owner') then
    raise exception 'FAIL: finder told who the owner is'; end if;
  if not exists (select 1 from public.audit_logs where action = 'handover.completed') then raise exception 'FAIL: audit'; end if;
  raise notice 'PASS: item returned, confirmation recorded, custody closed, finder thanked anonymously';
end $$;

-- returned item cannot be claimed again
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{}') $q$,
  'claim a returned item', 'CLAIM_NOT_AVAILABLE');
do $$ begin
  if (select count(*) from public.handovers) <> 0 then raise exception 'FAIL: stranger sees handovers'; end if;
  raise notice 'PASS: returned item cannot be re-claimed; others cannot see handovers';
end $$;
reset role;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  if (select count(*) from public.handovers) <> 2 then raise exception 'FAIL: receiver sees own handovers'; end if;
  raise notice 'PASS: receiver sees own handover records';
end $$;
select pg_temp.expect_fail($q$ delete from public.handover_locations $q$, 'delete handover location', 'permission denied');
reset role;

-- only admin may add handover locations (existing RLS policy)
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ insert into public.handover_locations (name) values ('staff should not add') $q$,
  'staff adds a handover location', 'row-level security');
reset role;
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.handover_locations (name, address) values ('ห้องกิจการนักศึกษา', 'อาคาร 2');
select pg_temp.expect_fail($q$ insert into public.handover_locations (name) values ('   ') $q$,
  'blank location name', 'handover_locations_name_len');
reset role;

\o
select 'ALL PHASE 8 DB TESTS PASSED';
