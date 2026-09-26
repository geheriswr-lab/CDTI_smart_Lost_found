-- =========================================================
-- Phase 9 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase9_notifications_audit.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

grant all on all tables in schema public to anon, authenticated;
revoke all on public.lost_items, public.found_items, public.matches, public.notifications, public.claims,
              public.claim_reviews, public.claim_evidence, public.risk_events, public.handover_codes,
              public.handovers, public.custody_history, public.audit_logs from anon;
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
revoke insert, update, delete on public.claims, public.claim_reviews, public.risk_events,
              public.handovers, public.custody_history from authenticated;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
revoke all on public.handover_codes from authenticated;
revoke delete on public.handover_locations from authenticated;
grant select, insert on storage.objects to authenticated;
create policy stub_objects_all on storage.objects for all using (true) with check (true);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@t','{"full_name":"Owner","user_type":"university_student"}'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','f@t','{"full_name":"Finder","user_type":"university_student"}'),
  ('55555555-5555-4555-8555-555555555555','s@t','{"full_name":"Staff","user_type":"teacher_staff"}'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','d@t','{"full_name":"Admin","user_type":"teacher_staff"}');
set session_replication_role = replica;
update public.profiles set role = 'staff' where id = '55555555-5555-4555-8555-555555555555';
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.profiles set created_at = now() - interval '100 days';
set session_replication_role = origin;

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

-- =========================================================
-- 1. Full lifecycle, all through the real functions
-- =========================================================
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.handover_locations (id, name) values ('10000000-0000-4000-8000-000000000001', 'จุดรับของกลาง');
update public.handover_locations set address = 'อาคาร 1' where id = '10000000-0000-4000-8000-000000000001';
reset role;

select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, serial_number, exact_location, custody_status)
select 'f0000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'โทรศัพท์',
       'สติกเกอร์แมวสีดำด้านหลัง', 'SN-4455-XYZ', 'โต๊ะ 3 โรงอาหาร', 'with_finder'
from public.categories where name_en = 'Mobile phone';
-- finder edits a PRIVATE field: logged by field name only
update public.found_items set secret_details = 'สติกเกอร์แมวสีดำด้านหลัง มีรอยขีด' where id = 'f0000000-0000-4000-8000-000000000001';
reset role;

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.lost_items (id, reporter_id, item_name, private_ownership_details)
values ('10aa0000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'โทรศัพท์', 'วอลเปเปอร์รูปหมาพันธุ์ชิบะ');
update public.lost_items set description = 'เคสดำ' where id = '10aa0000-0000-4000-8000-000000000001';
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"_form":"electronics","brand_model":"iPhone"}');
reset role;
select id as claim_id from public.claims limit 1 \gset
select set_config('t.claim', :'claim_id', false);

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(:'claim_id', 'verified', '{"answers_match_secret":"yes"}', 'ok');
select public.review_claim(:'claim_id', 'approved');
select public.record_custody_transfer('f0000000-0000-4000-8000-000000000001', 'in_storage', '10000000-0000-4000-8000-000000000001');
insert into public.internal_notes (entity_type, entity_id, author_id, note)
values ('claim', :'claim_id', '55555555-5555-4555-8555-555555555555', 'ผู้ขอมาติดต่อที่เคาน์เตอร์แล้ว');
reset role;

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'claim_id') as code \gset
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.complete_handover(:'claim_id', :'code', '10000000-0000-4000-8000-000000000001', true, 'student_card');
delete from public.internal_notes;
reset role;

-- admin actions
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.profiles set role = 'staff' where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
select public.set_account_restriction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, 'ทดสอบ');
update public.profiles set is_restricted = false where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.categories (name_th) values ('ร่ม');
reset role;

-- =========================================================
-- 2. Audit trail completeness
-- =========================================================
do $$
declare
  expected text[] := array[
    'found_item.created', 'found_item.edited', 'lost_item.created', 'lost_item.edited',
    'claim.submitted', 'claim.reviewed', 'custody.changed', 'handover.code_issued', 'handover.completed',
    'internal_note.created', 'internal_note.deleted',
    'profile.role_changed', 'account.restricted', 'profile.restriction_changed',
    'reference.created', 'reference.updated'];
  a text;
  missing text[] := '{}';
begin
  foreach a in array expected loop
    if not exists (select 1 from public.audit_logs where action = a) then missing := missing || a; end if;
  end loop;
  if array_length(missing, 1) > 0 then raise exception 'FAIL: audit events missing: %', missing; end if;
  raise notice 'PASS: every README event type is in the audit trail (% events)', array_length(expected, 1);
end $$;

do $$ begin
  -- actors recorded
  if (select actor_id from public.audit_logs where action = 'handover.completed') <> '55555555-5555-4555-8555-555555555555' then
    raise exception 'FAIL: handover actor'; end if;
  if (select actor_id from public.audit_logs where action = 'profile.role_changed') <> 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' then
    raise exception 'FAIL: admin actor'; end if;
  -- private edits: field names only
  if (select metadata->'changed_fields' from public.audit_logs where action = 'found_item.edited') <> '["secret_details"]'::jsonb then
    raise exception 'FAIL: found edit fields'; end if;
  -- restriction via RPC logged once (no duplicate generic event for that change)
  if (select count(*) from public.audit_logs where action = 'profile.restriction_changed') <> 1 then
    raise exception 'FAIL: restriction should be logged once by RPC + once by direct update'; end if;
  -- lifecycle-only status changes do not create noisy *.edited rows
  if (select count(*) from public.audit_logs where action = 'found_item.edited') <> 1 then
    raise exception 'FAIL: status/custody changes should not log found_item.edited'; end if;
  raise notice 'PASS: actors recorded, private edits logged by field name, no duplicate/noisy entries';
