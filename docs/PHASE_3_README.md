# Phase 3 — Lost / Found Reporting

## สิ่งที่ส่งมอบ

```
supabase/
  migrations/0018_phase3_reporting.sql   (ใหม่ — ต้องรันบน Supabase)
  setup_all.sql                          (ต่อท้ายด้วย 0018 แล้ว)
  tests/supabase_stub.sql                (stub auth/storage สำหรับทดสอบบน Postgres ธรรมดา)
  tests/phase3_reporting.test.sql        (DB security tests 19 กรณี)
src/
  lib/actions/reports.ts                 (Server Actions: reportLostItemAction / reportFoundItemAction)
  lib/reports/validation.ts              (validation กลาง + ตรวจ magic bytes ของรูป)
  lib/reports/validation.test.ts         (unit tests 17 กรณี)
  lib/reports/queries.ts                 (reference data, public URL, signed URL)
  lib/reports/storage.ts / labels.ts
  components/report/form-parts.tsx       (Field, ImageInput, Public/Private section, คำเตือนรูป)
  components/report/detail-parts.tsx
  types/database.types.ts                (เพิ่ม lost_items, found_items, categories, locations, handover_locations)
app/
  report/lost/                           (/report/lost — ฟอร์มแจ้งของหาย)
  report/found/                          (/report/found — ฟอร์มแจ้งพบของ)
  dashboard/page.tsx                     (รายการที่ฉันแจ้ง)
  dashboard/lost/[id], dashboard/found/[id]  (หน้ารายละเอียดของเจ้าของรายการ รวมข้อมูลลับ)
```

## ขั้นตอนติดตั้ง

1. Supabase Dashboard → SQL Editor → รันไฟล์ `supabase/migrations/0018_phase3_reporting.sql`
   (รันซ้ำได้ ไม่เพิ่ม category ซ้ำ)
2. `npm install` (ไม่มี dependency ใหม่) แล้ว `npm run dev`
3. **ต้องทำเอง:** เพิ่ม `locations` (อาคาร/พื้นที่) และ `handover_locations` (จุดรับของกลาง) ที่สถาบันยืนยันแล้ว
   — ระบบไม่ seed ให้เพราะต้องเป็นสถานที่จริง ระหว่างนี้ฟอร์มยังใช้งานได้ (ช่องสถานที่จะเป็น "ไม่ระบุ")

## การแยกชั้นความลับ

| ข้อมูล | ของหาย | พบของ | ใครเห็น |
|---|---|---|---|
| สาธารณะ | ชื่อ, ประเภท, สี, วันที่, สถานที่, คำอธิบาย, `public_image_url` | ประเภท, ชื่อทั่วไป, สี, วันที่, บริเวณ, คำอธิบาย, `public_image_url` | ทุกคน (ผ่าน view `public_*_items` ใน Phase 4) |
| (ไม่แสดง) | ยี่ห้อ — เก็บในตาราง แต่ view สาธารณะไม่ได้เลือกคอลัมน์นี้ | | เจ้าของรายการ + staff/admin |
| ลับ | `private_ownership_details`, `private_image_url` | `secret_details`, `exact_location`, `exact_time`, `serial_number`, `custody_status`, `private_image_url` | เจ้าของรายการ + staff/admin เท่านั้น |

- รูปสาธารณะ → bucket `item-images-public`, รูปลับ → bucket `verification-private` (ดูได้ผ่าน signed URL อายุ 60 วินาที)
- **ตั้งแต่ Phase 3 คอลัมน์ `*_image_url` เก็บ "object path" ใน bucket** ไม่ใช่ URL เต็ม
  (รูปสาธารณะเปลี่ยนเป็น `found/<uuid>.jpg` ใน Phase 4 — ดู `PHASE_4_README.md`; รูปลับยังเป็น `<uid>/found/<uuid>.jpg`)
  — Phase 4 ต้องสร้าง URL ด้วย `publicImageUrl()` ใน `src/lib/reports/queries.ts`
