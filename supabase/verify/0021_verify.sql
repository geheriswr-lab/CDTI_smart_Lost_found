-- Verify migration 0021 (Phase 6 — Claims). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน. Safe to run even before 0021 (rows show ❌ instead of erroring).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('categories มีคอลัมน์ claim_form',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='categories' and column_name='claim_form')),
  ('ตั้งแบบฟอร์ม wallet/key/electronics ให้หมวดที่ seed แล้ว',
    (select count(*) from public.categories c
     where to_jsonb(c) ? 'claim_form' and to_jsonb(c)->>'claim_form' <> 'general') >= 5),
  ('ผู้ใช้ INSERT/UPDATE claims ตรงไม่ได้ (ปิดช่องตั้ง approved เอง)',
    not has_table_privilege('authenticated','public.claims','insert')
    and not has_table_privilege('authenticated','public.claims','update')),
  ('ลบ policy insert/update เดิมของ claims แล้ว',
    not exists (select 1 from pg_policies where tablename='claims'
                and policyname in ('claims_insert_claimant','claims_update_claimant','claims_update_staff'))),
  ('guest เข้า claims / claim_evidence ไม่ได้',
    not has_table_privilege('anon','public.claims','select')
    and not has_table_privilege('anon','public.claim_evidence','select')),
  ('ตาราง claim_reviews มี เปิด RLS และ guest/ผู้ใช้เขียนไม่ได้',
    case when to_regclass('public.claim_reviews') is null then false
         else (select relrowsecurity from pg_class where oid = to_regclass('public.claim_reviews'))
              and not has_table_privilege('anon', to_regclass('public.claim_reviews'), 'select')
              and not has_table_privilege('authenticated', to_regclass('public.claim_reviews'), 'insert')
    end),
  ('ฟังก์ชัน submit_claim / cancel_claim / review_claim มีครบ',
    (select count(*) from pg_proc where proname in ('submit_claim','cancel_claim','review_claim') and prosecdef) = 3),
  ('ผู้ใช้ที่ล็อกอินเรียกฟังก์ชัน claim ได้ / guest เรียกไม่ได้',
    case when to_regprocedure('public.submit_claim(uuid,jsonb,uuid)') is null
           or to_regprocedure('public.review_claim(uuid,public.claim_status_enum,jsonb,text)') is null then false
         else has_function_privilege('authenticated', to_regprocedure('public.submit_claim(uuid,jsonb,uuid)'), 'execute')
          and has_function_privilege('authenticated', to_regprocedure('public.review_claim(uuid,public.claim_status_enum,jsonb,text)'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.submit_claim(uuid,jsonb,uuid)'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.review_claim(uuid,public.claim_status_enum,jsonb,text)'), 'execute')
    end),
  ('trigger ตรวจไฟล์หลักฐาน', exists (select 1 from pg_trigger where tgname='trg_claim_evidence_guard')),
  ('1 คน ขอรับของ 1 ชิ้นได้แค่ 1 คำขอ (unique index)',
    exists (select 1 from pg_indexes where indexname='uq_claims_claimant_item'))
) as t(check_name, ok);
