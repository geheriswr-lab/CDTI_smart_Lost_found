-- Verify migration 0026 (Phase 11 — Security hardening). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน. Safe to run before 0026 (rows show ❌ instead of erroring).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result, coalesce(detail, '') as detail
from (
  select 'สิทธิ์ admin/staff ใช้ไม่ได้จนกว่าจะเปลี่ยนรหัสผ่าน / ถูกจำกัดสิทธิ์' as check_name,
    (select bool_and(pg_get_functiondef(p.oid) ~ 'must_change_password' and pg_get_functiondef(p.oid) ~ 'is_restricted')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('is_admin', 'is_staff_or_admin', 'current_user_role')) as ok,
    null::text as detail
  union all
  select 'ปลดธง "ต้องเปลี่ยนรหัส" ได้เฉพาะเมื่อเปลี่ยนรหัสจริง',
    to_regclass('public.password_change_markers') is not null
    and exists (select 1 from pg_trigger where tgname = 'trg_profiles_guard_must_change_password'),
    null
  union all
  select 'ตาราง password_change_markers: RLS + ผู้ใช้เข้าไม่ได้',
    case when to_regclass('public.password_change_markers') is null then false
         else (select relrowsecurity from pg_class where oid = to_regclass('public.password_change_markers'))
          and not has_table_privilege('authenticated', to_regclass('public.password_change_markers'), 'select')
          and not has_table_privilege('anon', to_regclass('public.password_change_markers'), 'select')
    end,
    null
  union all
  select 'บัญชีที่รอเปลี่ยนรหัสมี marker ครบ',
    case when to_regclass('public.password_change_markers') is null then false
         else (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.profiles p where p.must_change_password
                    and not exists (select 1 from public.password_change_markers m where m.user_id = p.id)',
                 false, true, '')))[1]::text = '0'
    end,
    (select count(*)::text || ' บัญชีรอเปลี่ยนรหัส' from public.profiles where must_change_password)
  union all
  select 'service role / SQL editor ตั้ง role ได้ (create-admin ใช้งานได้)',
    pg_get_functiondef('public.prevent_self_role_escalation()'::regprocedure) ~ 'auth\.uid\(\) is not null',
    null
  union all
  select 'ผู้ใช้แก้ email / user_type ของตัวเองไม่ได้',
    exists (select 1 from pg_trigger where tgname = 'trg_profiles_guard_identity'),
    null
  union all
  select 'ผู้พบแก้จุดสังเกตลับไม่ได้หลังมีคนขอรับ',
    exists (select 1 from pg_trigger where tgname = 'trg_found_items_secret_lock'),
    null
  union all
  select 'guest อ่านตาราง profiles ไม่ได้',
    not has_table_privilege('anon', 'public.profiles', 'select'),
    null
  union all
  select 'guest เรียกฟังก์ชันได้เฉพาะ is_admin / is_staff_or_admin',
    s.bad is null, s.bad
  from (select string_agg(p.proname, ', ') as bad
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          and p.proname not in ('is_admin', 'is_staff_or_admin')
          and has_function_privilege('anon', p.oid, 'execute')) s
  union all
  select 'guest แก้ไข/เพิ่ม/ลบ ตารางใด ๆ ไม่ได้',
    s.bad is null, s.bad
  from (select string_agg(distinct table_name || ':' || privilege_type, ', ') as bad
        from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'
          and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) s
  union all
  select 'ไม่มีใคร (anon/authenticated) TRUNCATE ได้',
    s.bad is null, s.bad
  from (select string_agg(distinct table_name, ', ') as bad
        from information_schema.role_table_grants
        where grantee in ('anon', 'authenticated') and table_schema = 'public' and privilege_type = 'TRUNCATE') s
  union all
  select 'ผู้ใช้เขียน matches / สร้าง-ลบ notifications เองไม่ได้',
    not has_table_privilege('authenticated', 'public.matches', 'insert')
    and not has_table_privilege('authenticated', 'public.matches', 'delete')
    and not has_table_privilege('authenticated', 'public.notifications', 'insert')
    and not has_table_privilege('authenticated', 'public.notifications', 'delete'),
    null
  union all
  select 'ฟังก์ชันภายใน (assert_max_len, try_uuid, raise_risk_event) ผู้ใช้เรียกไม่ได้',
    not coalesce(has_function_privilege('authenticated', to_regprocedure('public.assert_max_len(text,integer,text)'), 'execute'), true)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.try_uuid(text)'), 'execute'), true)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.raise_risk_event(text,risk_level_enum,uuid,uuid,uuid,jsonb)'), 'execute'), true),
    null
  union all
  select 'ทุกตารางเปิด RLS',
    s.bad is null, s.bad
  from (select string_agg(c.relname, ', ') as bad
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) s
  union all
  select 'ฟังก์ชัน SECURITY DEFINER ทุกตัวกำหนด search_path',
    s.bad is null, s.bad
  from (select string_agg(p.proname, ', ') as bad
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) s
) t;