- ชื่อไฟล์ถูกสุ่มใหม่เสมอ (ชื่อไฟล์เดิมอาจมีข้อมูลส่วนตัว)

## ป้องกัน 3 ชั้น

1. **UI** — ตรวจขนาด/ชนิดไฟล์ก่อนส่ง, คำเตือนเรื่องรูป, คำแนะนำนำส่งจุดรับของกลาง (เด่นขึ้นเมื่อเลือกประเภทมูลค่าสูง + ของยังอยู่กับผู้พบ)
2. **Server Action** — ดึงตัวตนจาก session เท่านั้น, validate ทุก field ซ้ำ, ตรวจรูปจาก magic bytes (ไม่เชื่อ MIME/นามสกุลจาก client), ตรวจ category/location ว่ายัง active, error ที่ส่งกลับเป็นข้อความกลาง ๆ ไม่ echo error จาก DB
3. **Database (0018)** — trigger บังคับ:
   - status เริ่มต้นเป็น `reported` เสมอ
   - ผู้พบเลือก custody ได้แค่ `with_finder` / `transferred_to_staff` (`in_storage`, `released_to_owner` เป็นของ staff ใน Phase 8)
   - ผู้ใช้ทั่วไปแก้ status / custody / เจ้าของรายการหลังสร้างไม่ได้
   - บัญชีที่ถูก restrict แจ้งไม่ได้
   - ห้ามวันที่ในอนาคต, จำกัดความยาวข้อความ
   - path รูปต้องเป็นไฟล์ที่ผู้ใช้อัปโหลดเองใน bucket ที่ถูกต้อง (กันการใส่ URL ภายนอก หรืออ้างไฟล์ลับของคนอื่น)
   - จำกัด 10 รายการ/ชั่วโมง/ผู้ใช้
   - เขียน `audit_logs` และ `custody_history` แรกอัตโนมัติ (client เขียนเองไม่ได้ และ metadata ไม่มีข้อมูลลับ)
   - จำกัดขนาด 5 MB และชนิดไฟล์ที่ระดับ bucket

## Categories ที่ seed

13 ประเภททั่วไป (ไม่ใช่ข้อมูลเฉพาะสถาบัน) พร้อม `is_high_value` = true สำหรับ โทรศัพท์, คอมพิวเตอร์/แท็บเล็ต,
อุปกรณ์อิเล็กทรอนิกส์อื่น ๆ, กระเป๋าสตางค์, เครื่องประดับ/นาฬิกา — admin แก้ไขได้

## ผลการตรวจคุณภาพ

- `npm test` — 17/17 ผ่าน
- `npm run typecheck` — ผ่าน
- `npm run lint` — ไม่มี warning/error
- `npm run build` — ผ่าน
- DB tests (`supabase/tests/phase3_reporting.test.sql`) บน PostgreSQL 16 — 19/19 ผ่าน

รัน DB tests เอง (ต้องใช้ Postgres ที่ทิ้งได้ ห้ามรันบน production):

```bash
createdb cdti_test
psql -d cdti_test -f supabase/tests/supabase_stub.sql
psql -d cdti_test -f supabase/setup_all.sql
psql -d cdti_test -f supabase/tests/phase3_reporting.test.sql
```

## ข้อจำกัดที่ทราบ / งานต่อ

- ถ้าบันทึกรายการไม่สำเร็จหลังอัปโหลดรูปลับแล้ว ไฟล์ลับจะค้างใน bucket (policy ให้เฉพาะ staff ลบได้ ซึ่งถูกต้องตามหลัก) — ควรมี cleanup job ฝั่ง server ใน Phase 9/10
- ยังไม่มีหน้าแก้ไข/ยกเลิกรายการ (DB รองรับให้เจ้าของแก้ field ทั่วไปแล้ว)
- ต้องทดสอบ end-to-end กับ Supabase project จริงหลังรัน migration
