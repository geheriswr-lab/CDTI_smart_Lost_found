# เอกสารส่งมอบระบบ — CDTI Smart Lost & Found (v1.0.0)

ระบบบริหารจัดการทรัพย์สินสูญหายและทรัพย์สินที่มีผู้เก็บได้ สถาบันเทคโนโลยีจิตรลดา

| เอกสาร | สำหรับ |
|---|---|
| `docs/HANDOVER.md` (ไฟล์นี้) | ผู้ดูแลเทคนิค — ภาพรวม, โครงสร้าง, ความปลอดภัย, การดูแลรักษา |
| `docs/DEPLOYMENT.md` | ขั้นตอนขึ้นระบบจริง (Supabase + Vercel) |
| `docs/ADMIN_GUIDE.md` | เจ้าหน้าที่ / ผู้ดูแลระบบ — วิธีใช้งานประจำวัน |
| `docs/PHASE_1_README.md` … `PHASE_12_README.md` | รายละเอียดการออกแบบและการทดสอบแต่ละ phase |

---

## 1. ภาพรวมสถาปัตยกรรม

```
Browser ──► Vercel (Next.js 14 App Router, region sin1)
              │  middleware.ts  → กฎ route (src/lib/auth/routes.ts)
              │  Server Components / Server Actions (anon key + session ของผู้ใช้ → ผ่าน RLS)
              │  src/lib/supabase/admin.ts (service role, server-only) → งานระบบ: จับคู่, แจ้งเตือน
              ▼
          Supabase (Singapore)
              ├─ Postgres: ตาราง + RLS + ฟังก์ชัน SECURITY DEFINER (กฎธุรกิจทั้งหมดอยู่ที่นี่)
              ├─ Auth: email/password, ยืนยันอีเมล, ลืมรหัสผ่าน
              └─ Storage: item-images-public (รูป public, path สุ่ม) / verification-private (หลักฐาน, รูปลับ)
```

**หลักการ:** ฐานข้อมูลเป็นด่านสุดท้ายเสมอ — แม้มีคนเรียก Supabase API ตรงโดยไม่ผ่านเว็บ ก็ทำได้แค่ที่ RLS และฟังก์ชันอนุญาต หน้าเว็บ/middleware เป็นแค่ UX

## 2. โครงสร้างโค้ด

| ที่ | มีอะไร |
|---|---|
| `app/` | หน้าเว็บ: public listing (`/lost`, `/found`), แจ้งของ (`/report`), คำขอ (`/claims`), แดชบอร์ดผู้ใช้, `/admin/*`, `/api/health` |
| `src/lib/actions/` | Server Actions (ตรวจ input แล้วเรียก RPC ในฐานข้อมูล) |
| `src/lib/matching/` | คะแนนจับคู่ของหาย–ของพบ (ใช้เฉพาะข้อมูล public ของของที่พบ) |
| `src/lib/auth/` | session guard, กฎ route, safe redirect |
| `supabase/migrations/` | 0001–0027 เรียงตามลำดับ |
| `supabase/setup_all.sql` | รวมทุก migration — ใช้สร้างฐานข้อมูลใหม่ทั้งระบบ |
| `supabase/verify/` | ตัวตรวจแบบอ่านอย่างเดียวสำหรับ SQL Editor (ต่อ migration, security self-test, production readiness) |
| `supabase/tests/` | ชุดทดสอบฐานข้อมูล phase 3–12 (รันบน Postgres ทดสอบ) |
| `supabase/seed/` | template สถานที่จริง |
| `scripts/` | `create-admin`, `rematch-all`, `check-env`, `smoke-prod`, `security/check-bundle`, `security/check-secrets` |

## 3. Migration

