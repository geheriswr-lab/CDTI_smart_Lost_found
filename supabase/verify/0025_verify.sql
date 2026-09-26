-- Verify migration 0025 (Phase 10 — Admin Dashboard). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน. Safe to run before 0025 (rows show ❌ instead of erroring).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('ฟังก์ชันสถิติ / ความผิดปกติ / ส่งต่อเรื่อง ครบ',
    (select count(*) from pg_proc where proname in
      ('admin_stats','admin_custody_anomalies','escalate_case','resolve_escalation') and prosecdef) = 4),
  ('guest เรียกฟังก์ชัน admin ไม่ได้',
    case when to_regprocedure('public.admin_stats(date,date)') is null then false
         else not has_function_privilege('anon', to_regprocedure('public.admin_stats(date,date)'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.admin_custody_anomalies()'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.escalate_case(text,uuid,text)'), 'execute')
    end),
  ('ตาราง case_escalations มี + RLS + เขียนตรงไม่ได้',
    case when to_regclass('public.case_escalations') is null then false
         else (select relrowsecurity from pg_class where oid = to_regclass('public.case_escalations'))
          and not has_table_privilege('authenticated', to_regclass('public.case_escalations'), 'insert')
          and not has_table_privilege('anon', to_regclass('public.case_escalations'), 'select')
    end),
  ('บันทึกภายใน: ลบได้เฉพาะผู้เขียน/admin และแก้ไขไม่ได้',
    exists (select 1 from pg_policies where tablename='internal_notes' and policyname='internal_notes_delete_author_or_admin')
    and not exists (select 1 from pg_policies where tablename='internal_notes' and policyname='internal_notes_delete_staff')
    and not has_table_privilege('authenticated','public.internal_notes','update')),
  ('บันทึกภายใน: ตรวจความยาว',
    exists (select 1 from pg_constraint where conname='internal_notes_note_len')),
  ('ประเภท/สถานที่: ตรวจชื่อ และลบไม่ได้ (ปิดใช้แทน)',
    (select count(*) from pg_constraint where conname in ('categories_name_len','locations_name_len')) = 2
    and not has_table_privilege('authenticated','public.categories','delete')
    and not has_table_privilege('authenticated','public.locations','delete')),
  ('admin เพิ่ม/แก้ประเภทและสถานที่ได้ (policy เดิม)',
    (select count(*) from pg_policies where policyname in ('categories_write_admin','locations_write_admin')) = 2)
) as t(check_name, ok);
