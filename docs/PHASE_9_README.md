# Phase 9 — Notifications + Audit

## สิ่งที่ส่งมอบ

```
supabase/
  migrations/0024_phase9_notifications_audit.sql  (ใหม่ — ต้องรันบน Supabase)
  verify/0024_verify.sql                          (คำสั่งตรวจหลังรัน — ต้อง ✅ ทั้ง 10 แถว)
  tests/phase9_notifications_audit.test.sql       (DB tests 17 กรณี)
  setup_all.sql                                   (ต่อท้ายด้วย 0024 แล้ว)
src/lib/audit/labels.ts, audit.test.ts            (ชื่อเหตุการณ์/แจ้งเตือนภาษาไทย + test ความครบ)
app/admin/audit/page.tsx                          (หน้าดู audit log พร้อมตัวกรอง)
app/notifications/page.tsx                        (ป้ายประเภทแจ้งเตือน)
app/admin/page.tsx                                (การ์ด Audit log)
```

## ขั้นตอนติดตั้ง

1. SQL Editor → รัน `supabase/migrations/0024_phase9_notifications_audit.sql` (รันซ้ำได้)
2. SQL Editor → รัน `supabase/verify/0024_verify.sql` → ต้องได้ ✅ ทุกแถว (10 แถว)

## แจ้งเตือนครบตาม README

| README | type | ผู้รับ |
|---|---|---|
| potential match | `potential_match` | ผู้แจ้งของหาย |
| claim received | `claim_received` **(ใหม่)** · `claim_review_required` | ผู้ขอ · เจ้าหน้าที่ |
| ต้องการข้อมูลเพิ่ม | `claim_more_info` | ผู้ขอ |
| approved / rejected | `claim_approved` / `claim_rejected` | ผู้ขอ |
| handover ready / completed | `handover_ready` / `handover_completed` (+ `item_returned` ถึงผู้พบ) | ผู้ขอ / ผู้พบ |
| admin review required | `claim_review_required` · `dispute_review_required` | เจ้าหน้าที่ |

### ห้ามแจ้งเตือนเปิดเผย secret_details — บังคับที่ DB แล้ว

trigger `trg_notifications_guard` ปฏิเสธการสร้างแจ้งเตือน (fail closed) ถ้า:
- payload มี key ต้องห้าม: `secret_details`, `serial_number`, `exact_location`, `exact_time`, `private_*`, `answers`, `code`, `evidence_url`, `finder_id`, `claimant_id`
- ข้อความ/หัวข้อ/payload มี **จุดสังเกตลับ / serial (แม้พิมพ์รูปแบบต่างกัน เช่น "sn 4455 xyz") / ตำแหน่งที่พบ** ของของที่แจ้งเตือนนั้นอ้างถึง (ผ่าน `found_item_id`, `found_item_ids`, หรือ `claim_id`)
- ข้อความมี **รายละเอียดยืนยันความเป็นเจ้าของ** ของรายการของหายที่อ้างถึง

ถ้าอนาคตมีโค้ดใหม่เขียนแจ้งเตือนผิด DB จะปฏิเสธทันที ไม่ต้องพึ่งการรีวิวโค้ด

## Audit log

### ห้ามแก้ไข — ทุกคน

- ผู้ใช้/เจ้าหน้าที่/admin: ไม่มีสิทธิ์ insert/update/delete ผ่าน API
- **แม้แต่ service role หรือเจ้าของฐานข้อมูล**: UPDATE / DELETE / TRUNCATE ถูก trigger ปฏิเสธ (`AUDIT_IMMUTABLE`)

### เหตุการณ์ที่บันทึก (ครบตาม README)

| กลุ่ม | action |
|---|---|
| รายการ | `lost_item.created/edited` · `found_item.created/edited` · `match.created` |
| คำขอ | `claim.submitted` · `claim.reviewed` (approved/rejected/…) · `claim.cancelled` · `claim.disputed` |
| ความเสี่ยง | `risk.flagged` · `risk.resolved` |
| ครอบครอง/ส่งมอบ | `custody.changed` · `handover.code_issued` · `handover.code_failed` · `handover.completed` |
| admin | `account.restricted/unrestricted` · `profile.role_changed` · `profile.restriction_changed` · `profile.password_flag_changed` · `reference.created/updated/deleted` · `internal_note.created/deleted` |

- **ใหม่ใน Phase 9:** การแก้ไขรายการ, การเปลี่ยน role, การแก้ประเภท/สถานที่/จุดส่งมอบ, บันทึกภายใน (รวมการลบ)
- การแก้ไขเก็บเฉพาะ **ชื่อช่องที่เปลี่ยน** (เช่น `changed_fields: secret_details`) — **ไม่เก็บค่า**
- การเปลี่ยนสถานะอย่างเดียว (status/custody) ไม่บันทึกซ้ำเป็น `*.edited` เพราะมีเหตุการณ์เฉพาะอยู่แล้ว
- จำกัดสิทธิ์ผ่านฟังก์ชัน → บันทึก 1 ครั้ง (ไม่ซ้ำ) · แก้ตรงในตาราง → ยังถูกบันทึก
- มี unit test สแกน migration ทุกไฟล์: action / ประเภทแจ้งเตือนใหม่ที่ไม่มีชื่อภาษาไทย → test fail

### หน้า /admin/audit

กรองตามหมวด (รายการ / คำขอ / ครอบครอง-ส่งมอบ / ความเสี่ยง / admin), ช่วงวันที่, หรือ UUID ของรายการ/ผู้ใช้ ·
คลิกชื่อผู้กระทำหรือรหัสรายการเพื่อดูประวัติทั้งหมดของสิ่งนั้น · แสดงรายละเอียดเฉพาะ key ที่อนุญาต

## ผลการตรวจคุณภาพ

- `npm test` — 54/54 · typecheck / lint / build — ผ่าน
- DB tests Phase 3–9 บน PostgreSQL 16 — ผ่านทั้งหมด (0024 รันซ้ำ 2 รอบ)
- Phase 9 test เดินครบวงจร (แจ้งพบ → แจ้งหาย → ขอรับ → ตรวจ → รับของเข้า → ขอรหัส → ส่งมอบ → admin actions)
  แล้วยืนยันว่ามีครบ 16 ชนิดเหตุการณ์ ไม่มีข้อมูลลับใน audit/แจ้งเตือน และ superuser ก็แก้/ลบ/truncate ไม่ได้
- **Integration ผ่าน PostgREST จริง:** แจ้งเตือน claim_received + claim_more_info · แก้ข้อความแจ้งเตือนไม่ได้ ·
  ตัวกรองหน้า audit (หมวด / UUID / วันที่) ทำงานถูกต้อง · ผู้ใช้อ่าน audit ไม่ได้ · staff ลบไม่ได้ ·
  งานจับคู่ (Phase 5) ยังส่งแจ้งเตือนผ่าน guard ได้ปกติ
- Render test หน้า /admin/audit
- Verify SQL ทดสอบทั้งรันแล้ว (✅) / ยังไม่รัน (❌) · verify ของ 0018–0023 ยังผ่าน

## ข้อควรทราบ

- ลบผู้ใช้ที่มีประวัติใน audit log ไม่ได้ (FK จาก Phase 1) — ถ้าต้องการรองรับการขอลบข้อมูลตาม PDPA ควรออกแบบการ anonymize ใน Phase 12
- ยังไม่มีแจ้งเตือนทางอีเมล — ตอนนี้แจ้งในระบบ (ถ้าต้องการอีเมล บอกได้ จะต้องตั้งค่า SMTP ของ Supabase)
