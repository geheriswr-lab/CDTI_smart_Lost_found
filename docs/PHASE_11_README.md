# Phase 11 — Security Testing

เป้าหมาย: ยืนยันว่าระบบปลอดภัยจริงทุกจุด — ทดสอบทุกกรณีใน README และตรวจ Authentication, Authorization, RLS, Storage, Input/File Validation, Rate Limiting, Service Role Key

## สิ่งที่ต้องทำใน Supabase

1. รัน `supabase/migrations/0026_phase11_security_hardening.sql` ใน SQL Editor
2. รัน `supabase/verify/0026_verify.sql` → ต้องได้ ✅ ผ่าน ครบ 15 แถว
3. รัน `supabase/verify/security_selftest.sql` → ต้องได้ ✅ ผ่าน ครบ 22 แถว
   (self-test สร้างผู้ใช้/ของ/คำขอชั่วคราว ทดลองโจมตีทุกกรณี แล้ว **rollback ทั้งหมด** — ไม่ทิ้งข้อมูลไว้)

## ช่องโหว่ที่พบและแก้ใน Phase 11 (0026)

| # | ปัญหา | ผลกระทบ | การแก้ |
|---|---|---|---|
| 1 | บังคับเปลี่ยนรหัสผ่านทำแค่ใน middleware ของ Next.js | admin เริ่มต้น (`admin12345`) ยิง API ตรงได้สิทธิ์ admin เต็มทันที และผู้ใช้ PATCH `must_change_password=false` เองได้โดยไม่เปลี่ยนรหัส | `is_admin()` / `is_staff_or_admin()` / `current_user_role()` คืนค่าไม่มีสิทธิ์ขณะยังไม่เปลี่ยนรหัสหรือถูกจำกัดสิทธิ์; ปลดธงได้เฉพาะเมื่อ hash รหัสใน `auth.users` เปลี่ยนจริง (ตาราง `password_change_markers`) |
| 2 | `scripts/create-admin.ts` และการตั้ง role ใน SQL Editor ล้มเหลว ("Only admins can change role") | ตั้ง admin คนแรกไม่ได้ | trigger role/flag ยกเว้น context ฝั่ง server (service role / SQL editor ที่ไม่มี JWT user) |
| 3 | ผู้พบแก้ `secret_details` / serial / ตำแหน่งละเอียด / รูปลับ / ประเภท หลังมีคนขอรับแล้วได้ | สมรู้ร่วมคิด: คัดลอกคำตอบผู้ขอมาเป็น "จุดสังเกต" หรือทำให้เจ้าของจริงตอบไม่ตรง | ล็อกฟิลด์ยืนยันตัวตนสำหรับผู้ที่ไม่ใช่เจ้าหน้าที่ เมื่อมีคำขออย่างน้อย 1 รายการ |
| 4 | ผู้ใช้แก้ `email` / `user_type` ในโปรไฟล์ตัวเองได้ | เจ้าหน้าที่เห็นข้อมูลปลอมตอนพิจารณาคำขอ | เปลี่ยนได้เฉพาะ admin; จำกัดความยาวชื่อ/เบอร์ |
| 5 | สิทธิ์ตั้งต้นของ Supabase กว้างเกิน | anon SELECT `profiles`, anon เรียก `assert_max_len` / `is_own_storage_object` / `current_user_role` ได้, anon/authenticated มี TRUNCATE ทุกตาราง, ผู้ใช้ INSERT/DELETE `matches`, `notifications` ได้ในระดับ privilege (RLS กันอยู่แต่ไม่ควรมี) | revoke ทั้งหมด; anon เรียกได้เฉพาะ `is_admin` / `is_staff_or_admin` (ใช้ใน RLS); ฟังก์ชันภายในผู้ใช้เรียกไม่ได้ |
| 6 | ไม่มี security headers | clickjacking, MIME sniffing, cache หน้า private | `next.config.mjs`: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP, `Cache-Control: private, no-store`, ปิด `X-Powered-By` |
| 7 | กฎ route ใน middleware ใช้ prefix หลวม (`/login-x`, `/authx`, `/found/x/claim` นับเป็น public) | guest เข้าหน้า claim แล้วเด้งแบบไม่มี `next` / เสี่ยงเมื่อเพิ่ม route ใหม่ | แยกกฎไป `src/lib/auth/routes.ts` (exact match + segment boundary) พร้อม unit test; guard ฝั่ง server ใช้กฎเดียวกับ DB |

(ช่องโหว่ที่พบและแก้ใน Phase ก่อนหน้า: path รูปมี user id (0019), แก้ข้อความแจ้งเตือนได้ (0020), ผู้ขออนุมัติตัวเองได้ (0021), open redirect ตอน login, staff อ่าน hash รหัสส่งมอบได้ (0023), audit log แก้ได้ (0024), staff ลบบันทึกของคนอื่นได้ (0025))

## ผลทดสอบ (test matrix)

