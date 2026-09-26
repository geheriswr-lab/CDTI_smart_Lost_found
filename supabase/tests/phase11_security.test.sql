-- =========================================================
-- Phase 11 — Security tests (README "Security Testing").
-- Runs on a throwaway Postgres that imitates Supabase's default grants
-- (every new table/function is granted to anon + authenticated), so the
-- privilege checks here see what a real project would expose:
--
--   createdb t
--   psql -d t -f supabase/tests/supabase_stub.sql
--   psql -d t -c "alter default privileges in schema public grant all on tables to anon, authenticated;
--                 alter default privileges in schema public grant all on sequences to anon, authenticated;
--                 alter default privileges in schema public grant execute on functions to anon, authenticated;"
--   psql -d t -f supabase/setup_all.sql
--   psql -d t -v ON_ERROR_STOP=1 -f supabase/tests/phase11_security.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

-- ---------------------------------------------------------
-- Users: A (owner), B (other user), F (finder), C/D (claimants), S (staff),
-- X (admin), P (staff waiting for a password change)
-- ---------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@t','{"full_name":"UserA","user_type":"university_student"}','h-a'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@t','{"full_name":"UserB","user_type":"university_student"}','h-b'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','f@t','{"full_name":"Finder","user_type":"university_student"}','h-f'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','c@t','{"full_name":"ClaimC","user_type":"university_student"}','h-c'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','e@t','{"full_name":"ClaimE","user_type":"university_student"}','h-e'),
  ('55555555-5555-4555-8555-555555555555','s@t','{"full_name":"Staff","user_type":"teacher_staff"}','h-s'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','x@t','{"full_name":"Admin","user_type":"teacher_staff"}','h-x'),
  ('99999999-9999-4999-8999-999999999999','p@t','{"full_name":"NewAdmin","user_type":"teacher_staff"}','h-p-initial');
-- Promote with the service role (no JWT), like scripts/create-admin.ts.
update public.profiles set role = 'staff' where id = '55555555-5555-4555-8555-555555555555';
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.profiles set role = 'admin', must_change_password = true where id = '99999999-9999-4999-8999-999999999999';
set session_replication_role = replica;
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

-- Row count a statement returns / affects (for "silently filtered by RLS").
create or replace function pg_temp.rows_of(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || sql || ') q' into n;
  return n;
end $$;
create or replace function pg_temp.affected(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_of(text), pg_temp.affected(text) to anon, authenticated;

-- Supabase lets API roles query storage.objects (RLS decides the rows).
grant select, insert on storage.objects to anon, authenticated;

-- ---------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------
insert into public.handover_locations (id, name) values ('10000000-0000-4000-8000-000000000001', 'จุดรับของกลาง');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.lost_items (id, reporter_id, item_name, private_ownership_details)
values ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'กระเป๋าสตางค์', 'SECRET-A มีรูปแมวในช่องบัตร');
reset role;

select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
insert into public.found_items (id, finder_id, general_name, secret_details, serial_number, exact_location, custody_status)
values
  ('f0000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff','กระเป๋าสตางค์','SECRET-F บัตรนักศึกษาชื่อสมชาย','SN-998877','ใต้โต๊ะ 3 ห้อง 402','with_finder'),
  ('f0000000-0000-4000-8000-000000000002','ffffffff-ffff-4fff-8fff-ffffffffffff','ร่ม','SECRET-2','','','with_finder'),
  ('f0000000-0000-4000-8000-000000000003','ffffffff-ffff-4fff-8fff-ffffffffffff','ขวดน้ำ','SECRET-3','','','with_finder'),
  ('f0000000-0000-4000-8000-000000000004','ffffffff-ffff-4fff-8fff-ffffffffffff','หนังสือ','SECRET-4','','','with_finder'),
  ('f0000000-0000-4000-8000-000000000005','ffffffff-ffff-4fff-8fff-ffffffffffff','สายชาร์จ','SECRET-5','','','with_finder'),
  ('f0000000-0000-4000-8000-000000000006','ffffffff-ffff-4fff-8fff-ffffffffffff','หูฟัง','SECRET-6','','','with_finder');
reset role;

-- =========================================================
-- S1. Static checks: RLS, grants, function exposure, search_path
-- =========================================================
do $$
declare r record; bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: tables without RLS: %', bad; end if;

  -- anon may read only reference data and the two whitelisted public views.
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
    and not (privilege_type = 'SELECT' and table_name in
             ('categories','locations','handover_locations','public_lost_items','public_found_items'));
  if bad is not null then raise exception 'FAIL: anon has table privileges: %', bad; end if;

  -- authenticated must have no access at all to the secret tables.
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
    and table_name in ('handover_codes', 'password_change_markers');
  if bad is not null then raise exception 'FAIL: authenticated can touch secret tables: %', bad; end if;

  select string_agg(distinct table_name || ':' || privilege_type, ', ') into bad
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    and table_name in ('claims','claim_reviews','risk_events','audit_logs','handovers','custody_history','case_escalations','matches')
    or (grantee = 'authenticated' and table_schema = 'public' and table_name = 'notifications'
        and privilege_type in ('INSERT','DELETE','TRUNCATE'));
  if bad is not null then raise exception 'FAIL: authenticated can write server-owned tables: %', bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and p.proname not in ('is_admin', 'is_staff_or_admin')
    and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'FAIL: anon can execute: %', bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'FAIL: SECURITY DEFINER without search_path: %', bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('raise_risk_event', 'contradicted_answer_keys', 'try_uuid')
    and has_function_privilege('authenticated', p.oid, 'execute');
  if bad is not null then raise exception 'FAIL: internal helpers callable by users: %', bad; end if;

  select string_agg(table_name || '.' || column_name, ', ') into bad
  from information_schema.columns
  where table_schema = 'public' and table_name in ('public_lost_items', 'public_found_items')
    and column_name in ('secret_details','serial_number','exact_location','exact_time','private_image_url',
                        'private_ownership_details','finder_id','reporter_id');
  if bad is not null then raise exception 'FAIL: public views expose: %', bad; end if;

  raise notice 'PASS S1: RLS on every table; anon/authenticated grants minimal; no exposed helpers; search_path pinned; views whitelisted';
end $$;

-- =========================================================
-- T1. User A cannot read User B's secrets (and vice versa)
-- =========================================================
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  if pg_temp.rows_of('select * from public.lost_items') <> 0 then raise exception 'FAIL: B reads A''s lost item'; end if;
  if pg_temp.rows_of('select * from public.found_items') <> 0 then raise exception 'FAIL: B reads found items'; end if;
  if pg_temp.rows_of('select * from public.profiles where id <> auth.uid()') <> 0 then raise exception 'FAIL: B reads other profiles'; end if;
  if pg_temp.rows_of($q$select * from public.public_lost_items where to_jsonb(public_lost_items)::text ~ 'SECRET'$q$) <> 0
     or pg_temp.rows_of($q$select * from public.public_found_items where to_jsonb(public_found_items)::text ~ '(SECRET|SN-998877|ห้อง 402)'$q$) <> 0 then
    raise exception 'FAIL: public views leak secrets';
  end if;
  raise notice 'PASS T1: user B sees none of user A''s / finder''s private data';
end $$;
reset role;

-- =========================================================
-- T2. User cannot edit others' items
-- =========================================================
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  if pg_temp.affected($q$update public.lost_items set item_name = 'hacked' where id = 'a0000000-0000-4000-8000-000000000001'$q$) <> 0
     or pg_temp.affected($q$update public.found_items set secret_details = 'hacked'$q$) <> 0
     or pg_temp.affected($q$delete from public.lost_items$q$) <> 0 then
    raise exception 'FAIL: B modified someone else''s item';
  end if;
  raise notice 'PASS T2: updates/deletes on others'' items affect 0 rows';
end $$;
select pg_temp.expect_fail($q$ insert into public.lost_items (reporter_id, item_name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ปลอม') $q$,
  'B files a report as A', 'row-level security');
reset role;

-- =========================================================
-- T3. User cannot reach admin functions or change their role
-- =========================================================
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.expect_fail($q$ update public.profiles set role = 'admin' where id = auth.uid() $q$, 'user promotes self', 'Only admins can change role');
select pg_temp.expect_fail($q$ update public.profiles set is_restricted = true where id = auth.uid() $q$, 'user changes own restriction flag', 'is_restricted');
select pg_temp.expect_fail($q$ select public.admin_stats(current_date - 30, current_date) $q$, 'user reads statistics', 'FORBIDDEN');
select pg_temp.expect_fail($q$ select public.set_account_restriction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, 'x') $q$, 'user restricts someone', 'FORBIDDEN|admin');
select pg_temp.expect_fail($q$ select public.review_claim(gen_random_uuid(), 'approved') $q$, 'user reviews a claim');
select pg_temp.expect_fail($q$ insert into public.categories (name_th, name_en) values ('x','x') $q$, 'user adds a category', 'row-level security');
select pg_temp.expect_fail($q$ insert into public.audit_logs (action, entity_type) values ('fake','x') $q$, 'user forges an audit log', 'permission denied');
select pg_temp.expect_fail($q$ insert into public.risk_events (event_type, risk_level) values ('x','low') $q$, 'user inserts a risk event', 'permission denied');
select pg_temp.expect_fail($q$ select public.raise_risk_event('x','low',null,null,null,'{}') $q$, 'user calls raise_risk_event', 'permission denied');
do $$ begin
  if pg_temp.rows_of('select * from public.audit_logs') + pg_temp.rows_of('select * from public.risk_events')
     + pg_temp.rows_of('select * from public.internal_notes') + pg_temp.rows_of('select * from public.claim_reviews') <> 0 then
    raise exception 'FAIL: user reads staff-only tables';
  end if;
  raise notice 'PASS T3: staff-only tables return 0 rows to users';
end $$;
reset role;

-- =========================================================
-- T4. Claimant cannot read secret_details; public/anon cannot read evidence
-- =========================================================
select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"secret":"บัตรนักศึกษา"}');
do $$ begin
  if pg_temp.rows_of($q$select * from public.found_items where id = 'f0000000-0000-4000-8000-000000000001'$q$) <> 0 then
    raise exception 'FAIL: claimant reads the found item row';
  end if;
  if pg_temp.rows_of($q$select * from public.claims where to_jsonb(claims)::text ~ '(SECRET-F|SN-998877)'$q$) <> 0 then
    raise exception 'FAIL: claim row echoes item secrets';
  end if;
  if pg_temp.rows_of($q$select * from public.notifications where (title || message || payload::text) ~ '(SECRET|SN-998877|ห้อง 402)'$q$) <> 0 then
    raise exception 'FAIL: notification leaks item secrets';
  end if;
  raise notice 'PASS T4a: claimant cannot see secret_details / serial / exact location';
end $$;
reset role;
select id as c_claim from public.claims where claimant_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' \gset
insert into storage.objects (bucket_id, name, owner_id)
values ('verification-private', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/claims/' || :'c_claim' || '/receipt.jpg', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.claim_evidence (claim_id, evidence_url, description)
values (:'c_claim', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/claims/' || :'c_claim' || '/receipt.jpg', 'ใบเสร็จ');
reset role;

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_fail('select * from public.claim_evidence', 'anon reads claim evidence', 'permission denied');
select pg_temp.expect_fail('select * from public.claims', 'anon reads claims', 'permission denied');
select pg_temp.expect_fail('select * from public.profiles', 'anon reads profiles', 'permission denied');
select pg_temp.expect_fail('select * from public.found_items', 'anon reads found_items base table', 'permission denied');
select pg_temp.expect_fail($q$ select public.current_user_role() $q$, 'anon calls current_user_role', 'permission denied');
select pg_temp.expect_fail($q$ select public.is_own_storage_object('verification-private', 'x') $q$, 'anon calls is_own_storage_object', 'permission denied');
do $$ begin
  if pg_temp.rows_of($q$select * from storage.objects where bucket_id = 'verification-private'$q$) <> 0 then
    raise exception 'FAIL: anon lists private evidence files';
  end if;
  raise notice 'PASS T4b: anon cannot read evidence rows or private files';
end $$;
reset role;

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  if pg_temp.rows_of('select * from public.claim_evidence') + pg_temp.rows_of('select * from public.claims')
     + pg_temp.rows_of($q$select * from storage.objects where bucket_id = 'verification-private'$q$) <> 0 then
    raise exception 'FAIL: another user reads C''s evidence';
  end if;
  raise notice 'PASS T4c: other users cannot read someone''s claim or evidence';
end $$;
reset role;

-- =========================================================
-- T5. Finder cannot change verification details after a claim exists (0026)
-- =========================================================
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select pg_temp.expect_fail($q$ update public.found_items set secret_details = 'บัตรนักศึกษา' where id = 'f0000000-0000-4000-8000-000000000001' $q$,
  'finder rewrites secret after a claim', 'REPORT_LOCKED');
select pg_temp.expect_fail($q$ update public.found_items set serial_number = 'X' where id = 'f0000000-0000-4000-8000-000000000001' $q$,
  'finder rewrites serial after a claim', 'REPORT_LOCKED');
do $$ begin
  if pg_temp.affected($q$update public.found_items set description = 'สีดำ' where id = 'f0000000-0000-4000-8000-000000000001'$q$) <> 1
     or pg_temp.affected($q$update public.found_items set secret_details = 'SECRET-6b' where id = 'f0000000-0000-4000-8000-000000000006'$q$) <> 1 then
    raise exception 'FAIL: finder can no longer edit public fields / unclaimed items';
  end if;
  raise notice 'PASS T5: secrets locked once claimed; public fields and unclaimed items still editable';
end $$;
reset role;

-- =========================================================
-- T6. Duplicate / excessive claims are rate limited
-- =========================================================
select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{}') $q$, 'duplicate claim on the same item', 'CLAIM_');
select public.submit_claim('f0000000-0000-4000-8000-000000000002', '{}');
select public.submit_claim('f0000000-0000-4000-8000-000000000003', '{}');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000004', '{}') $q$, '4th new claim within 24h', 'CLAIM_RATE_LIMIT');
reset role;
select pg_temp.act_as('ffffffff-ffff-4fff-8fff-ffffffffffff');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000005', '{}') $q$, 'finder claims own item', 'CLAIM_NOT_ALLOWED');
reset role;

-- =========================================================
-- T7. Several claimants on one item -> dispute, approval blocked
-- =========================================================
select pg_temp.act_as('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"secret":"ไม่รู้"}');
reset role;
do $$ begin
  if (select count(*) from public.claims where found_item_id = 'f0000000-0000-4000-8000-000000000001' and status = 'disputed') <> 2 then
    raise exception 'FAIL: two claims on one item are not both disputed';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'claim.disputed') then
    raise exception 'FAIL: dispute not audited';
  end if;
  raise notice 'PASS T7: second claimant turns both claims into a dispute (audited)';
end $$;
select id as e_claim from public.claims where claimant_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' \gset
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.review_claim(:'c_claim', 'likely_owner');
select pg_temp.expect_fail(format($q$ select public.review_claim(%L, 'approved') $q$, :'c_claim'), 'approve during a dispute', 'DISPUTED');
-- Staff settles it: E rejected (with an internal note), then C approved.
select public.review_claim(:'e_claim', 'rejected', '{}', 'NOTE-INTERNAL คำตอบไม่ตรงกับ SECRET-F');
select public.review_claim(:'c_claim', 'approved');
reset role;

-- =========================================================
-- T8. Rejected claimant gets no hints
-- =========================================================
select pg_temp.act_as('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
do $$ begin
  if pg_temp.rows_of('select * from public.claim_reviews') <> 0 then raise exception 'FAIL: rejected claimant reads reviews'; end if;
  if pg_temp.rows_of('select * from public.risk_events') <> 0 then raise exception 'FAIL: rejected claimant reads risk events'; end if;
  if pg_temp.rows_of('select * from public.found_items') <> 0 then raise exception 'FAIL: rejected claimant reads the item'; end if;
  if pg_temp.rows_of($q$select * from public.notifications where (title || message || payload::text) ~ '(NOTE-INTERNAL|SECRET|SN-998877|ห้อง 402|ClaimC|cccccccc)'$q$) <> 0 then
    raise exception 'FAIL: rejection notice leaks a hint';
  end if;
  if pg_temp.rows_of($q$select * from public.claims where to_jsonb(claims)::text ~ '(NOTE-INTERNAL|SECRET)'$q$) <> 0 then
    raise exception 'FAIL: claim row leaks the review note';
  end if;
  if pg_temp.rows_of($q$select * from public.claims where status = 'rejected'$q$) <> 1 then
    raise exception 'FAIL: claimant cannot see own final status';
  end if;
  raise notice 'PASS T8: rejected claimant sees only the neutral outcome — no note, no other claimant, no secret';
end $$;
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{"secret":"บัตรนักศึกษา"}') $q$,
  'rejected claimant tries again', 'CLAIM_');
reset role;

-- =========================================================
-- T9. Handover code: single use, not readable; returned item not re-claimable
-- =========================================================
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.record_custody_transfer('f0000000-0000-4000-8000-000000000001', 'in_storage', '10000000-0000-4000-8000-000000000001');
select pg_temp.expect_fail('select * from public.handover_codes', 'staff reads handover code hashes', 'permission denied');
reset role;
select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select public.issue_handover_code(:'c_claim') as code \gset
select pg_temp.expect_fail('select * from public.handover_codes', 'claimant reads handover code hashes', 'permission denied');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.complete_handover(:'c_claim', :'code', '10000000-0000-4000-8000-000000000001') as first_use \gset
select set_config('t.first', :'first_use', false);
select set_config('t.c_claim', :'c_claim', false);
select pg_temp.expect_fail(format($q$ do $x$ begin if public.complete_handover(%L, %L, %L) = 'completed' then raise exception 'REUSED'; end if; end $x$ $q$,
  :'c_claim', :'code', '10000000-0000-4000-8000-000000000001'), 'reuse the same handover code');
reset role;
do $$ begin
  if current_setting('t.first') <> 'completed' then raise exception 'FAIL: first handover %', current_setting('t.first'); end if;
  if (select status from public.found_items where id = 'f0000000-0000-4000-8000-000000000001') <> 'returned' then
    raise exception 'FAIL: item not marked returned';
  end if;
  if (select count(*) from public.handovers where claim_id = current_setting('t.c_claim', true)::uuid) > 1 then
    raise exception 'FAIL: duplicate handover rows';
  end if;
  raise notice 'PASS T9a: code works once, then is rejected; item returned';
end $$;
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.expect_fail($q$ select public.submit_claim('f0000000-0000-4000-8000-000000000001', '{}') $q$, 'claim a returned item', 'CLAIM_NOT_AVAILABLE');
reset role;

-- =========================================================
-- T10. Audit log is complete and immutable
-- =========================================================
do $$
declare missing text;
begin
  select string_agg(a, ', ') into missing
  from unnest(array['lost_item.created','found_item.created','found_item.edited','claim.submitted','claim.disputed',
                    'claim.reviewed','custody.changed','handover.code_issued','handover.completed',
                    'profile.role_changed']) a
  where not exists (select 1 from public.audit_logs l where l.action = a);
  if missing is not null then raise exception 'FAIL: audit log missing actions: %', missing; end if;
  if exists (select 1 from public.audit_logs l where to_jsonb(l)::text ~ '(SECRET|SN-998877|ห้อง 402|NOTE-INTERNAL)') then
    raise exception 'FAIL: audit log stores secret values';
  end if;
  raise notice 'PASS T10a: every step of the flow is in the audit log, without secret values';
end $$;
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select pg_temp.expect_fail('update public.audit_logs set action = action', 'admin edits audit log', 'permission denied|AUDIT');
select pg_temp.expect_fail('delete from public.audit_logs', 'admin deletes audit log', 'permission denied|AUDIT');
reset role;
select pg_temp.expect_fail('delete from public.audit_logs', 'service role deletes audit log', 'AUDIT');

-- =========================================================
-- T11. Forced password change enforced in the database (0026)
-- =========================================================
select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
do $$ begin
  if public.is_admin() or public.is_staff_or_admin() or public.current_user_role() <> 'user' then
    raise exception 'FAIL: admin powers before changing the initial password';
  end if;
  if pg_temp.rows_of('select * from public.audit_logs') <> 0 then raise exception 'FAIL: pending admin reads audit log'; end if;
  raise notice 'PASS T11a: admin with a pending password change has no admin/staff power';
end $$;
select pg_temp.expect_fail($q$ select public.admin_stats(current_date - 30, current_date) $q$, 'pending admin reads statistics', 'FORBIDDEN');
select pg_temp.expect_fail($q$ update public.profiles set must_change_password = false where id = auth.uid() $q$,
  'clear the flag without changing the password', 'PASSWORD_CHANGE_REQUIRED');
reset role;
update auth.users set encrypted_password = 'h-p-changed' where id = '99999999-9999-4999-8999-999999999999';  -- supabase.auth.updateUser
select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
update public.profiles set must_change_password = false where id = auth.uid();
do $$ begin
  if not public.is_admin() then raise exception 'FAIL: admin power not restored after password change'; end if;
  raise notice 'PASS T11b: flag clears only after a real password change; admin power returns';
end $$;
reset role;

-- =========================================================
-- T12. Restricted staff lose staff power; identity fields admin-only (0026)
-- =========================================================
select pg_temp.act_as('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select public.set_account_restriction('55555555-5555-4555-8555-555555555555', true, 'ทดสอบ');
reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
do $$ begin
  if public.is_staff_or_admin() or pg_temp.rows_of('select * from public.claims') <> 0 then
    raise exception 'FAIL: restricted staff still has staff access';
  end if;
  raise notice 'PASS T12a: restricted staff account loses staff access';
end $$;
reset role;

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.expect_fail($q$ update public.profiles set email = 'admin@cdti.ac.th' where id = auth.uid() $q$, 'user changes own email', 'PROFILE_FORBIDDEN');
select pg_temp.expect_fail($q$ update public.profiles set user_type = 'teacher_staff' where id = auth.uid() $q$, 'user changes own user_type', 'PROFILE_FORBIDDEN');
select pg_temp.expect_fail($q$ update public.profiles set full_name = repeat('ก', 200) where id = auth.uid() $q$, 'over-long full_name', 'PROFILE_INVALID');
select pg_temp.expect_fail($q$ insert into public.password_change_markers (user_id) values (auth.uid()) $q$, 'user writes password markers', 'permission denied');
do $$ begin
  if pg_temp.affected($q$update public.profiles set full_name = 'UserB ใหม่', phone = '0812345678' where id = auth.uid()$q$) <> 1 then
    raise exception 'FAIL: user cannot edit own name/phone';
  end if;
  raise notice 'PASS T12b: email/user_type admin-only; name/phone still editable';
end $$;
reset role;

select 'ok';
\o
select ' ALL PHASE 11 SECURITY TESTS PASSED';
