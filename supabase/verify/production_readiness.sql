-- =========================================================
-- Phase 12 — Production readiness check. READ-ONLY.
-- Paste into Supabase SQL Editor (production project) → Run.
-- ✅ ผ่าน = ready · ❌ ไม่ผ่าน = must fix before go-live · ⚠️ ตรวจสอบ = a human must look
-- =========================================================
with
tables as (
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
fn_anon as (
  select string_agg(p.proname, ', ') as bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and p.proname not in ('is_admin', 'is_staff_or_admin')
    and has_function_privilege('anon', p.oid, 'execute')
),
-- Accounts that look like test / demo data.
suspect_users as (
  select u.email
  from auth.users u
  where u.email ~* '(@t$|@test\.|@example\.(com|org|net)$|@selftest\.invalid$|@localhost$|^(test|demo|fake|dummy)[0-9._-]*@|\+test@)'
),
admins as (
  select p.* from public.profiles p where p.role = 'admin'
),
checks(ord, level, check_name, ok, detail) as (
  values
  (1, 'must', 'Migration ครบถึง 0026 (Phase 11)',
     to_regclass('public.password_change_markers') is not null
     and to_regclass('public.case_escalations') is not null
     and to_regprocedure('public.complete_handover(uuid,text,uuid,boolean,text,text)') is not null,
     null::text),
  (2, 'must', 'ทุกตารางเปิด RLS',
     not exists (select 1 from tables where not relrowsecurity),
     (select string_agg(relname, ', ') from tables where not relrowsecurity)),
  (3, 'must', 'guest เรียกฟังก์ชันได้เฉพาะ is_admin / is_staff_or_admin',
     (select bad from fn_anon) is null, (select bad from fn_anon)),
  (4, 'must', 'guest เขียนตารางใดไม่ได้ / ไม่มีใคร TRUNCATE ได้',
     not exists (select 1 from information_schema.role_table_grants
                 where table_schema = 'public'
                   and ((grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))
                     or (grantee = 'authenticated' and privilege_type = 'TRUNCATE'))),
     null),
  (5, 'must', 'Audit log แก้/ลบไม่ได้',
     (select count(*) from pg_trigger where tgname in ('trg_audit_logs_no_update', 'trg_audit_logs_no_truncate')) = 2
     and not has_table_privilege('authenticated', 'public.audit_logs', 'delete'),
     null),
  (6, 'must', 'bucket หลักฐาน (verification-private) เป็น private',
     coalesce((select not public from storage.buckets where id = 'verification-private'), false),
     null),
  (7, 'must', 'มี admin อย่างน้อย 1 คน',
     (select count(*) from admins) >= 1, (select count(*)::text || ' คน' from admins)),
  (8, 'must', 'admin ทุกคนเปลี่ยนรหัสผ่านเริ่มต้นแล้ว',
     not exists (select 1 from admins where must_change_password),
     (select string_agg(email, ', ') from admins where must_change_password)),
  (9, 'must', 'ไม่มีบัญชีทดสอบ / demo',
     not exists (select 1 from suspect_users),
     (select string_agg(email, ', ') from suspect_users)),
  (10, 'must', 'ไม่มีข้อมูลค้างจาก self-test',
     not exists (select 1 from public.found_items where general_name like 'ST %')
     and not exists (select 1 from public.lost_items where item_name like 'ST %')
     and not exists (select 1 from public.handover_locations where name like 'ST %'),
     null),
  (11, 'must', 'มีประเภทสิ่งของที่เปิดใช้งาน',
     (select count(*) from public.categories where is_active) > 0,
     (select count(*)::text || ' ประเภท' from public.categories where is_active)),
  (12, 'must', 'มีจุดส่งมอบที่ยืนยันแล้วอย่างน้อย 1 แห่ง (ส่งมอบของต้องใช้)',
     (select count(*) from public.handover_locations where is_active) > 0,
     (select string_agg(name, ', ') from public.handover_locations where is_active)),
  (13, 'review', 'สถานที่ (สำหรับแจ้งหาย/พบ) — ตรวจว่าเป็นสถานที่จริง',
     (select count(*) from public.locations where is_active) > 0,
     (select count(*)::text || ' แห่ง: ' || coalesce(string_agg(name, ', '), '') from public.locations where is_active)),
  (14, 'review', 'ข้อมูลใช้งานในระบบตอนนี้ (ก่อนเปิดใช้ควรเป็น 0 หรือเป็นของจริงทั้งหมด)',
     (select count(*) from public.lost_items) + (select count(*) from public.found_items) + (select count(*) from public.claims) = 0,
     format('แจ้งหาย %s · แจ้งพบ %s · คำขอ %s · ผู้ใช้ %s',
       (select count(*) from public.lost_items), (select count(*) from public.found_items),
       (select count(*) from public.claims), (select count(*) from public.profiles))),
  (15, 'review', 'ผู้ใช้ที่ยังไม่ยืนยันอีเมล',
     not exists (select 1 from auth.users where email_confirmed_at is null),
     (select count(*)::text || ' บัญชี' from auth.users where email_confirmed_at is null)),
  (16, 'review', 'เจ้าหน้าที่ / admin ทั้งหมด (ตรวจว่าเป็นคนที่ควรมีสิทธิ์)',
     false,
     (select string_agg(email || ' (' || role || ')', ', ' order by role, email) from public.profiles where role in ('staff', 'admin')))
)
select ord as "#",
       case when ok then '✅ ผ่าน' when level = 'must' then '❌ ไม่ผ่าน' else '⚠️ ตรวจสอบ' end as result,
       check_name,
       coalesce(detail, '') as detail
from checks
order by ord;
