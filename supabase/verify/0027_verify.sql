-- Verify migration 0027 (Phase 12 — แต่งตั้งเจ้าหน้าที่จากหน้า admin). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน. Safe to run before 0027 (rows show ❌ instead of erroring).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('ฟังก์ชัน set_user_role มี (SECURITY DEFINER + search_path)',
    coalesce((select prosecdef and exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
              from pg_proc where oid = to_regprocedure('public.set_user_role(uuid,system_role_enum,text)')), false)),
  ('ผู้ใช้ที่ login เรียกได้ (ฟังก์ชันตรวจ admin เอง) แต่ guest เรียกไม่ได้',
    case when to_regprocedure('public.set_user_role(uuid,system_role_enum,text)') is null then false
         else has_function_privilege('authenticated', to_regprocedure('public.set_user_role(uuid,system_role_enum,text)'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.set_user_role(uuid,system_role_enum,text)'), 'execute') end),
  ('ตรวจ admin / ห้ามเปลี่ยนสิทธิ์ตัวเอง / ต้องระบุเหตุผล / บันทึก audit',
    case when to_regprocedure('public.set_user_role(uuid,system_role_enum,text)') is null then false
         else pg_get_functiondef(to_regprocedure('public.set_user_role(uuid,system_role_enum,text)'))
              ~ 'is_admin\(\).*own role.*reason.*last admin.*user\.role_set' end),
  ('index สำหรับค้นหาผู้ใช้',
    to_regclass('public.profiles_email_lower_idx') is not null and to_regclass('public.profiles_role_idx') is not null)
) as t(check_name, ok);
