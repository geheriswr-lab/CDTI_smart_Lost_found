# CDTI Smart Lost & Found — Development Roadmap

> ระบบบริหารจัดการทรัพย์สินสูญหายและทรัพย์สินที่มีผู้เก็บได้
> สถาบันเทคโนโลยีจิตรลดา
> Tech Stack: Next.js + TypeScript + Tailwind CSS + Supabase (PostgreSQL / Auth / Storage) + Vercel

---

## หลักการควบคุมคุณภาพ (ใช้ทุก Phase)

หลังจบแต่ละ Phase ต้อง:
- [ ] Run automated tests
- [ ] Run TypeScript check
- [ ] Run lint
- [ ] Run build ที่เกี่ยวข้อง
- [ ] แก้ Error ทั้งหมดก่อนเริ่ม Phase ถัดไป

---

## Phase 1 — Architecture + Database + RLS

**เป้าหมาย:** วางรากฐานระบบทั้งหมดให้ปลอดภัยตั้งแต่ระดับ Database

- [ ] ออกแบบ ER Diagram ของทุกตารางหลัก:
  `profiles`, `categories`, `locations`, `handover_locations`, `lost_items`, `found_items`,
  `matches`, `claims`, `claim_evidence`, `notifications`, `risk_events`, `audit_logs`,
  `custody_history`, `internal_notes`, `handover_codes`
- [ ] สร้าง Enums: item status, claim status, risk level, custody status ฯลฯ
- [ ] เขียน Supabase Migrations แยกตามตาราง
- [ ] เขียน `supabase/setup_all.sql` สำหรับ setup ใหม่ทั้งระบบ (idempotent เท่าที่เหมาะสม)
- [ ] เปิดใช้ RLS ทุกตารางตั้งแต่ต้น (default deny)
- [ ] ออกแบบ Public Database View (`public_lost_items`, `public_found_items`) ที่ไม่มี private columns ตั้งแต่ระดับ DB
- [ ] แยก Storage Bucket: public item images / private verification evidence

**Deliverable:** Database พร้อม RLS ใช้งานได้ ยังไม่มี UI

---

## Phase 2 — Authentication + Roles

**เป้าหมาย:** ระบบล็อกอินและสิทธิ์การเข้าถึงที่ปลอดภัย

- [ ] ตั้งค่า Supabase Auth (email/password)
- [ ] ตาราง `profiles`: user_type (vocational_student, university_student, teacher_staff, royal_household_staff, external_visitor) + system role (user, staff, admin)
- [ ] Session management + protected routes
- [ ] Server-side authorization (ไม่เชื่อ permission จาก client)
- [ ] Email verification (ถ้าเหมาะสม)
- [ ] สร้าง Initial Admin Account ผ่าน Supabase Auth (`admin@cdti.ac.th`)
  - [ ] `must_change_password = true` สำหรับบัญชีเริ่มต้น
  - [ ] บังคับเปลี่ยนรหัสผ่านหลัง login ครั้งแรก
  - [ ] ตรวจสิทธิ์ admin จาก `role` ใน DB เท่านั้น (ห้ามเช็ค email)
- [ ] Guest browsing (ไม่ login) เข้าดู Public Listing ได้

**Deliverable:** Login / Signup / Role-based routing ใช้งานได้จริง

---

## Phase 3 — Lost / Found Reporting

**เป้าหมาย:** ฟอร์มแจ้งของหาย/พบของ พร้อมแยก public/private field

- [ ] Report Lost Form (item name, category, brand, color, date, location, description, image, **private ownership details**)
- [ ] Report Found Form (category, general name, color, date, general location, description, public image)
  - [ ] เพิ่ม field private: exact location, exact time, serial number, secret_details, custody_status
- [ ] ถามสถานะ custody ทันทีตอน report found
- [ ] คำแนะนำ UI: ของมูลค่าสูงควรนำส่งจุดรับของกลาง
- [ ] คำเตือนเรื่องภาพ: หลีกเลี่ยงถ่ายข้อมูลส่วนบุคคลให้เห็นชัด
- [ ] แยก `public_image_url` / `private_image_url`

**Deliverable:** ผู้ใช้ report ของหาย/พบได้ ข้อมูลถูกแยกชั้นความลับถูกต้อง

---

## Phase 4 — Public Listing + Search

**เป้าหมาย:** หน้าค้นหา/ประกาศสาธารณะที่ไม่รั่วข้อมูล verification