| ไฟล์ | เนื้อหา |
|---|---|
| 0001–0017 | Phase 1–2: enums, ตารางหลัก, RLS, views public, storage, profiles/roles |
| 0018 | แจ้งของหาย/พบ: guard, rate limit, audit, ประเภทตั้งต้น |
| 0019 | public listing: path รูปไม่ระบุตัวตน |
| 0020 | matching + notifications |
| 0021 | claims ผ่าน RPC, rate limit, ตรวจสองขั้นของมูลค่าสูง |
| 0022 | สัญญาณความเสี่ยง, ข้อพิพาท, จำกัดสิทธิ์ |
| 0023 | custody, รหัสส่งมอบ (bcrypt, 48 ชม., ล็อก 5 ครั้ง) |
| 0024 | ป้องกันข้อมูลลับในแจ้งเตือน, audit log แก้/ลบไม่ได้ |
| 0025 | admin dashboard, สถิติ, escalation |
| 0026 | Phase 11 hardening (บังคับเปลี่ยนรหัสในฐานข้อมูล, ล็อกจุดสังเกตลับ, ตัดสิทธิ์ส่วนเกิน) |
| 0027 | แต่งตั้งเจ้าหน้าที่จากหน้า admin (`set_user_role`) |

ทุกไฟล์ idempotent (รันซ้ำได้) · migration ใหม่: เพิ่มไฟล์ `00NN_*.sql` + ต่อท้าย `setup_all.sql` + เขียน `verify/00NN_verify.sql` + ทดสอบบน staging ก่อน

## 4. โมเดลความปลอดภัย (สรุป)

| กลไก | ทำงานอย่างไร |
|---|---|
| Information asymmetry | จุดสังเกตลับ / serial / ตำแหน่งละเอียด / ข้อมูลเจ้าของ ไม่เคยออกจาก DB ไปหาผู้ใช้ทั่วไป — public view whitelist คอลัมน์, แจ้งเตือนถูกตรวจว่าไม่มีค่าลับ |
| Ownership verification | ผู้ขอตอบคำถามโดยไม่เห็นข้อมูลลับ, เจ้าหน้าที่เทียบ, ของมูลค่าสูงต้องผ่าน "ยืนยันแล้ว" + ตรวจบัตร |
| Controlled custody | ทุกการย้ายของบันทึกใน `custody_history`, ส่งมอบได้เฉพาะของที่อยู่กับเจ้าหน้าที่ |
| Secure handover | รหัส 6 หลักสุ่มแบบ CSPRNG เก็บเป็น bcrypt, ไม่มีใครอ่านได้, ใช้ครั้งเดียว, หมดอายุ 48 ชม., ล็อกเมื่อผิด 5 ครั้ง |
| Role-based access | role จาก `profiles.role` เท่านั้น; ไม่มีสิทธิ์ staff/admin ระหว่างรอเปลี่ยนรหัสหรือถูกจำกัดสิทธิ์ |
| Rate limiting | แจ้งของ 10/ชม., คำขอใหม่ 3/วัน, active 5, ส่งซ้ำ 3 ครั้ง + cooldown |
| Audit trail | `audit_logs` แก้/ลบ/TRUNCATE ไม่ได้แม้ service role; บันทึกชื่อฟิลด์ที่แก้ ไม่บันทึกค่าลับ |
| Risk signals | สัญญาณอัตโนมัติ ใช้ภาษากลาง ให้คนตัดสิน |

รายละเอียดการทดสอบ: `docs/PHASE_11_README.md`

## 5. ความลับและการหมุนคีย์

| ความลับ | อยู่ที่ | ถ้ารั่ว |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (Sensitive) เท่านั้น | Supabase → Settings → API → roll → อัปเดต Vercel → Redeploy |
| รหัสผ่าน DB ของ Supabase | ผู้ดูแลเทคนิค (password manager) | Supabase → Settings → Database → reset |
| SMTP password | Supabase Auth SMTP settings | เปลี่ยนที่ผู้ให้บริการอีเมล แล้วอัปเดต Supabase |
| บัญชี GitHub / Vercel / Supabase | เจ้าของบัญชี (เปิด 2FA) | เปลี่ยนรหัส, ตรวจ member/token |

`NEXT_PUBLIC_SUPABASE_ANON_KEY` เป็นข้อมูลสาธารณะโดยการออกแบบ (ความปลอดภัยมาจาก RLS)

## 6. การตรวจและทดสอบ

