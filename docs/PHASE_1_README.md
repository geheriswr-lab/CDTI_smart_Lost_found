# Phase 1 — Architecture + Database + RLS

## สิ่งที่ส่งมอบ

```
supabase/
  migrations/
    0001_enums.sql
    0002_profiles.sql              (+ helper functions is_admin(), is_staff_or_admin())
    0003_reference_tables.sql      (categories, locations, handover_locations)
    0004_lost_items.sql
    0005_found_items.sql
    0006_matches.sql
    0007_claims.sql
    0008_claim_evidence.sql
    0009_notifications.sql
    0010_risk_events.sql
    0011_audit_logs.sql            (append-only, no UPDATE/DELETE policy for anyone)
    0012_custody_history.sql
    0013_internal_notes.sql
    0014_handover_codes.sql
    0015_public_views.sql          (public_lost_items, public_found_items)
    0016_storage_buckets.sql       (item-images-public, verification-private)
  setup_all.sql                    (all of the above concatenated, in order)
docs/
  ER_DIAGRAM.md                    (Mermaid erDiagram + information-asymmetry notes)
  PHASE_1_README.md                (this file)
```

## วิธีรัน

**ตัวเลือกที่ง่ายที่สุด — Supabase SQL Editor**
1. เปิด Supabase Dashboard ของโปรเจกต์ → SQL Editor
2. วางเนื้อหาไฟล์ `supabase/setup_all.sql` ทั้งหมด → Run

**ตัวเลือกที่แนะนำสำหรับทีม — Supabase CLI**
```bash
supabase init                      # ครั้งแรกเท่านั้น
supabase link --project-ref <your-project-ref>
# คัดลอกไฟล์ใน supabase/migrations/ ไปไว้ใน supabase/migrations/ ของโปรเจกต์ที่ init ไว้
supabase db push
```

## หลักการที่ implement ไว้

- **Default deny**: ทุกตาราง `enable row level security` และไม่มี policy ครอบคลุมทุกกรณี —
  action ที่ไม่มี policy จะถูกปฏิเสธเสมอ
- **Role มาจาก DB เท่านั้น**: `is_admin()` / `is_staff_or_admin()` เป็น `SECURITY DEFINER`
  function อ่านจาก `profiles.role` เท่านั้น ไม่เช็ค email ใด ๆ
- **กัน self role escalation**: trigger `prevent_self_role_escalation()` บล็อกไม่ให้
  user แก้ `role` ของตัวเองแม้จะแก้ profile ตัวเองได้
- **Information asymmetry**: `found_items` (มี `secret_details`, `serial_number`,
  `exact_location`, `exact_time`) ไม่มี SELECT policy ให้ claimant เลย — เห็นได้แค่ผ่าน
  `public_found_items` view (public columns เท่านั้น) เท่านั้น
- **แยก public/private ตั้งแต่ระดับ DB**: `public_lost_items` / `public_found_items`
  เป็น view ที่ระบุ column แบบ whitelist ชัดเจน ไม่ใช่ SELECT * แล้วกรองที่ backend
- **Audit log แก้ไม่ได้**: `audit_logs` ไม่มี UPDATE/DELETE policy เลย แม้แต่ admin
- **Storage แยก bucket**: `item-images-public` (public=true) กับ `verification-private`
  (public=false) พร้อม policy จำกัดการเขียนเฉพาะ folder ของตัวเอง (`<uid>/...`)
- **matches / notifications / risk_events / audit_logs / custody_history /
  handover_codes**: ไม่มี INSERT policy ให้ authenticated/anon เลย — เขียนได้เฉพาะจาก
  service role key (backend/edge function) เท่านั้น ป้องกัน client ปลอมข้อมูลระบบ

## สิ่งที่ยังไม่รวมใน Phase 1 (ตั้งใจ)

- ไม่มี UI ใด ๆ (ตาม Deliverable ของ Phase 1)
- ไม่มี Admin account จริง / `must_change_password` flow (อยู่ใน Phase 2)
- ไม่มี matching-score logic, claim questionnaire logic, handover code generation
  logic เหล่านี้เป็น business logic ฝั่ง backend/edge function ที่จะ implement ใน
  Phase 5–8 โดยใช้ schema ชุดนี้เป็นฐาน

## ข้อควรตรวจสอบก่อนไป Phase ถัดไป (ตาม README หลักการควบคุมคุณภาพ)

- [ ] รัน `setup_all.sql` บน Supabase project ทดสอบ (fresh project) แล้วไม่มี error
- [ ] เช็คใน Dashboard → Authentication → Policies ว่าทุกตารางมี RLS เปิดจริง
- [ ] ทดสอบ query ด้วย anon key: SELECT บน `lost_items`/`found_items` โดยตรงต้องถูกปฏิเสธ
      แต่ SELECT บน `public_lost_items`/`public_found_items` ต้องสำเร็จและไม่มี private columns
- [ ] ทดสอบ insert แถวใน `auth.users` (สมัครสมาชิกใหม่) แล้วต้องมี `profiles` row ถูกสร้างอัตโนมัติ