- [ ] หน้า Public Found Listing (ประเภท, สีคร่าว ๆ, วันที่, พื้นที่คร่าว ๆ)
- [ ] Search ด้วย field สาธารณะเท่านั้น (item type, category, general color, general location, date range)
- [ ] ทดสอบว่า secret_details / serial / finder identity ไม่ปรากฏใน response ใด ๆ

**Deliverable:** Public สามารถ browse/search ได้โดยไม่เห็นข้อมูล verification

---

## Phase 5 — Smart Matching

**เป้าหมาย:** ระบบแนะนำรายการที่อาจตรงกันระหว่าง Lost/Found

- [ ] คำนวณ Match Score (เต็ม 100):
  Category 30 / Color 15 / Brand 15 / Location 20 / Date 10 / Description Keyword 10
- [ ] แสดงผลเป็น "ความเป็นไปได้ที่รายการตรงกัน" เท่านั้น (ห้ามสื่อว่าเป็นเจ้าของ)
- [ ] ตาราง `matches` เก็บผลการจับคู่
- [ ] Notification เมื่อพบ Potential Match

**Deliverable:** ระบบแนะนำ Potential Match อัตโนมัติ

---

## Phase 6 — Claim + Ownership Verification

**เป้าหมาย:** กระบวนการยืนยันความเป็นเจ้าของอย่างปลอดภัย

- [ ] ปุ่ม "ฉันคิดว่านี่อาจเป็นของฉัน" → สร้าง Claim
- [ ] Claim Questionnaire ปรับตาม category (general / wallet / key / electronics)
  - [ ] ห้ามถาม password, PIN, credential
- [ ] Claim Evidence upload (private, ห้าม public เห็น)
- [ ] Verification Checklist → ผลลัพธ์: insufficient / needs_review / likely_owner / verified
- [ ] Anti-guessing: reject message เป็นข้อความกลาง ๆ ไม่บอกว่าตอบข้อไหนผิด
- [ ] Claim rate limit + cooldown (`claim_attempt_count`)
- [ ] Verification Level: standard / enhanced (สำหรับของมูลค่าสูง)

**Deliverable:** Flow Claim → Verification ทำงานครบ ปลอดภัยจากการเดา

---

## Phase 7 — Risk Detection + Dispute

**เป้าหมาย:** ตรวจจับพฤติกรรมเสี่ยงและจัดการข้อพิพาท

- [ ] ตาราง `risk_events` (event_type, risk_level, related_item/claim, resolution)
- [ ] Risk signals: claim ถี่, reject บ่อย, claim ซ้ำ item เดิม, เปลี่ยนคำตอบหลายครั้ง, account ใหม่ claim ของมูลค่าสูง
- [ ] ใช้สถานะกลาง (Needs Review, Suspicious Activity) ห้ามระบุว่าเป็น "โจร"
- [ ] Dispute handling: มากกว่า 1 claim ต่อ item → สถานะ `disputed` → ระงับ handover → ส่ง Staff/Admin review

**Deliverable:** ระบบ flag ความเสี่ยงและ dispute ให้ Admin ตรวจสอบได้

---

## Phase 8 — Custody + Secure Handover

**เป้าหมาย:** ควบคุมกระบวนการส่งมอบของคืนอย่างปลอดภัย

- [ ] ตาราง `custody_history` (from_status → to_status, handled_by, location, timestamp)
- [ ] แยกบทบาทชัดเจน: ผู้แจ้งพบของ / ผู้ครอบครองปัจจุบัน / เจ้าหน้าที่ / ผู้ claim / ผู้ verify / ผู้รับของจริง
- [ ] One-Time Handover Code (6 หลัก, มี expiration, hash เก็บ, ใช้ได้ครั้งเดียว)
- [ ] Handover Confirmation: บันทึก claim, item, handed_over_by, received_by, location, timestamp
- [ ] Enhanced Verification item ต้องมี Staff/Admin ยืนยันก่อน handover
- [ ] จัดการ `handover_locations` (Admin เพิ่ม/แก้ได้ ไม่ hardcode)

**Deliverable:** กระบวนการส่งมอบของคืนที่ตรวจสอบย้อนหลังได้ ป้องกันการแอบอ้าง

---

## Phase 9 — Notifications + Audit

**เป้าหมาย:** แจ้งเตือนผู้ใช้และเก็บประวัติการดำเนินการ

- [ ] Notifications: potential match, claim received, ต้องการข้อมูลเพิ่ม, approved/rejected, handover ready/completed, admin review required
  - [ ] ห้าม notification เปิดเผย secret_details