end $$;

-- nothing private anywhere in the audit trail
do $$ begin
  if exists (select 1 from public.audit_logs
             where metadata::text ~ '(สติกเกอร์|แมว|SN-4455|4455|โต๊ะ 3|ชิบะ|วอลเปเปอร์|ติดต่อที่เคาน์เตอร์|ทดสอบ)'
                or metadata::text like '%' || current_setting('t.claim') || '%' and action = 'handover.code_issued' and metadata ? 'code') then
    raise exception 'FAIL: audit metadata contains private data'; end if;
  raise notice 'PASS: audit trail contains no secrets, answers, codes or note text';
end $$;

-- =========================================================
-- 3. Audit log is immutable — for users AND for the superuser
-- =========================================================
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select pg_temp.expect_fail($q$ insert into public.audit_logs (action, entity_type) values ('fake', 'x') $q$, 'admin inserts audit row', 'permission denied');
select pg_temp.expect_fail($q$ update public.audit_logs set action = 'x' $q$, 'admin updates audit rows', 'permission denied');
select pg_temp.expect_fail($q$ delete from public.audit_logs $q$, 'admin deletes audit rows', 'permission denied');
reset role;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'FAIL: user reads audit log'; end if;
  raise notice 'PASS: normal users cannot read the audit log';
end $$;
reset role;
-- superuser / service role
select pg_temp.expect_fail($q$ update public.audit_logs set action = 'tampered' $q$, 'superuser updates audit rows', 'AUDIT_IMMUTABLE');
select pg_temp.expect_fail($q$ delete from public.audit_logs $q$, 'superuser deletes audit rows', 'AUDIT_IMMUTABLE');
select pg_temp.expect_fail($q$ truncate public.audit_logs $q$, 'superuser truncates audit log', 'AUDIT_IMMUTABLE');

-- =========================================================
-- 4. Notifications
-- =========================================================
do $$ begin
  if not exists (select 1 from public.notifications where type = 'claim_received' and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'FAIL: claim_received'; end if;
  if (select count(distinct type) from public.notifications
      where type in ('claim_received','claim_review_required','claim_approved','handover_ready','handover_completed','item_returned','account_restricted')) <> 7 then
    raise exception 'FAIL: lifecycle notification types: %',
      (select array_agg(distinct type) from public.notifications);
  end if;
  if exists (select 1 from public.notifications
             where (title || message || payload::text) ~ '(สติกเกอร์|แมว|SN-4455|4455|โต๊ะ 3|ชิบะ|วอลเปเปอร์)') then
    raise exception 'FAIL: a lifecycle notification leaks secrets'; end if;
  raise notice 'PASS: all lifecycle notifications sent; none contains secrets';
end $$;

-- DB guard catches a buggy writer (service context, i.e. what a future code bug would do)
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_fail($q$
  insert into public.notifications (user_id, type, title, message, payload)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 't', 'จุดสังเกต: สติกเกอร์แมวสีดำด้านหลัง มีรอยขีด',
          '{"found_item_id":"f0000000-0000-4000-8000-000000000001"}') $q$,
  'notification quoting secret_details', 'NOTIFY_LEAK');
select pg_temp.expect_fail(format($q$
  insert into public.notifications (user_id, type, title, message, payload)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 't', 'serial sn 4455 xyz', '{"claim_id":"%s"}') $q$, current_setting('t.claim')),
  'notification with serial (reformatted) via claim_id', 'NOTIFY_LEAK');
select pg_temp.expect_fail($q$
  insert into public.notifications (user_id, type, title, message, payload)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 't', 'm', '{"found_item_ids":["f0000000-0000-4000-8000-000000000001"],"note":"โต๊ะ 3 โรงอาหาร"}') $q$,
  'notification with exact location via id list', 'NOTIFY_LEAK');
select pg_temp.expect_fail($q$
  insert into public.notifications (user_id, type, title, message, payload)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 't', 'm', '{"secret_details":"x"}') $q$,
  'notification payload with a private key', 'NOTIFY_FORBIDDEN');
select pg_temp.expect_fail($q$
  insert into public.notifications (user_id, type, title, message, payload)
  values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'x', 't', 'เจ้าของบอกว่า วอลเปเปอร์รูปหมาพันธุ์ชิบะ', '{"lost_item_id":"10aa0000-0000-4000-8000-000000000001"}') $q$,
  'notification quoting private ownership details', 'NOTIFY_LEAK');
insert into public.notifications (user_id, type, title, message, payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 'ปกติ', 'ข้อความทั่วไป', '{"found_item_id":"f0000000-0000-4000-8000-000000000001"}');
do $$ begin raise notice 'PASS: normal notification still allowed'; end $$;

\o
select 'ALL PHASE 9 DB TESTS PASSED';
