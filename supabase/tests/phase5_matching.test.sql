-- =========================================================
-- Phase 5 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase5_matching.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

-- Supabase default grants, then re-apply the migration's column-level rules
grant all on all tables in schema public to anon, authenticated;
revoke all on public.lost_items from anon;
revoke all on public.found_items from anon;
revoke all on public.matches from anon;
revoke all on public.notifications from anon;
revoke update on public.notifications from anon, authenticated;
grant update (is_read) on public.notifications to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test',  '{"full_name":"Owner","user_type":"university_student"}'),
  ('22222222-2222-2222-2222-222222222222', 'finder@test', '{"full_name":"Finder","user_type":"university_student"}'),
  ('33333333-3333-3333-3333-333333333333', 'other@test',  '{"full_name":"Other","user_type":"university_student"}');

-- Items + a match + a notification, created in service context (like the matching job)
insert into public.lost_items (id, reporter_id, item_name, private_ownership_details)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'โทรศัพท์', 'x');
insert into public.found_items (id, finder_id, general_name, secret_details)
values ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'โทรศัพท์', 'y');
insert into public.matches (lost_item_id, found_item_id, score, score_breakdown)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 85, '{"category":30}');
insert into public.notifications (user_id, type, title, message)
values ('11111111-1111-1111-1111-111111111111', 'potential_match', 'พบรายการที่อาจตรงกัน', 'msg');

create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'PASS (rejected): % -> %', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: expected rejection: %', label;
end $$;

-- ---------------------------------------------------------
-- Owner: sees match + notification, may only mark it read
-- ---------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
do $$ begin
  if (select count(*) from public.matches) <> 1 then raise exception 'FAIL: owner should see own match'; end if;
  if (select count(*) from public.notifications) <> 1 then raise exception 'FAIL: owner should see own notification'; end if;
  raise notice 'PASS: owner sees own match and notification';
end $$;

update public.notifications set is_read = true;
do $$ begin
  if not (select is_read from public.notifications limit 1) then raise exception 'FAIL: mark read'; end if;
  raise notice 'PASS: owner marks notification read';
end $$;

select pg_temp.expect_fail($q$ update public.notifications set message = 'forged' $q$, 'owner rewrites notification message');
select pg_temp.expect_fail($q$ update public.notifications set user_id = '33333333-3333-3333-3333-333333333333' $q$, 'owner reassigns notification');
select pg_temp.expect_fail($q$
  insert into public.notifications (user_id, type, title, message)
  values ('11111111-1111-1111-1111-111111111111', 'potential_match', 'fake', 'fake') $q$, 'client inserts notification');
select pg_temp.expect_fail($q$
  insert into public.matches (lost_item_id, found_item_id, score)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 100) $q$, 'client inserts match');
update public.matches set score = 100;  -- no UPDATE policy: silently 0 rows
reset role;
do $$ begin
  if (select score from public.matches limit 1) <> 85 then raise exception 'FAIL: client changed match score'; end if;
  raise notice 'PASS: client cannot change match score';
end $$;

-- ---------------------------------------------------------
-- Unrelated user sees nothing
-- ---------------------------------------------------------
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
do $$ begin
  if (select count(*) from public.matches) <> 0 or (select count(*) from public.notifications) <> 0 then
    raise exception 'FAIL: unrelated user sees match/notification';
  end if;
  raise notice 'PASS: unrelated user sees no matches or notifications';
end $$;
reset role;

-- Anon sees nothing
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect_fail($q$ select * from public.matches $q$, 'anon reads matches');
select pg_temp.expect_fail($q$ select * from public.notifications $q$, 'anon reads notifications');
reset role;

\o
select 'ALL PHASE 5 DB TESTS PASSED';
