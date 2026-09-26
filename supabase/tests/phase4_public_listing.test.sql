-- =========================================================
-- Phase 4 DB tests — run on a throwaway Postgres (NOT production):
--   psql -d <testdb> -f supabase/tests/supabase_stub.sql
--   psql -d <testdb> -f supabase/setup_all.sql
--   psql -d <testdb> -v ON_ERROR_STOP=1 -f supabase/tests/phase4_public_listing.test.sql
-- =========================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\o /dev/null

-- Supabase default privileges, then re-apply 0019's revokes on top of them
-- (Supabase grants happen at table-creation time, before 0019 runs).
grant all on all tables in schema public to anon, authenticated;
revoke all on public.lost_items from anon;
revoke all on public.found_items from anon;
grant select, insert on storage.objects to authenticated;
create policy stub_objects_all on storage.objects for all using (true) with check (true);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test', '{"full_name":"Finder A","user_type":"university_student"}');

insert into storage.objects (bucket_id, name, owner_id) values
  ('item-images-public',   'found/2b9e0c34-aaaa-bbbb-cccc-000000000001.jpg', '11111111-1111-1111-1111-111111111111'),
  ('item-images-public',   'found/2b9e0c34-aaaa-bbbb-cccc-000000000002.jpg', '99999999-9999-9999-9999-999999999999'),
  ('verification-private', '11111111-1111-1111-1111-111111111111/found/p.jpg', '11111111-1111-1111-1111-111111111111');

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
-- 1. Finder reports with an anonymous public image path
-- ---------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

insert into public.found_items (finder_id, general_name, color, found_date, public_image_url, private_image_url,
  exact_location, serial_number, secret_details, custody_status)
values ('11111111-1111-1111-1111-111111111111', 'โทรศัพท์', 'ดำ', current_date,
  'found/2b9e0c34-aaaa-bbbb-cccc-000000000001.jpg', '11111111-1111-1111-1111-111111111111/found/p.jpg',
  'โต๊ะ 3', 'SN-777', 'สติกเกอร์แมว', 'with_finder');

-- Cannot claim someone else's anonymous upload as your image
select pg_temp.expect_fail($q$
  insert into public.found_items (finder_id, general_name, public_image_url)
  values ('11111111-1111-1111-1111-111111111111', 'x', 'found/2b9e0c34-aaaa-bbbb-cccc-000000000002.jpg') $q$,
  'public_image_url owned by another user');

insert into public.lost_items (reporter_id, item_name, color, lost_date, private_ownership_details)
values ('11111111-1111-1111-1111-111111111111', 'กระเป๋าสตางค์', 'น้ำตาล', current_date, 'รูปครอบครัว');
reset role;

-- A returned item must disappear from the public listing (inserted as service context)
select set_config('request.jwt.claim.sub', '', false);
insert into public.found_items (finder_id, general_name, status, custody_status, secret_details)
values ('11111111-1111-1111-1111-111111111111', 'returned-item', 'returned', 'released_to_owner', 'x');

-- ---------------------------------------------------------
-- 2. Anonymous (guest) access
-- ---------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
set role anon;

do $$ begin
  if (select count(*) from public.public_found_items) <> 1 then
    raise exception 'FAIL: anon should see exactly 1 public found item (returned one hidden)';
  end if;
  if (select count(*) from public.public_lost_items) <> 1 then
    raise exception 'FAIL: anon should see 1 public lost item';
  end if;
  raise notice 'PASS: anon reads public views; returned item hidden';
end $$;

select pg_temp.expect_fail($q$ select * from public.found_items $q$, 'anon selects found_items base table');
select pg_temp.expect_fail($q$ select * from public.lost_items $q$, 'anon selects lost_items base table');
select pg_temp.expect_fail($q$ select secret_details from public.public_found_items $q$, 'secret_details via view');

do $$
declare j text;
begin
  select coalesce(json_agg(v)::text, '') into j from public.public_found_items v;
  if j ~ '(SN-777|สติกเกอร์แมว|โต๊ะ 3|11111111-1111-1111-1111-111111111111|/p\.jpg)' then
    raise exception 'FAIL: public found row leaks private data or finder id: %', j;
  end if;
  select coalesce(json_agg(v)::text, '') into j from public.public_lost_items v;
  if j ~ '(รูปครอบครัว|11111111-1111-1111-1111-111111111111)' then
    raise exception 'FAIL: public lost row leaks private data or reporter id: %', j;
  end if;
  raise notice 'PASS: full public rows contain no secret / serial / exact location / identity';
end $$;
reset role;

-- ---------------------------------------------------------
-- 3. View column whitelist is exactly what we expect
-- ---------------------------------------------------------
do $$
declare cols text;
begin
  select string_agg(column_name, ',' order by column_name) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'public_found_items';
  if cols <> 'category_id,category_name_en,category_name_th,color,created_at,description,found_date,general_name,id,location_id,location_name,public_image_url,status' then
    raise exception 'FAIL: public_found_items columns changed: %', cols;
  end if;

  select string_agg(column_name, ',' order by column_name) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'public_lost_items';
  if cols <> 'category_id,category_name_en,category_name_th,color,created_at,description,id,item_name,location_id,location_name,lost_date,public_image_url,status' then
    raise exception 'FAIL: public_lost_items columns changed: %', cols;
  end if;
  raise notice 'PASS: view column whitelists unchanged';
end $$;

-- ---------------------------------------------------------
-- 4. Storage policy shape for public uploads
-- ---------------------------------------------------------
do $$
declare chk text;
begin
  select with_check into chk from pg_policies
  where schemaname = 'storage' and policyname = 'storage_public_images_insert_anonymous_path';
  if chk is null or chk !~ 'lost' or chk ~ 'auth.uid' then
    raise exception 'FAIL: public upload policy should allow lost/found folders only and not uid folders: %', chk;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'storage_public_images_insert_own_folder') then
    raise exception 'FAIL: old uid-folder upload policy still present';
  end if;
  raise notice 'PASS: public uploads use anonymous paths';
end $$;

\o
select 'ALL PHASE 4 DB TESTS PASSED';
