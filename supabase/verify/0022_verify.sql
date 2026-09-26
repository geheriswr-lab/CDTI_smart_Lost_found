-- Verify migration 0022 (Phase 7 — Risk + Dispute). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน. Safe to run before 0022 (rows show ❌ instead of erroring).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('risk_events มีคอลัมน์ details และ resolution_note',
    (select count(*) from information_schema.columns
     where table_schema='public' and table_name='risk_events' and column_name in ('details','resolution_note')) = 2),
  ('DB บังคับคำเรียกที่เป็นกลาง (event_type / resolution)',
    (select count(*) from pg_constraint
     where conname in ('risk_events_event_type_check','risk_events_resolution_check')) = 2),
  ('ผู้ใช้แก้ risk_events ตรงไม่ได้ (ต้องผ่านฟังก์ชัน)',
    not has_table_privilege('authenticated','public.risk_events','update')
    and not has_table_privilege('authenticated','public.risk_events','insert')
    and not exists (select 1 from pg_policies where tablename='risk_events' and policyname='risk_events_update_staff')),
  ('guest อ่าน risk_events ไม่ได้', not has_table_privilege('anon','public.risk_events','select')),
  ('trigger ตรวจข้อพิพาท + ระงับการอนุมัติ',
    exists (select 1 from pg_trigger where tgname='trg_claims_dispute_guard')),
  ('trigger ตรวจสัญญาณความเสี่ยง',
    exists (select 1 from pg_trigger where tgname='trg_claims_after_change')),
  ('ฟังก์ชัน resolve_risk_event / set_account_restriction มีครบ',
    (select count(*) from pg_proc where proname in ('resolve_risk_event','set_account_restriction','raise_risk_event') and prosecdef) = 3),
  ('ผู้ใช้เรียก raise_risk_event เองไม่ได้ (สร้างสัญญาณปลอมไม่ได้)',
    case when to_regprocedure('public.raise_risk_event(text,public.risk_level_enum,uuid,uuid,uuid,jsonb)') is null then false
         else not has_function_privilege('authenticated', to_regprocedure('public.raise_risk_event(text,public.risk_level_enum,uuid,uuid,uuid,jsonb)'), 'execute')
    end),
  ('guest เรียกฟังก์ชันจัดการความเสี่ยงไม่ได้',
    case when to_regprocedure('public.set_account_restriction(uuid,boolean,text)') is null then false
         else not has_function_privilege('anon', to_regprocedure('public.set_account_restriction(uuid,boolean,text)'), 'execute')
          and not has_function_privilege('anon', to_regprocedure('public.resolve_risk_event(uuid,text,text)'), 'execute')
    end),
  ('ผู้ขอถอนตัวจากข้อพิพาทได้ (cancel_claim รองรับ disputed)',
    coalesce((select prosrc from pg_proc where proname='cancel_claim' limit 1), '') like '%disputed%')
) as t(check_name, ok);