| คำสั่ง / ไฟล์ | ใช้เมื่อ |
|---|---|
| `npm test` (62 tests), `npm run typecheck`, `npm run lint`, `npm run build` | ทุกครั้งก่อน push |
| `npm run security:bundle` | หลัง build — service key ไม่หลุดไป browser |
| `npm run security:secrets` | ก่อน push / ก่อนส่งมอบ — ไม่มีความลับใน Git history |
| `npm run check:env` | ตรวจ env ก่อน deploy (build production รันให้อัตโนมัติ) |
| `npm run smoke:prod -- <url>` | หลังทุก deploy (อ่านอย่างเดียว) |
| `supabase/verify/security_selftest.sql` | หลังแก้ migration — ทดลองโจมตี 22 กรณีแล้ว rollback |
| `supabase/verify/production_readiness.sql` | ก่อนเปิดใช้ และทุกเดือน |
| `supabase/tests/*.test.sql` | พัฒนาฟีเจอร์ฐานข้อมูล (Postgres ทดสอบเท่านั้น) |

## 7. งานดูแลรักษา

| ความถี่ | งาน |
|---|---|
| ทุกวัน | เจ้าหน้าที่ดู `/admin` |
| ทุกสัปดาห์ | ดู uptime monitor ของ `/api/health`, Supabase → Logs หา error |
| ทุกเดือน | `production_readiness.sql`, ทบทวนรายชื่อ staff/admin, `npm audit` + อัปเดต patch ของ Next.js / supabase-js บน staging ก่อน |
| ทุกภาคเรียน | ทดสอบกู้ backup บน project ทดลอง, ทบทวนสถานที่/จุดส่งมอบ |
| เมื่อต้องการ | `npm run rematch` — คำนวณการจับคู่ใหม่ทั้งหมด (เช่น หลังปรับน้ำหนักคะแนน) |

## 8. เหตุขัดข้อง

| อาการ | ตรวจ |
|---|---|
| `/api/health` → `db: error` | Supabase status, project ถูก pause (Free plan), คีย์ใน Vercel ถูก roll |
| ผู้ใช้ไม่ได้อีเมลยืนยัน/ลืมรหัส | Supabase → Auth → SMTP, Logs → Auth, โควตาอีเมล |
| ลิงก์ในอีเมลพากลับหน้า login พร้อม error | Redirect URLs ใน Supabase ไม่มีโดเมนนี้ |
| build บน Vercel ล้มที่ "Environment check failed" | อ่านข้อความ — คีย์สลับกัน / ผิด project / URL ไม่ใช่ https |
| สงสัยว่าบัญชีเจ้าหน้าที่ถูกยึด | admin ถอดสิทธิ์ที่ `/admin/users` → ตรวจ `/admin/audit` → ให้เจ้าของบัญชีเปลี่ยนรหัส |
| สงสัยว่า service key รั่ว | roll key ทันที (ข้อ 5) → ตรวจ Supabase logs → ตรวจ audit log |

## 9. ข้อจำกัดที่ทราบ / งานต่อยอด

- ยังไม่มี MFA ในตัวแอปสำหรับ admin/staff (แนะนำเปิด 2FA ของบัญชี Supabase/Vercel/GitHub; เพิ่ม Supabase MFA (TOTP) ในแอปได้ในอนาคต)
- CSP ยังใช้ `'unsafe-inline'` สำหรับ script (ข้อจำกัด Next 14) — ปรับเป็น nonce ได้
- ยังไม่มีขั้นตอนจำหน่าย/บริจาคของที่ไม่มีผู้มารับตามระเบียบสถาบัน
- ยังไม่มีการล้างไฟล์ที่อัปโหลดแล้วไม่ได้ใช้ใน Storage
- การจับคู่ทำตอนแจ้งของ (ไม่มี job ตามเวลา) — ใช้ `npm run rematch` เมื่อต้องการคำนวณใหม่
- ผู้ขอเห็นสถานะภายในของคำขอผ่าน API ตรงได้ (ไม่มีข้อมูลลับ; หน้าเว็บแสดงเป็นข้อความกลาง)
