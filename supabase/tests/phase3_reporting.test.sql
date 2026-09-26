-- =========================================================
-- Phase 3 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase3_reporting.test.sql
-- Every block raises an exception on failure; prints "PASS" lines otherwise.
-- =========================================================
\set ON_ERROR_STOP 1

-- Supabase grants table privileges to these roles by default; mirror that.
grant all on all tables in schema public to anon, authenticated;
grant select, insert on storage.objects to authenticated;
create policy stub_objects_all on storage.objects for all using (true) with check (true);

-- Fixtures (as superuser / service context)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test', '{"full_name":"User A","user_type":"university_student"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@test', '{"full_name":"User B","user_type":"university_student"}'),
  ('33333333-3333-3333-3333-333333333333', 's@test', '{"full_name":"Staff","user_type":"teacher_staff"}'),
  ('44444444-4444-4444-4444-444444444444', 'r@test', '{"full_name":"Restricted","user_type":"external_visitor"}');
-- bypass profile-protection triggers for fixture setup only
set session_replication_role = replica;
update public.profiles set role = 'staff' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set is_restricted = true where id = '44444444-4444-4444-4444-444444444444';
set session_replication_role = origin;

insert into storage.objects (bucket_id, name) values
  ('item-images-public',   '11111111-1111-1111-1111-111111111111/found/pub.jpg'),
  ('verification-private', '11111111-1111-1111-1111-111111111111/found/priv.jpg'),
  ('verification-private', '22222222-2222-2222-2222-222222222222/lost/b-priv.jpg');

-- Helper to act as a user
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
-- 1. User A reports a found item with private fields + images
-- ---------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into public.found_items (finder_id, general_name, color, found_date, public_image_url,
  private_image_url, exact_location, serial_number, secret_details, custody_status, status)
values ('11111111-1111-1111-1111-111111111111', 'โทรศัพท์', 'ดำ', current_date,
  '11111111-1111-1111-1111-111111111111/found/pub.jpg',
  '11111111-1111-1111-1111-111111111111/found/priv.jpg',
  'โต๊ะที่ 3 โรงอาหาร', 'SN-123', 'สติกเกอร์แมวด้านหลัง', 'with_finder',
  'verified' /* attempt to skip the workflow — must be forced back to reported */);

do $$ begin
  if (select status from public.found_items limit 1) <> 'reported' then
    raise exception 'FAIL: status not forced to reported';
  end if;
  raise notice 'PASS: found item created, status forced to reported';
end $$;

-- Invalid initial custody
select pg_temp.expect_fail($q$
  insert into public.found_items (finder_id, general_name, custody_status)
  values ('11111111-1111-1111-1111-111111111111', 'x', 'in_storage') $q$,
  'finder self-declares in_storage');

-- External URL instead of own upload
select pg_temp.expect_fail($q$
  insert into public.found_items (finder_id, general_name, public_image_url)
  values ('11111111-1111-1111-1111-111111111111', 'x', 'https://evil.example/x.jpg') $q$,
  'public_image_url pointing to external URL');

-- Someone else's private evidence file
select pg_temp.expect_fail($q$
  insert into public.lost_items (reporter_id, item_name, private_image_url)
  values ('11111111-1111-1111-1111-111111111111', 'x', '22222222-2222-2222-2222-222222222222/lost/b-priv.jpg') $q$,
  'private_image_url referencing another user''s file');

-- Public image path pointing at the private bucket object
select pg_temp.expect_fail($q$
  insert into public.lost_items (reporter_id, item_name, public_image_url)
  values ('11111111-1111-1111-1111-111111111111', 'x', '11111111-1111-1111-1111-111111111111/found/priv.jpg') $q$,
  'public_image_url pointing to a private-bucket object');

-- Future date
select pg_temp.expect_fail($q$
  insert into public.lost_items (reporter_id, item_name, lost_date)
  values ('11111111-1111-1111-1111-111111111111', 'x', current_date + 5) $q$,
  'lost_date in the future');

-- Reporting on behalf of someone else (RLS)
select pg_temp.expect_fail($q$
  insert into public.lost_items (reporter_id, item_name)
  values ('22222222-2222-2222-2222-222222222222', 'x') $q$,
  'insert with another user''s reporter_id');

-- Oversized text
select pg_temp.expect_fail($q$
  insert into public.lost_items (reporter_id, item_name, description)
  values ('11111111-1111-1111-1111-111111111111', 'x', repeat('a', 2001)) $q$,
  'description over 2000 chars');

-- Owner cannot change custody/status afterwards
select pg_temp.expect_fail($q$
  update public.found_items set custody_status = 'released_to_owner' $q$,
  'finder changes custody_status after creation');

-- Valid lost report
insert into public.lost_items (reporter_id, item_name, brand, color, lost_date, private_ownership_details)
values ('11111111-1111-1111-1111-111111111111', 'กระเป๋าสตางค์', 'Coach', 'น้ำตาล', current_date, 'มีรูปถ่ายครอบครัวในช่องใส');
do $$ begin raise notice 'PASS: lost item created'; end $$;

-- Owner can edit descriptive fields
update public.lost_items set description = 'แก้ไขรายละเอียด';
do $$ begin raise notice 'PASS: owner edits description'; end $$;

reset role;

-- ---------------------------------------------------------
-- 2. User B cannot see A's private data; public view hides it
-- ---------------------------------------------------------
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

do $$ begin
  if (select count(*) from public.found_items) <> 0 or (select count(*) from public.lost_items) <> 0 then
    raise exception 'FAIL: user B can read user A base-table rows';
  end if;
  if (select count(*) from public.public_found_items) <> 1 then
    raise exception 'FAIL: public view should show the found item';
  end if;
  raise notice 'PASS: user B sees 0 base rows, 1 public row';
end $$;

select pg_temp.expect_fail($q$ select secret_details from public.public_found_items $q$,
  'public view exposes secret_details');
select pg_temp.expect_fail($q$ select private_ownership_details from public.public_lost_items $q$,
  'public view exposes private_ownership_details');

-- B cannot update A's item (RLS silently matches 0 rows)
update public.found_items set general_name = 'hacked';
reset role;
do $$ begin
  if exists (select 1 from public.found_items where general_name = 'hacked') then
    raise exception 'FAIL: user B updated user A item';
  end if;
  raise notice 'PASS: user B cannot update A''s item';
end $$;

-- ---------------------------------------------------------
-- 3. Audit + custody rows written, without secrets
-- ---------------------------------------------------------
do $$ begin
  if (select count(*) from public.audit_logs where action in ('found_item.created','lost_item.created')) <> 2 then
    raise exception 'FAIL: expected 2 audit rows';
  end if;
  if exists (select 1 from public.audit_logs
             where metadata::text ~* '(SN-123|สติกเกอร์|โต๊ะที่ 3|รูปถ่ายครอบครัว|priv\.jpg)') then
    raise exception 'FAIL: audit metadata leaks private data';
  end if;
  if (select count(*) from public.custody_history where to_status = 'with_finder' and from_status is null) <> 1 then
    raise exception 'FAIL: custody_history initial row missing';
  end if;
  raise notice 'PASS: audit + custody history written, no secrets in metadata';
end $$;

-- ---------------------------------------------------------
-- 4. Restricted user cannot report; staff can manage custody
-- ---------------------------------------------------------
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select pg_temp.expect_fail($q$
  insert into public.lost_items (reporter_id, item_name)
  values ('44444444-4444-4444-4444-444444444444', 'x') $q$,
  'restricted account creates report');
reset role;

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
update public.found_items set custody_status = 'in_storage', status = 'in_custody';
reset role;
do $$ begin
  if (select custody_status from public.found_items limit 1) <> 'in_storage' then
    raise exception 'FAIL: staff could not update custody';
  end if;
  raise notice 'PASS: staff updates custody/status';
end $$;

-- ---------------------------------------------------------
-- 5. Rate limit (10 / hour)
-- ---------------------------------------------------------
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
do $$ begin
  for i in 1..10 loop
    insert into public.lost_items (reporter_id, item_name) values ('22222222-2222-2222-2222-222222222222', 'item ' || i);
  end loop;
end $$;
select pg_temp.expect_fail($q$
  insert into public.lost_items (reporter_id, item_name)
  values ('22222222-2222-2222-2222-222222222222', 'eleventh') $q$,
  '11th report within an hour');
reset role;

-- ---------------------------------------------------------
-- 6. Clients cannot write audit_logs / custody_history directly
-- ---------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_fail($q$
  insert into public.audit_logs (actor_id, action, entity_type) values (auth.uid(), 'fake', 'x') $q$,
  'client inserts audit_logs');
select pg_temp.expect_fail($q$
  insert into public.custody_history (found_item_id, to_status)
  select id, 'released_to_owner' from public.found_items limit 1 $q$,
  'client inserts custody_history');
reset role;

do $$ begin raise notice 'ALL PHASE 3 DB TESTS PASSED'; end $$;
