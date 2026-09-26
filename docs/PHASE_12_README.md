# Phase 12 — Production Deployment

เป้าหมาย: ระบบพร้อมใช้งานจริง ปลอดภัย ตรวจสอบย้อนหลังได้

## สิ่งที่เพิ่มใน Phase 12

| หมวด | สิ่งที่ทำ |
|---|---|
| Admin เริ่มต้น | `create-admin` ปฏิเสธ `admin12345` / รหัสสั้นกว่า 12 ตัว; เว้นว่างเพื่อสุ่มรหัสชั่วคราว; รันซ้ำจะไม่รีเซ็ตรหัสของ admin ที่มีอยู่ (ต้องใส่ `--reset-password`) |
| แต่งตั้งเจ้าหน้าที่ | หน้า `/admin/users` + `set_user_role()` (0027): admin เท่านั้น, ต้องมีเหตุผล, เปลี่ยนสิทธิ์ตัวเองไม่ได้, ถอด admin คนสุดท้ายไม่ได้, audit + แจ้งผู้ใช้ |
| ลืมรหัสผ่าน | หน้า `/forgot-password` (ตอบเหมือนกันทุกกรณี ไม่บอกว่ามีบัญชีหรือไม่) → ลิงก์อีเมล → `/change-password` |
| ยืนยันอีเมล | login ที่ยังไม่ยืนยันอีเมลได้ข้อความชัดเจน |
| ช่องโหว่ | `/auth/callback?next=@evil.com` เคยพาไปเว็บอื่นได้ (open redirect) → แก้ด้วย `src/lib/auth/redirect.ts` + test |
| Deploy | `vercel.json` (region `sin1`), `scripts/check-env.mjs` รันก่อน build — build production ล้มถ้าคีย์สลับ/ผิด project/ใส่ service key ใน `NEXT_PUBLIC_*` |
| Health | `GET /api/health` → `{status, db, version}` สำหรับ uptime monitor |
| ตรวจหลัง deploy | `npm run smoke:prod -- <url>` อ่านอย่างเดียว ไม่ login ไม่เขียนข้อมูล |
| ตรวจ Git | `npm run security:secrets` ตรวจไฟล์และ **ทุก commit ย้อนหลัง** หา service key / sb_secret / private key / DB URL มีรหัส / `.env` ที่ถูก commit |
| ตรวจฐานข้อมูลจริง | `supabase/verify/production_readiness.sql` — RLS, สิทธิ์, admin เปลี่ยนรหัสแล้ว, ไม่มีบัญชีทดสอบ, ไม่มีข้อมูล self-test, มีจุดส่งมอบ |
| Seed | `supabase/seed/locations_template.sql` — template สถานที่จริง (ไม่มีข้อมูลสมมติ) |
| Core flow | `supabase/tests/phase12_core_flow.test.sql` — ทั้งสอง flow ใน README ครบวงจร + การแต่งตั้งเจ้าหน้าที่ |
| เอกสาร | `docs/DEPLOYMENT.md`, `docs/ADMIN_GUIDE.md`, `docs/HANDOVER.md` |

## Checklist README → ทำอย่างไร

| ข้อ | เครื่องมือ / เอกสาร | ใครทำ |
|---|---|---|
| Deploy บน Vercel | `docs/DEPLOYMENT.md` ข้อ 6 | ผู้ดูแลระบบ (ต้องใช้บัญชีจริง) |
| ตรวจ Core Flow ครบวงจร | อัตโนมัติ: `phase12_core_flow.test.sql` ✅ · ด้วยมือบน staging: หัวข้อด้านล่าง | ผู้ดูแลระบบ + เจ้าหน้าที่ |
| เปลี่ยนรหัส admin เริ่มต้น | `create-admin` ไม่ใช้ `admin12345` แล้ว + DB บังคับเปลี่ยน · ตรวจ: `production_readiness.sql` ข้อ 8 | admin |
| เปิด Email Verification | `docs/DEPLOYMENT.md` ข้อ 3 (ต้องตั้ง SMTP) | ผู้ดูแลระบบ **[ตัดสินใจ]** |
| ตรวจ RLS ครั้งสุดท้าย | `production_readiness.sql` ข้อ 1–6 + `security_selftest.sql` | ผู้ดูแลระบบ |
| ไม่มี secret ใน Git | `npm run security:secrets` | ผู้พัฒนา |
| ไม่มี demo account / fake data | ใช้ Supabase project ใหม่ + `production_readiness.sql` ข้อ 9, 10, 14 | ผู้ดูแลระบบ |
| เอกสารส่งมอบ + คู่มือ Admin | `docs/HANDOVER.md`, `docs/ADMIN_GUIDE.md` ✅ | — |

