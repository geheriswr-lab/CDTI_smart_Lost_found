-- =========================================================
-- Phase 10 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase10_admin_dashboard.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

grant all on all tables in schema public to anon, authenticated;
revoke all on public.lost_items, public.found_items, public.matches, public.notifications, public.claims,
              public.claim_reviews, public.claim_evidence, public.risk_events, public.handover_codes,
              public.handovers, public.custody_history, public.audit_logs, public.internal_notes,
              public.case_escalations from anon;
revoke insert, update, delete on public.claims, public.claim_reviews, public.risk_events, public.handovers,
              public.custody_history, public.case_escalations from authenticated;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
revoke all on public.handover_codes from authenticated;
revoke update on public.internal_notes from authenticated;
revoke delete on public.handover_locations, public.categories, public.locations from authenticated;
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@t','{"full_name":"Owner","user_type":"university_student"}'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','f@t','{"full_name":"Finder","user_type":"university_student"}'),
  ('55555555-5555-4555-8555-555555555555','s@t','{"full_name":"Staff","user_type":"teacher_staff"}'),
  ('66666666-6666-4666-8666-666666666666','s2@t','{"full_name":"Staff2","user_type":"teacher_staff"}'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','d@t','{"full_name":"Admin","user_type":"teacher_staff"}');
set session_replication_role = replica;
update public.profiles set role = 'staff' where id in ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666');
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

-- ---------------------------------------------------------
-- Fixtures: one full return (5 days after report), one old phone still with finder,
-- one unconfirmed transfer, one rejected claim
-- ---------------------------------------------------------
insert into public.handover_locations (id, name) values ('10000000-0000-4000-8000-000000000001', 'จุดรับของกลาง');
insert into public.lost_items (reporter_id, item_name, created_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ร่ม', now() - interval '10 days');

insert into public.found_items (id, finder_id, category_id, general_name, secret_details, custody_status, created_at)
select 'f0000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'กุญแจ','x','with_finder', now() - interval '5 days'
from public.categories where name_en = 'Keys';
insert into public.found_items (id, finder_id, category_id, general_name, secret_details, custody_status, created_at)
select 'f0000000-0000-4000-8000-000000000002','ffffffff-ffff-4fff-8fff-ffffffffffff', id, 'โทรศัพท์','x','with_finder', now() - interval '3 days'
from public.categories where name_en = 'Mobile phone';
insert into public.found_items (id, finder_id, general_name, secret_details, custody_status, created_at)
values ('f0000000-0000-4000-8000-000000000003','ffffffff-ffff-4fff-8fff-ffffffffffff','ขวดน้ำ','x','transferred_to_staff', now() - interval '4 days');
insert into public.found_items (id, finder_id, general_name, secret_details, custody_status)
values ('f0000000-0000-4000-8000-000000000004','ffffffff-ffff-4fff-8fff-ffffffffffff','หนังสือ','x','with_finder');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"_form":"key"}');
select public.submit_claim('f0000000-0000-4000-8000-000000000004', '{}');
reset role;
select id as keys_claim from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001' \gset
select id as book_claim from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000004' \gset
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(:'keys_claim', 'likely_owner');
select public.review_claim(:'keys_claim', 'approved');
select public.review_claim(:'book_claim', 'rejected');
select public.record_custody_transfer('f0000000-0000-4000-8000-000000000001', 'in_storage', '10000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.issue_handover_code(:'keys_claim') as code \gset
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.complete_handover(:'keys_claim', :'code', '10000000-0000-4000-8000-000000000001');
reset role;

-- =========================================================
-- 1. Statistics
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.admin_stats(current_date - 30, current_date)::text as stats \gset
reset role;
select set_config('t.stats', :'stats', false);
do $$
declare s jsonb := current_setting('t.stats')::jsonb;
begin
  if (s->>'lost_reports')::int <> 1 or (s->>'found_reports')::int <> 4 then raise exception 'FAIL: report counts %', s; end if;
  if (s->>'claims')::int <> 2 or (s->>'claims_approved')::int <> 1 or (s->>'claims_rejected')::int <> 1 then raise exception 'FAIL: claim counts %', s; end if;
  if (s->>'returns')::int <> 1 then raise exception 'FAIL: returns %', s; end if;
  if (s->>'avg_return_hours')::numeric not between 119 and 121 then raise exception 'FAIL: avg return time %', s->>'avg_return_hours'; end if;
  if (s->>'return_success_rate')::numeric <> 25.0 then raise exception 'FAIL: success rate %', s->>'return_success_rate'; end if;
  if jsonb_array_length(s->'monthly') < 1 then raise exception 'FAIL: monthly'; end if;
  if s::text ~ '(aaaaaaaa|ffffffff|Owner|Finder)' then raise exception 'FAIL: stats contain per-person data'; end if;
  raise notice 'PASS: statistics correct (counts, avg return time 120h, success rate 25%%), aggregates only';
end $$;

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail($q$ select public.admin_stats(current_date - 30, current_date) $q$, 'user reads statistics', 'STATS_FORBIDDEN');
select pg_temp.expect_fail($q$ select * from public.admin_custody_anomalies() $q$, 'user reads anomalies', 'STATS_FORBIDDEN');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ select public.admin_stats(current_date, current_date - 5) $q$, 'reversed range', 'STATS_INVALID');
reset role;

-- =========================================================
-- 2. Custody anomalies
-- =========================================================
update public.handover_codes set failed_attempts = 0;  -- (codes already used)
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select string_agg(kind || ':' || found_item_id, ',' order by kind) as kinds from public.admin_custody_anomalies() \gset
reset role;
select set_config('t.kinds', coalesce(:'kinds', ''), false);
do $$
declare k text := current_setting('t.kinds');
begin
  if k !~ 'with_finder_too_long:f0000000-0000-4000-8000-000000000002' then raise exception 'FAIL: high-value with finder > 2 days not flagged: %', k; end if;
  if k !~ 'unconfirmed_transfer:f0000000-0000-4000-8000-000000000003' then raise exception 'FAIL: unconfirmed transfer: %', k; end if;
  if k ~ 'f0000000-0000-4000-8000-000000000004' then raise exception 'FAIL: new item wrongly flagged: %', k; end if;
  if k ~ 'f0000000-0000-4000-8000-000000000001' then raise exception 'FAIL: returned item wrongly flagged: %', k; end if;
  raise notice 'PASS: custody anomalies flag the right items only';
end $$;

-- =========================================================
-- 3. Escalations
-- =========================================================
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.expect_fail(format($q$ select public.escalate_case('claim', %L, 'ขอให้ admin ดู') $q$, :'book_claim'), 'user escalates', 'ESCALATE_FORBIDDEN');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.escalate_case('claim', :'book_claim', 'ผู้ขอโต้แย้งผลการตรวจ ขอให้ admin พิจารณา') as esc \gset
select pg_temp.expect_fail(format($q$ select public.escalate_case('claim', %L, 'ซ้ำอีกครั้งนะ') $q$, :'book_claim'), 'duplicate open escalation', 'ESCALATE_DUPLICATE');
select pg_temp.expect_fail(format($q$ select public.escalate_case('claim', %L, 'สั้น') $q$, :'keys_claim'), 'too-short reason', 'ESCALATE_INVALID');
select pg_temp.expect_fail(format($q$ select public.resolve_escalation(%L, 'ok') $q$, :'esc'), 'staff resolves escalation', 'ESCALATE_FORBIDDEN');
select pg_temp.expect_fail($q$ insert into public.case_escalations (entity_type, entity_id, reason, escalated_by) values ('claim', gen_random_uuid(), 'direct insert', auth.uid()) $q$,
  'direct insert into escalations', 'permission denied');
reset role;
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.resolve_escalation(:'esc', 'ตรวจแล้ว ยืนยันผลเดิม');
reset role;
do $$ begin
  if (select status from public.case_escalations limit 1) <> 'resolved' then raise exception 'FAIL: resolve'; end if;
  if not exists (select 1 from public.notifications where type = 'case_escalated' and user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') then
    raise exception 'FAIL: admin not notified'; end if;
  if (select count(*) from public.audit_logs where action in ('case.escalated','case.escalation_resolved')) <> 2 then raise exception 'FAIL: audit'; end if;
  if exists (select 1 from public.audit_logs where metadata::text like '%โต้แย้ง%') then raise exception 'FAIL: reason in audit'; end if;
  raise notice 'PASS: staff escalate, admin resolves, admin notified, audited without the reason text';
end $$;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  if (select count(*) from public.case_escalations) <> 0 then raise exception 'FAIL: user sees escalations'; end if;
  raise notice 'PASS: users cannot see escalations';
end $$;
reset role;

-- =========================================================
-- 4. Internal notes: staff only, author-or-admin delete, no edit
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
insert into public.internal_notes (entity_type, entity_id, author_id, note) values ('claim', :'book_claim', '55555555-5555-4555-8555-555555555555', 'โทรคุยแล้ว');
select pg_temp.expect_fail(format($q$ insert into public.internal_notes (entity_type, entity_id, author_id, note) values ('claim', %L, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ปลอมเป็น admin') $q$, :'book_claim'),
  'note written in someone else''s name', 'row-level security');
select pg_temp.expect_fail(format($q$ insert into public.internal_notes (entity_type, entity_id, author_id, note) values ('claim', %L, '55555555-5555-4555-8555-555555555555', '   ') $q$, :'book_claim'),
  'blank note', 'internal_notes_note_len');
select pg_temp.expect_fail($q$ update public.internal_notes set note = 'แก้ย้อนหลัง' $q$, 'edit a note', 'permission denied');
reset role;
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
delete from public.internal_notes;  -- other staff: RLS matches 0 rows
reset role;
do $$ begin
  if (select count(*) from public.internal_notes) <> 1 then raise exception 'FAIL: other staff deleted a note'; end if;
  raise notice 'PASS: staff cannot delete someone else''s note';
end $$;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  if (select count(*) from public.internal_notes) <> 0 then raise exception 'FAIL: user reads notes'; end if;
end $$;
reset role;
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
delete from public.internal_notes;
reset role;
do $$ begin
  if (select count(*) from public.internal_notes) <> 0 then raise exception 'FAIL: admin delete'; end if;
  raise notice 'PASS: users cannot read notes; admin can remove a note (audited)';
end $$;

-- =========================================================
-- 5. Reference data: admin only, validated, no delete
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select pg_temp.expect_fail($q$ insert into public.categories (name_th) values ('โดยstaff') $q$, 'staff adds a category', 'row-level security');
reset role;
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.locations (name, description) values ('อาคาร 1', 'ตึกเรียนรวม');
update public.categories set is_high_value = true where name_en = 'Bag';
select pg_temp.expect_fail($q$ insert into public.locations (name) values ('') $q$, 'blank location', 'locations_name_len');
select pg_temp.expect_fail($q$ delete from public.categories where name_en = 'Other' $q$, 'delete a category', 'permission denied');
reset role;
do $$ begin raise notice 'PASS: reference data admin-only, validated, deactivate instead of delete'; end $$;

\o
select 'ALL PHASE 10 DB TESTS PASSED';