- [ ] ตาราง `audit_logs` (actor, action, entity_type, entity_id, metadata, created_at)
  - [ ] เก็บทุก event สำคัญ: item created/edited, claim submitted/reviewed/approved/rejected, risk flag, custody changed, handover initiated/completed, admin action
  - [ ] User ปกติแก้ audit log ไม่ได้

**Deliverable:** ระบบแจ้งเตือนครบ + audit trail ตรวจสอบย้อนหลังได้

---

## Phase 10 — Admin Dashboard

**เป้าหมาย:** เครื่องมือให้ Admin ควบคุมและตรวจสอบระบบทั้งหมด

- [ ] Dashboard "รายการต้องตรวจสอบ": high-risk claims, repeated rejections, high-value items, disputes, suspicious activity, custody anomalies
- [ ] จัดการ Categories / Locations / Handover Locations
- [ ] ตรวจสอบ Claims, Disputes, Risk Events, Custody History, Audit Logs
- [ ] Internal Notes (staff/admin only)
- [ ] Approve / Reject Claim, Restrict Account, Escalate Case
- [ ] Statistics: lost/found reports, matches, claims, successful returns, rejected claims, avg return time, return success rate (ไม่เปิด risk statistics รายบุคคลต่อ public)
- [ ] Route `/admin` ป้องกันด้วย role check ทั้ง server-side และ RLS (ไม่ใช่แค่ซ่อนเมนู)

**Deliverable:** Admin ควบคุมและตรวจสอบระบบได้ครบวงจร

---

## Phase 11 — Security Testing

**เป้าหมาย:** ยืนยันว่าระบบปลอดภัยจริงในทุกจุด

Test cases ขั้นต่ำ:
- [ ] User A อ่าน secret ของ User B ไม่ได้
- [ ] Claimant อ่าน secret_detail ไม่ได้
- [ ] Public อ่าน evidence ไม่ได้
- [ ] User แก้ item คนอื่นไม่ได้
- [ ] User เข้า Admin ไม่ได้ / เปลี่ยน role ไม่ได้
- [ ] Rejected claimant ไม่ได้รับ hint คำตอบ
- [ ] Duplicate claim ถูกควบคุมด้วย rate limit
- [ ] Multiple claim เกิด dispute ถูกต้อง
- [ ] Handover code ใช้ซ้ำไม่ได้
- [ ] Audit log ถูกสร้างครบ
- [ ] Returned item claim ใหม่ไม่ได้
- [ ] ตรวจ: Authentication, Authorization, RLS, Storage Policies, Input/File Validation, Rate Limiting, Service Role Key ไม่หลุดไป Browser

**Deliverable:** ผ่านการทดสอบความปลอดภัยทุกกรณี

---

## Phase 12 — Production Deployment

**เป้าหมาย:** เตรียมระบบให้พร้อมใช้งานจริง

- [ ] Deploy บน Vercel
- [ ] ตรวจ Core Flow ครบวงจรอีกครั้ง:
  - Lost → Match → Claim → Verification → Review → Secure Handover → Returned
  - Found → Custody → Match → Claim → Verification → Handover → Returned
- [ ] เปลี่ยนรหัสผ่าน Admin เริ่มต้น (`admin12345`) เป็นรหัสที่รัดกุม
- [ ] เปิด Email Verification ตามความเหมาะสม
- [ ] ตรวจสอบ RLS ครั้งสุดท้ายทุกตาราง
- [ ] ตรวจว่าไม่มี password/secret หลุดใน Git repository
- [ ] ห้ามมี Demo Account / Fake Seed Data / Fake Claims ใน Production DB
  - Seed ได้เฉพาะ: categories, system configuration, location ที่ยืนยันแล้ว
- [ ] เอกสารส่งมอบระบบ + คู่มือ Admin

**Deliverable:** ระบบพร้อมใช้งานจริง ปลอดภัย ตรวจสอบย้อนหลังได้

---

## หมายเหตุสำคัญตลอดโปรเจกต์

- ห้ามใช้ AI ตัดสินว่าใครเป็นเจ้าของหรือผู้กระทำผิด — ใช้กระบวนการตรวจสอบโดยมนุษย์ (Admin)
- Security ต้องเกิดจาก: Information Asymmetry, Ownership Verification, Controlled Custody, Role-Based Access, RLS, Audit Trail, Risk Signals, Secure Handover
- ตัดสินใจ technical implementation เองได้ ยกเว้นกรณีต้องใช้ credential จริง, ยืนยัน location จริง, ตัดสิน policy สถาบัน หรือมีผลต่อ production data