## ทดสอบ Core Flow ด้วยมือ (บน Preview ที่ต่อกับ staging)

ใช้ 4 บัญชี: เจ้าของ A, เจ้าของ B, ผู้พบ F, เจ้าหน้าที่ S (+ admin)

**Flow 1 — Lost → Match → Claim → Verification → Review → Secure Handover → Returned**
1. A แจ้งของหาย (ใส่รายละเอียดส่วนตัว) → F แจ้งพบของชิ้นเดียวกัน (ใส่จุดสังเกตลับ)
2. A ได้แจ้งเตือน "อาจตรงกัน" และเห็นรายการในแดชบอร์ด — **ไม่เห็นจุดสังเกตลับ**
3. A ขอรับของ ตอบคำถาม → S เห็นคำตอบเทียบจุดสังเกตลับ → บันทึก "เก็บในคลัง" → "น่าจะเป็นเจ้าของ" → "อนุมัติ"
4. A กด "ขอรหัสรับของ" → S กรอกรหัสผิด 1 ครั้ง (ได้ "รหัสไม่ถูกต้อง") แล้วกรอกถูก
5. ตรวจ: ของเป็น "คืนแล้ว", ประกาศของหายของ A ปิด, A และ F ได้แจ้งเตือน, `/admin/audit` มีทุกขั้น, รหัสเดิมใช้ซ้ำไม่ได้

**Flow 2 — Found → Custody → Match → Claim → Verification → Handover → Returned**
1. F แจ้งพบ **โทรศัพท์** (ประเภทมูลค่าสูง) เลือก "ส่งต่อให้เจ้าหน้าที่" → S บันทึก "เก็บในคลัง"
2. B แจ้งหายโทรศัพท์ → ขอรับ → S: "น่าจะเป็นเจ้าของ" → ลอง "อนุมัติ" (ต้องไม่ได้) → "ยืนยันแล้ว" → "อนุมัติ"
3. B ขอรหัส → S กรอกรหัส **โดยไม่ตรวจบัตร** (ต้องไม่ได้) → ตรวจบัตร เลือกประเภทบัตร → สำเร็จ
4. ตรวจเหมือน Flow 1 + บันทึกการส่งมอบมีประเภทบัตร

**เพิ่มเติม:** ให้ A และ B ขอรับของชิ้นเดียวกัน → ต้องเป็น "ข้อพิพาท" และอนุมัติไม่ได้ · admin แต่งตั้ง/ถอด S ที่ `/admin/users` แล้วเห็นใน Audit log · ลืมรหัสผ่านได้รับอีเมลและตั้งรหัสใหม่ได้

## ผลตรวจในเครื่องพัฒนา

- unit tests ผ่านทั้งหมด, typecheck / lint / build ผ่าน, `security:bundle` ผ่าน
- ชุดทดสอบฐานข้อมูล phase 3–12 ผ่านทั้งหมด
- `smoke-prod` กับเซิร์ฟเวอร์จำลอง: ผ่านทุกข้อ
- ทดสอบหน้าจริงด้วย browser: `/admin/users` แต่งตั้งสิทธิ์ → เรียก `set_user_role` ถูกต้อง, `/forgot-password` ส่ง `redirect_to` ไป `/auth/callback?next=/change-password`
