-- Verify migration 0024 (Phase 9 — Notifications + Audit). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน. Safe to run before 0024 (rows show ❌ instead of erroring).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('audit_logs แก้/ลบ/truncate ไม่ได้ แม้แต่ admin/service role',
    (select count(*) from pg_trigger where tgname in ('trg_audit_logs_no_update','trg_audit_logs_no_truncate')) = 2),
  ('ผู้ใช้เขียน audit_logs ผ่าน API ไม่ได้',
    not has_table_privilege('authenticated','public.audit_logs','insert')
    and not has_table_privilege('authenticated','public.audit_logs','update')
    and not has_table_privilege('authenticated','public.audit_logs','delete')),
  ('guest อ่าน audit_logs ไม่ได้', not has_table_privilege('anon','public.audit_logs','select')),
  ('DB กันแจ้งเตือนที่มีข้อมูลลับ (trigger)', exists (select 1 from pg_trigger where tgname='trg_notifications_guard')),
  ('แจ้งผู้ขอเมื่อได้รับคำขอ (claim_received)', exists (select 1 from pg_trigger where tgname='trg_claims_notify_received')),
  ('log การแก้ไขรายการของหาย/พบของ',
    (select count(*) from pg_trigger where tgname in ('trg_lost_items_audit_edit','trg_found_items_audit_edit')) = 2),
  ('log การเปลี่ยน role / จำกัดสิทธิ์ของผู้ใช้', exists (select 1 from pg_trigger where tgname='trg_profiles_audit')),
  ('log การแก้ข้อมูลอ้างอิง (ประเภท / สถานที่ / จุดส่งมอบ)',
    (select count(*) from pg_trigger where tgname in ('trg_categories_audit','trg_locations_audit','trg_handover_locations_audit')) = 3),
  ('log การเพิ่ม/ลบบันทึกภายใน', exists (select 1 from pg_trigger where tgname='trg_internal_notes_audit')),
  ('index สำหรับหน้า audit log',
    (select count(*) from pg_indexes where indexname in
      ('idx_audit_logs_created','idx_audit_logs_entity','idx_audit_logs_actor','idx_audit_logs_action')) = 4)
) as t(check_name, ok);
