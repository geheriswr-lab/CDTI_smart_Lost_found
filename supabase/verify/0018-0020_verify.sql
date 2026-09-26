-- Verify migrations 0018–0020 (Phase 3–5). Read-only. Paste into Supabase SQL Editor → Run.
-- Every row should say ✅ ผ่าน.
select phase, check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('0018', 'categories มีคอลัมน์ is_high_value',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='categories' and column_name='is_high_value')),
  ('0018', 'seed categories ครบ (>= 13)', (select count(*) from public.categories) >= 13),
  ('0018', 'trigger ป้องกัน lost_items', exists (select 1 from pg_trigger where tgname='trg_lost_items_guard')),
  ('0018', 'trigger ป้องกัน found_items', exists (select 1 from pg_trigger where tgname='trg_found_items_guard')),
  ('0018', 'trigger audit/custody ตอนสร้างรายการ',
    (select count(*) from pg_trigger where tgname in ('trg_lost_items_created_log','trg_found_items_created_log')) = 2),
  ('0018', 'bucket จำกัดขนาด 5 MB',
    (select count(*) from storage.buckets where id in ('item-images-public','verification-private') and file_size_limit = 5242880) = 2),
  ('0019', 'policy อัปโหลดรูปแบบไม่มี user id',
    exists (select 1 from pg_policies where schemaname='storage' and policyname='storage_public_images_insert_anonymous_path')),
  ('0019', 'ลบ policy อัปโหลดแบบเก่าแล้ว',
    not exists (select 1 from pg_policies where schemaname='storage' and policyname='storage_public_images_insert_own_folder')),
  ('0019', 'ตรวจเจ้าของรูปด้วย owner_id', (select prosrc from pg_proc where proname='is_own_storage_object') like '%owner_id%'),
  ('0019', 'guest อ่าน lost_items/found_items ตรงไม่ได้',
    not has_table_privilege('anon','public.lost_items','select') and not has_table_privilege('anon','public.found_items','select')),
  ('0019', 'guest อ่าน public views ได้',
    has_table_privilege('anon','public.public_lost_items','select') and has_table_privilege('anon','public.public_found_items','select')),
  ('0020', 'guest เข้า matches/notifications ไม่ได้',
    not has_table_privilege('anon','public.matches','select') and not has_table_privilege('anon','public.notifications','select')),
  ('0020', 'ผู้ใช้แก้ notification ได้แค่ is_read',
    has_column_privilege('authenticated','public.notifications','is_read','update')
    and not has_column_privilege('authenticated','public.notifications','message','update')
    and not has_column_privilege('authenticated','public.notifications','user_id','update')),
  ('0020', 'index ของ matches/notifications',
    (select count(*) from pg_indexes where indexname in ('idx_matches_lost_score','idx_matches_found','idx_notifications_user_unread')) = 3),
  ('0020', 'RLS เปิดอยู่บน matches/notifications',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.matches'::regclass, 'public.notifications'::regclass)))
) as t(phase, check_name, ok)
order by phase, check_name;
