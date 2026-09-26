-- Verify migration 0023 (Phase 8 — Custody + Secure Handover). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน. Safe to run before 0023 (rows show ❌ instead of erroring).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('ไม่มีใครอ่าน/แก้ handover_codes ผ่าน API ได้ (กันเดา hash)',
    not has_table_privilege('authenticated','public.handover_codes','select')
    and not has_table_privilege('authenticated','public.handover_codes','update')
    and not exists (select 1 from pg_policies where tablename='handover_codes')),
  ('handover_codes มีตัวนับการกรอกผิด / จำนวนครั้งที่ขอรหัส',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='handover_codes'
     and column_name in ('failed_attempts','issue_count')) = 2),
  ('ตาราง handovers มี และเปิด RLS',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.handovers')), false)),
  ('ผู้ใช้เขียน handovers / custody_history ตรงไม่ได้',
    case when to_regclass('public.handovers') is null then false
         else not has_table_privilege('authenticated', to_regclass('public.handovers'), 'insert')
          and not has_table_privilege('authenticated','public.custody_history','insert')
          and not has_table_privilege('authenticated','public.custody_history','update')
    end),
  ('guest อ่าน handovers / custody_history ไม่ได้',
    case when to_regclass('public.handovers') is null then false
         else not has_table_privilege('anon', to_regclass('public.handovers'), 'select')
          and not has_table_privilege('anon','public.custody_history','select')
    end),
  ('ลบจุดส่งมอบไม่ได้ (ปิดใช้แทน) + ตรวจความยาวชื่อ',
    not has_table_privilege('authenticated','public.handover_locations','delete')
    and exists (select 1 from pg_constraint where conname='handover_locations_name_len')),
  ('ฟังก์ชันส่งมอบครบ 4 ตัว',
    (select count(*) from pg_proc where proname in
      ('record_custody_transfer','my_handover_info','issue_handover_code','complete_handover') and prosecdef) = 4),
  ('ผู้ใช้ที่ล็อกอินเรียกได้ / guest เรียกไม่ได้',
    case when to_regprocedure('public.complete_handover(uuid,text,uuid,boolean,text,text)') is null
           or to_regprocedure('public.issue_handover_code(uuid)') is null then false
         else has_function_privilege('authenticated', to_regprocedure('public.complete_handover(uuid,text,uuid,boolean,text,text)'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.complete_handover(uuid,text,uuid,boolean,text,text)'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.issue_handover_code(uuid)'), 'execute')
    end),
  ('สุ่มรหัสด้วย CSPRNG และเก็บเป็น bcrypt',
    coalesce((select prosrc from pg_proc where proname='issue_handover_code' limit 1), '') like '%gen_random_bytes%'
    and coalesce((select prosrc from pg_proc where proname='issue_handover_code' limit 1), '') like '%gen_salt(''bf''%'),
  ('pgcrypto พร้อมใช้งาน', exists (select 1 from pg_extension where extname='pgcrypto')),
  ('แจ้งผู้ขอเมื่อของพร้อมรับ (trigger)', exists (select 1 from pg_trigger where tgname='trg_claims_handover_ready'))
) as t(check_name, ok);
