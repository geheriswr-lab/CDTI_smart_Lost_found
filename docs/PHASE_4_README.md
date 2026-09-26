# Phase 4 — Public Listing + Search

## สิ่งที่ส่งมอบ

```
supabase/
  migrations/0019_phase4_public_listing.sql  (ใหม่ — ต้องรันบน Supabase)
  setup_all.sql                              (ต่อท้ายด้วย 0019 แล้ว)
  tests/phase4_public_listing.test.sql       (DB tests 8 กรณี)
src/
  lib/listing/search.ts                      (parse/sanitize search params, field whitelist, card mapper)
  lib/listing/search.test.ts                 (unit tests 9 กรณี)
  lib/listing/queries.ts                     (อ่านจาก public views เท่านั้น)
  components/listing/listing-parts.tsx       (SearchFilters, ItemCard, Pagination, EmptyState)
  components/listing/public-detail.tsx
app/
  found/page.tsx, lost/page.tsx              (รายการสาธารณะ + ค้นหา — guest เข้าได้)
  found/[id]/page.tsx, lost/[id]/page.tsx    (หน้ารายละเอียดสาธารณะ)
  page.tsx                                   (เพิ่ม "ประกาศพบของล่าสุด")
```

## ขั้นตอนติดตั้ง

Supabase → SQL Editor → วางเนื้อหา `supabase/migrations/0019_phase4_public_listing.sql` → Run (รันซ้ำได้)

## การค้นหา (เฉพาะ field สาธารณะ)

| ตัวกรอง | param | หมายเหตุ |
|---|---|---|
| คำค้น (ชื่อ/คำอธิบาย) | `q` | ตัดอักขระพิเศษทิ้ง เหลือแค่ตัวอักษร (รวมสระ/วรรณยุกต์ไทย) ตัวเลข ช่องว่าง `-` |
| ประเภท | `category` | ต้องเป็น UUID |
| สี | `color` | ค้นแบบบางส่วน |
| พื้นที่ | `location` | ต้องเป็น UUID |
| ช่วงวันที่ | `from`, `to` | ถ้ากลับด้านจะสลับให้ |
| หน้า | `page` | 12 รายการ/หน้า สูงสุดหน้า 500 |

ฟอร์มค้นหาเป็น GET ธรรมดา ใช้ได้โดยไม่ต้องมี JavaScript และ URL แชร์ต่อได้

## การป้องกันข้อมูลรั่ว

1. **DB view** (`public_found_items` / `public_lost_items`) มีเฉพาะคอลัมน์ที่อนุญาต — DB test ล็อกรายชื่อคอลัมน์ไว้ ถ้ามีใครเพิ่มคอลัมน์ test จะ fail
2. **anon ไม่มีสิทธิ์บน base table เลย** (`revoke all ... from anon`)
3. **App เลือกคอลัมน์แบบระบุชื่อ** (ไม่ใช้ `*`) และ map ผลลัพธ์ผ่าน `toPublicFoundCard` / `toPublicLostCard` ซึ่งหยิบเฉพาะ key ที่อนุญาต — ต่อให้ view ถูกแก้ผิดในอนาคต ข้อมูลเกินก็ไม่ถึงหน้าเว็บ
4. **กัน filter injection** — คำค้นถูก sanitize ก่อนประกอบเป็น PostgREST filter
5. **ปิดช่องรั่ว user id ใน URL รูป** — Phase 3 เก็บรูปสาธารณะที่ `<uid>/found/...` ทำให้ URL รูปเปิดเผย id ของผู้พบ และโยงได้ว่าคนเดียวกันแจ้งรายการไหนบ้าง
   ตั้งแต่ 0019 รูปสาธารณะใหม่เก็บที่ `found/<random>.jpg` / `lost/<random>.jpg` และตรวจความเป็นเจ้าของด้วย `storage.objects.owner_id` แทน
   (รูปลับยังใช้ `<uid>/...` เพราะไม่เคยแสดงสาธารณะ)

## ผลการตรวจคุณภาพ

- `npm test` — 26/26 ผ่าน (Phase 3: 17, Phase 4: 9)
- `npm run typecheck`, `npm run lint`, `npm run build` — ผ่าน
- DB tests บน PostgreSQL 16 — Phase 3 และ Phase 4 ผ่านทั้งหมด (0019 รันซ้ำ 2 รอบ)
- **End-to-end leak test**: รันแอปจริงกับ mock Supabase ที่จงใจส่ง `secret_details`, `serial_number`, `exact_location`,
  `finder_id`, `reporter_id`, `private_image_url` ฯลฯ กลับมาทุกแถว → ตรวจ HTML ของ `/`, `/found`, `/lost`, หน้ารายละเอียด
  และ URL ที่พยายาม inject filter — **ไม่พบข้อมูลลับในหน้าใดเลย**

## ข้อควรทราบ

- รูปที่อัปโหลดช่วง Phase 3 (path ขึ้นต้นด้วย uid) ยังแสดงได้ แต่ URL ยังมี user id อยู่ ถ้าเป็นข้อมูลทดสอบแนะนำให้ลบรายการเหล่านั้นทิ้ง
- ปุ่ม "ฉันคิดว่านี่อาจเป็นของฉัน" จะมาใน Phase 6 ตอนนี้หน้ารายละเอียดแนะนำให้แจ้งของหายไว้ก่อน
- รายการที่สถานะเป็น returned / closed / cancelled จะหายจากหน้าสาธารณะอัตโนมัติ (กรองใน view)
