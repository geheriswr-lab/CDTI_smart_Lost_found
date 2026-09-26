-- =========================================================
-- Phase 11 — Security self-test (run AFTER 0026).
-- Paste into Supabase SQL Editor → Run. Every row should say ✅ ผ่าน.
--
-- Creates throw-away users/items/claims, tries each attack from README
-- Phase 11 as the right role, then ROLLS EVERYTHING BACK (the inner block
-- ends by raising an exception), so nothing is left in the database —
-- no users, no items, no audit rows, no notifications.
-- =========================================================
create temp table if not exists st_results (n int, test text, ok boolean, info text);
truncate st_results;

-- Returns 'OK' or the error message (runs as whatever role is active).
create or replace function pg_temp.st_try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;
create or replace function pg_temp.st_rows(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') q' into n;
  return n;
end $$;
create or replace function pg_temp.st_affected(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.st_try(text), pg_temp.st_rows(text), pg_temp.st_affected(text) to anon, authenticated;

do $selftest$
declare
  -- test users (random ids; everything is rolled back)
  u_a uuid := gen_random_uuid();  u_b uuid := gen_random_uuid();  u_f uuid := gen_random_uuid();
  u_c uuid := gen_random_uuid();  u_e uuid := gen_random_uuid();  u_s uuid := gen_random_uuid();
  u_x uuid := gen_random_uuid();  u_p uuid := gen_random_uuid();
  lost1 uuid := gen_random_uuid();
  f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid(); f3 uuid := gen_random_uuid(); f4 uuid := gen_random_uuid();
  loc uuid;
  c_claim uuid; e_claim uuid; code text; r text; n bigint;
  names text[] := '{}'; oks boolean[] := '{}'; infos text[] := '{}';
begin
  begin
    -- ---------- fixtures (service context: no JWT) ----------
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    insert into auth.users (id, email, raw_user_meta_data, encrypted_password)
    select id, 'st-' || id || '@selftest.invalid',
           jsonb_build_object('full_name', nm, 'user_type', 'university_student'), 'selftest-hash-' || id
    from (values (u_a,'ST-A'),(u_b,'ST-B'),(u_f,'ST-F'),(u_c,'ST-C'),(u_e,'ST-E'),(u_s,'ST-S'),(u_x,'ST-X'),(u_p,'ST-P')) v(id, nm);
    update public.profiles set role = 'staff' where id = u_s;
    update public.profiles set role = 'admin' where id = u_x;
    update public.profiles set role = 'admin', must_change_password = true where id = u_p;
    insert into public.handover_locations (name) values ('ST จุดทดสอบ') returning id into loc;

    -- A reports a lost item; F reports found items with secrets
    perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_a::text, true);
    set local role authenticated;
    insert into public.lost_items (id, reporter_id, item_name, private_ownership_details)
    values (lost1, u_a, 'ST กระเป๋า', 'ST-SECRET-A');
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', u_f, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_f::text, true);
    set local role authenticated;
    insert into public.found_items (id, finder_id, general_name, secret_details, serial_number, exact_location, custody_status)
    values (f1, u_f, 'ST กระเป๋า', 'ST-SECRET-F', 'ST-SN-123', 'ST-ห้องลับ', 'with_finder'),
           (f2, u_f, 'ST ร่ม', 'ST-S2', null, null, 'with_finder'),
           (f3, u_f, 'ST ขวด', 'ST-S3', null, null, 'with_finder'),
           (f4, u_f, 'ST หนังสือ', 'ST-S4', null, null, 'with_finder');
    reset role;

    -- ---------- 1. User B vs User A ----------
    perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_b::text, true);
    set local role authenticated;
    names := array_append(names, 'User A อ่านข้อมูลลับของ User B ไม่ได้ (lost/found/profiles)');
    n := pg_temp.st_rows(format('select 1 from public.lost_items where id = %L', lost1))
       + pg_temp.st_rows(format('select 1 from public.found_items where id = %L', f1))
       + pg_temp.st_rows(format('select 1 from public.profiles where id = %L', u_a));
    oks := array_append(oks, (n = 0)); infos := array_append(infos, format('เห็น %s แถว', n));

    names := array_append(names, 'หน้า public ไม่มีจุดสังเกตลับ / serial / ตำแหน่งละเอียด');
    n := pg_temp.st_rows($q$select 1 from public.public_found_items x where to_jsonb(x)::text ~ '(ST-SECRET|ST-SN-123|ST-ห้องลับ)'$q$)
       + pg_temp.st_rows($q$select 1 from public.public_lost_items x where to_jsonb(x)::text ~ 'ST-SECRET'$q$);
    oks := array_append(oks, (n = 0)); infos := array_append(infos, format('พบ %s แถว', n));

    names := array_append(names, 'แก้/ลบรายการของคนอื่นไม่ได้');
    n := pg_temp.st_affected(format($q$update public.lost_items set item_name = 'hacked' where id = %L$q$, lost1))
       + pg_temp.st_affected(format($q$update public.found_items set secret_details = 'hacked' where id = %L$q$, f1))
       + pg_temp.st_affected(format($q$delete from public.lost_items where id = %L$q$, lost1));
    oks := array_append(oks, (n = 0)); infos := array_append(infos, format('กระทบ %s แถว', n));

    names := array_append(names, 'ผู้ใช้เปลี่ยน role ตัวเองเป็น admin ไม่ได้');
    r := pg_temp.st_try($q$update public.profiles set role = 'admin' where id = auth.uid()$q$);
    oks := array_append(oks, (r <> 'OK')); infos := array_append(infos, r);

    names := array_append(names, 'ผู้ใช้เข้าฟังก์ชัน/ตาราง admin ไม่ได้');
    r := pg_temp.st_try($q$select public.admin_stats(current_date - 30, current_date)$q$);
    n := pg_temp.st_rows('select 1 from public.audit_logs') + pg_temp.st_rows('select 1 from public.risk_events')
       + pg_temp.st_rows('select 1 from public.claim_reviews') + pg_temp.st_rows('select 1 from public.internal_notes');
    oks := array_append(oks, (r <> 'OK' and n = 0)); infos := array_append(infos, format('%s / เห็น %s แถว', r, n));

    names := array_append(names, 'ผู้ใช้แก้ email / user_type ของตัวเองไม่ได้');
    r := pg_temp.st_try($q$update public.profiles set email = 'admin@cdti.ac.th' where id = auth.uid()$q$);
    oks := array_append(oks, (r ~ 'PROFILE_FORBIDDEN')); infos := array_append(infos, r);
    reset role;

    -- ---------- 2. Claims ----------
    perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_c::text, true);
    set local role authenticated;
    perform public.submit_claim(f1, '{"secret":"guess"}'::jsonb);
    names := array_append(names, 'ผู้ขอรับอ่าน secret_details ของของที่ขอไม่ได้');
    n := pg_temp.st_rows(format('select 1 from public.found_items where id = %L', f1))
       + pg_temp.st_rows($q$select 1 from public.claims x where to_jsonb(x)::text ~ '(ST-SECRET|ST-SN-123)'$q$)
       + pg_temp.st_rows($q$select 1 from public.notifications x where to_jsonb(x)::text ~ '(ST-SECRET|ST-SN-123|ST-ห้องลับ)'$q$);
    oks := array_append(oks, (n = 0)); infos := array_append(infos, format('พบ %s แถว', n));

    names := array_append(names, 'ขอรับของชิ้นเดิมซ้ำไม่ได้');
    r := pg_temp.st_try(format($q$select public.submit_claim(%L, '{}')$q$, f1));
    oks := array_append(oks, (r <> 'OK')); infos := array_append(infos, r);

    names := array_append(names, 'ขอรับเกินโควตาต่อวันไม่ได้ (rate limit)');
    perform public.submit_claim(f2, '{}'::jsonb);
    perform public.submit_claim(f3, '{}'::jsonb);
    r := pg_temp.st_try(format($q$select public.submit_claim(%L, '{}')$q$, f4));
    oks := array_append(oks, (r ~ 'RATE_LIMIT')); infos := array_append(infos, r);
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', u_f, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_f::text, true);
    set local role authenticated;
    names := array_append(names, 'ผู้พบแก้จุดสังเกตลับหลังมีคนขอรับไม่ได้');
    r := pg_temp.st_try(format($q$update public.found_items set secret_details = 'guess' where id = %L$q$, f1));
    oks := array_append(oks, (r ~ 'REPORT_LOCKED')); infos := array_append(infos, r);
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_e::text, true);
    set local role authenticated;
    perform public.submit_claim(f1, '{"secret":"other"}'::jsonb);
    reset role;
    names := array_append(names, 'มีผู้ขอรับหลายคน → เป็นข้อพิพาท');
    select count(*) into n from public.claims where found_item_id = f1 and status = 'disputed';
    oks := array_append(oks, (n = 2)); infos := array_append(infos, format('disputed %s คำขอ', n));
    select id into c_claim from public.claims where found_item_id = f1 and claimant_id = u_c;
    select id into e_claim from public.claims where found_item_id = f1 and claimant_id = u_e;

    -- Staff settles: E rejected with an internal note, C approved
    perform set_config('request.jwt.claims', json_build_object('sub', u_s, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_s::text, true);
    set local role authenticated;
    perform public.review_claim(c_claim, 'likely_owner');
    names := array_append(names, 'อนุมัติระหว่างข้อพิพาทไม่ได้');
    r := pg_temp.st_try(format($q$select public.review_claim(%L, 'approved')$q$, c_claim));
    oks := array_append(oks, (r ~ 'DISPUTED')); infos := array_append(infos, r);
    perform public.review_claim(e_claim, 'rejected', '{}'::jsonb, 'ST-NOTE-INTERNAL');
    perform public.review_claim(c_claim, 'approved');
    perform public.record_custody_transfer(f1, 'in_storage', loc);
    names := array_append(names, 'เจ้าหน้าที่อ่าน hash รหัสส่งมอบไม่ได้');
    r := pg_temp.st_try('select * from public.handover_codes');
    oks := array_append(oks, (r <> 'OK')); infos := array_append(infos, r);
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', u_e, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_e::text, true);
    set local role authenticated;
    names := array_append(names, 'ผู้ถูกปฏิเสธไม่ได้คำใบ้ (ไม่เห็นบันทึก/ของ/ผู้ขอคนอื่น)');
    n := pg_temp.st_rows('select 1 from public.claim_reviews') + pg_temp.st_rows('select 1 from public.found_items')
       + pg_temp.st_rows('select 1 from public.risk_events')
       + pg_temp.st_rows($q$select 1 from public.notifications x where to_jsonb(x)::text ~ '(ST-NOTE-INTERNAL|ST-SECRET|ST-SN-123|ST-C)'$q$)
       + pg_temp.st_rows($q$select 1 from public.claims x where to_jsonb(x)::text ~ 'ST-NOTE-INTERNAL'$q$);
    oks := array_append(oks, (n = 0)); infos := array_append(infos, format('พบ %s แถว', n));
    reset role;

    -- ---------- 3. Handover ----------
    perform set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_c::text, true);
    set local role authenticated;
    code := public.issue_handover_code(c_claim);
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', u_s, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_s::text, true);
    set local role authenticated;
    r := public.complete_handover(c_claim, code, loc);
    names := array_append(names, 'รหัสส่งมอบใช้ได้ครั้งเดียว');
    oks := array_append(oks, (r = 'completed' and pg_temp.st_try(format($q$do $x$ begin if public.complete_handover(%L, %L, %L) = 'completed' then raise exception 'reused'; end if; end $x$$q$, c_claim, code, loc)) <> 'OK'));
    infos := array_append(infos, ('ครั้งแรก: ' || r));
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_b::text, true);
    set local role authenticated;
    names := array_append(names, 'ของที่ส่งคืนแล้วขอรับซ้ำไม่ได้');
    r := pg_temp.st_try(format($q$select public.submit_claim(%L, '{}')$q$, f1));
    oks := array_append(oks, (r ~ 'NOT_AVAILABLE')); infos := array_append(infos, r);
    reset role;

    -- ---------- 4. Audit ----------
    names := array_append(names, 'Audit log ครบทุกขั้น และไม่เก็บค่าลับ');
    select string_agg(a, ', ') into r
    from unnest(array['lost_item.created','found_item.created','claim.submitted','claim.disputed','claim.reviewed',
                      'custody.changed','handover.code_issued','handover.completed']) a
    where not exists (select 1 from public.audit_logs l where l.action = a and l.created_at >= now() - interval '1 minute');
    select count(*) into n from public.audit_logs l
    where l.created_at >= now() - interval '1 minute' and to_jsonb(l)::text ~ '(ST-SECRET|ST-SN-123|ST-ห้องลับ|ST-NOTE-INTERNAL)';
    oks := array_append(oks, (r is null and n = 0)); infos := array_append(infos, coalesce('ขาด: ' || r, '') || case when n > 0 then ' มีค่าลับ ' || n else '' end);

    names := array_append(names, 'Audit log แก้/ลบไม่ได้ (แม้ service role)');
    r := pg_temp.st_try('delete from public.audit_logs where created_at >= now() - interval ''1 minute''');
    oks := array_append(oks, (r <> 'OK')); infos := array_append(infos, r);

    -- ---------- 5. Forced password change ----------
    perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_p::text, true);
    set local role authenticated;
    names := array_append(names, 'admin ที่ยังไม่เปลี่ยนรหัส ใช้สิทธิ์ admin ไม่ได้');
    oks := array_append(oks, (not public.is_admin() and not public.is_staff_or_admin())); infos := array_append(infos, '');
    names := array_append(names, 'ปลดธงเปลี่ยนรหัสโดยไม่เปลี่ยนรหัสจริงไม่ได้');
    r := pg_temp.st_try('update public.profiles set must_change_password = false where id = auth.uid()');
    oks := array_append(oks, (r ~ 'PASSWORD_CHANGE_REQUIRED')); infos := array_append(infos, r);
    reset role;

    -- ---------- 6. Guest (anon) ----------
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;
    names := array_append(names, 'Guest อ่าน profiles / claims / หลักฐาน ไม่ได้');
    oks := array_append(oks, (pg_temp.st_try('select * from public.profiles') <> 'OK'
                   and pg_temp.st_try('select * from public.claims') <> 'OK'
                   and pg_temp.st_try('select * from public.claim_evidence') <> 'OK'
                   and pg_temp.st_rows($q$select 1 from storage.objects where bucket_id = 'verification-private'$q$) = 0));
    infos := array_append(infos, '');
    names := array_append(names, 'Guest ดูหน้า public ได้ตามปกติ');
    r := pg_temp.st_try('select * from public.public_found_items limit 1');
    oks := array_append(oks, (r = 'OK')); infos := array_append(infos, r);
    reset role;

    raise exception using message = '__selftest_rollback__';
  exception when others then
    if sqlerrm <> '__selftest_rollback__' then
      names := array_append(names, 'ข้อผิดพลาดระหว่างทดสอบ (ดู info)');
      oks := array_append(oks, false);
      infos := array_append(infos, sqlerrm);
    end if;
  end;

  insert into st_results
  select i, names[i], oks[i], infos[i] from generate_subscripts(names, 1) i;
end
$selftest$;

select n as "#", test as "การทดสอบ", case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result, info
from st_results order by n;