| กรณีใน README | ทดสอบที่ | ผล |
|---|---|---|
| User A อ่าน secret ของ User B ไม่ได้ | phase11 T1, self-test 1–2 | ✅ |
| Claimant อ่าน secret_detail ไม่ได้ | phase11 T4a, self-test 7 | ✅ |
| Public อ่าน evidence ไม่ได้ (ตาราง + ไฟล์ใน storage) | phase11 T4b–c, self-test 21 | ✅ |
| User แก้ item คนอื่นไม่ได้ | phase11 T2, self-test 3 | ✅ |
| User เข้า Admin ไม่ได้ / เปลี่ยน role ไม่ได้ | phase11 T3, T11, T12, self-test 4–5, 19–20, routes.test.ts | ✅ |
| Rejected claimant ไม่ได้ hint | phase11 T8, self-test 14 | ✅ |
| Duplicate claim ติด rate limit | phase11 T6, self-test 8–9 | ✅ |
| Multiple claim → dispute | phase11 T7, self-test 11–12 | ✅ |
| Handover code ใช้ซ้ำไม่ได้ | phase11 T9, self-test 13, 15 | ✅ |
| Audit log ครบ (และแก้/ลบไม่ได้, ไม่มีค่าลับ) | phase11 T10, self-test 17–18 | ✅ |
| Returned item claim ใหม่ไม่ได้ | phase11 T9, self-test 16 | ✅ |

### ด้านที่ตรวจ

- **Authentication** — Supabase Auth; ทุกหน้าที่ต้อง login เรียก `requireProfile()` ฝั่ง server; บังคับเปลี่ยนรหัสผ่านทั้งใน middleware และในฐานข้อมูล (0026); redirect หลัง login ผ่าน `isSafeRedirect` (กัน open redirect)
- **Authorization** — role มาจาก `profiles.role` เท่านั้น; ทุก action สำคัญเป็น SECURITY DEFINER RPC ที่ตรวจสิทธิ์ภายใน; ผู้ใช้เขียนตาราง claims/claim_reviews/risk_events/audit_logs/handovers/custody_history/matches ตรงไม่ได้
- **RLS** — เปิดทุกตาราง (ทดสอบแบบ static ใน S1); ฟังก์ชัน SECURITY DEFINER ทุกตัวกำหนด `search_path`
- **Storage** — bucket รูป public ใช้ path สุ่มไม่มี user id; หลักฐาน/รูปลับอยู่ bucket private แยกโฟลเดอร์ตาม uid, อ่านได้เฉพาะเจ้าของ/เจ้าหน้าที่; guest list ไฟล์ private ไม่ได้
- **Input/File validation** — ตรวจความยาวใน trigger, ตรวจชนิดไฟล์จาก magic bytes (ไม่เชื่อ MIME จาก browser), จำกัด 5 MB ทั้งฝั่งแอปและ bucket, path รูปต้องเป็นไฟล์ที่ผู้ใช้อัปโหลดเอง
- **Rate limiting** — แจ้งของ 10 ครั้ง/ชม., คำขอใหม่ 3/24 ชม., active 5, ลองซ้ำ 3 ครั้ง + cooldown, รหัสส่งมอบผิด 5 ครั้งล็อก, ออกรหัสได้ 5 ครั้ง
- **Service Role Key** — ใช้เฉพาะ `src/lib/supabase/admin.ts` (มี `import "server-only"` → build ล้มถ้า client import); `npm run security:bundle` สแกน `.next/static` หาค่า key, JWT ที่ role = service_role, ชื่อตัวแปร/ฟังก์ชันฝั่ง server และชื่อคอลัมน์ลับ

## วิธีรันทดสอบเอง

```bash
npm test                 # unit tests (60) รวม routes.test.ts
npm run build && npm run security:bundle
```

ฐานข้อมูล (Postgres ทดสอบ ไม่ใช่ production) — ดูหัวไฟล์ `supabase/tests/phase11_security.test.sql`
(จำลองสิทธิ์ตั้งต้นแบบ Supabase ก่อนรัน `setup_all.sql` เพื่อให้เห็นสิ่งที่ API เปิดจริง)

## ความเสี่ยงที่เหลือ / ต้องตั้งค่าใน Supabase Dashboard (ทำใน Phase 12)

- เปลี่ยนรหัส `admin12345` ทันทีหลังรัน create-admin (ตอนนี้ DB บังคับแล้ว แต่ควรตั้ง `INITIAL_ADMIN_PASSWORD` ให้แข็งตั้งแต่แรก)
- Authentication → เปิด email confirmation, ตั้ง minimum password length ≥ 8, เปิด leaked password protection, ตรวจ rate limit ของ Auth
- เปิด MFA สำหรับบัญชี admin/staff
- Storage: ยังไม่มีโควตาจำนวนไฟล์ต่อผู้ใช้ใน bucket (มีแค่ขนาดไฟล์) — ไฟล์ที่อัปโหลดแต่ไม่ได้ใช้ควรมีงานล้างเป็นระยะ
- CSP ยังใช้ `'unsafe-inline'` สำหรับ script (ข้อจำกัด Next 14) — อัปเกรดเป็น nonce ได้ภายหลัง
- ผู้ขอรับเห็นสถานะภายในของคำขอ (`needs_review`, `likely_owner`) ผ่าน API ตรง — ไม่เปิดเผยความลับ แต่แอปแสดงเป็นข้อความกลางอยู่แล้ว
- ฟังก์ชันใหม่ในอนาคตต้อง `revoke ... from public, anon` เสมอ — ชุดทดสอบ S1 และ `0026_verify.sql` จะฟ้องถ้าลืม
