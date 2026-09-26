# คู่มือ Deploy ขึ้นใช้งานจริง (Supabase + Vercel)

ทำตามลำดับ ทุกขั้นมีตัวตรวจให้รันหลังทำเสร็จ ช่องที่เขียนว่า **[ตัดสินใจ]** เป็นเรื่องนโยบายของสถาบัน ต้องให้ผู้รับผิดชอบระบบเป็นผู้เลือก

---

## 0. สิ่งที่ต้องมี

- บัญชี GitHub (เก็บโค้ด), Vercel และ Supabase ที่เปิด **2FA** แล้วทั้งสามบัญชี
- อีเมลสำหรับส่งอีเมลของระบบ (SMTP) เช่น บัญชีของโดเมน `cdti.ac.th` หรือบริการอย่าง Resend / SendGrid
- รายชื่อ **สถานที่** และ **จุดส่งมอบ** ที่สถาบันยืนยันแล้ว
- รายชื่อผู้ที่จะเป็น admin / เจ้าหน้าที่

## 1. ตรวจโค้ดก่อน push (บนเครื่องที่พัฒนา)

```bash
npm ci
npm test && npm run typecheck && npm run lint && npm run build
npm run security:bundle      # service role key ไม่อยู่ใน JavaScript ฝั่ง browser
npm run security:secrets     # ไม่มีรหัสผ่าน/คีย์ใน Git (ตรวจทุก commit ย้อนหลัง)
```

ถ้า `security:secrets` เจออะไร **ห้าม push** — ลบออกจาก history และ **หมุนคีย์ใหม่ใน Supabase** (Settings → API) เพราะคีย์ที่เคย push ไปแล้วถือว่ารั่ว

## 2. สร้าง Supabase project สำหรับ Production

แนะนำให้สร้าง **project ใหม่** สำหรับใช้งานจริง แล้วเก็บ project เดิมที่ใช้ทดสอบไว้เป็น staging เพื่อให้ production ไม่มีบัญชีหรือข้อมูลทดสอบค้างอยู่เลย (README ข้อ "ห้ามมี Demo Account / Fake Data")

1. New project → Region **Southeast Asia (Singapore)** (ใกล้ผู้ใช้ และตรงกับ Vercel region `sin1` ใน `vercel.json`)
2. **[ตัดสินใจ]** แผน: Free plan จะ **pause project เมื่อไม่มีการใช้งาน 7 วัน** และไม่มี backup ให้ดาวน์โหลด → ใช้งานจริงควรใช้ **Pro** (มี daily backup) และพิจารณาเปิด Point-in-Time Recovery
3. SQL Editor → เปิดไฟล์ `supabase/setup_all.sql` → Run (ไฟล์เดียวรวมทุก migration 0001–0027)
4. รันตัวตรวจ (ทุกแถวต้องเป็น ✅):
   - `supabase/verify/0026_verify.sql` (15 แถว)
   - `supabase/verify/0027_verify.sql` (4 แถว)
   - `supabase/verify/security_selftest.sql` (22 แถว — ทดลองโจมตีแล้ว rollback ไม่ทิ้งข้อมูล)

## 3. ตั้งค่า Authentication (Supabase Dashboard)

| ที่ | ค่าที่ตั้ง | เหตุผล |
|---|---|---|
| Authentication → URL Configuration → **Site URL** | `https://<โดเมนจริง>` | ลิงก์ในอีเมลชี้กลับมาที่เว็บจริง |
| URL Configuration → **Redirect URLs** | `https://<โดเมนจริง>/auth/callback` (และ `https://<โดเมนจริง>/**` ได้) | ยืนยันอีเมล / ลืมรหัสผ่าน ใช้ callback นี้ |
| Sign In / Providers → Email → **Confirm email** | **[ตัดสินใจ]** แนะนำ **เปิด** | กันคนสมัครด้วยอีเมลคนอื่น (ผู้ใช้ต้องกดลิงก์ในอีเมลก่อน login) |
| Email → **Secure email change** | เปิด | เปลี่ยนอีเมลต้องยืนยันทั้งสองอีเมล |
| Password → **Minimum length** | 8 ขึ้นไป (แอปก็บังคับ 8) | |
| Password → **Leaked password protection** | เปิด (ถ้าแผนรองรับ) | ปฏิเสธรหัสที่เคยรั่วสาธารณะ |
| Rate Limits | ใช้ค่าเริ่มต้นหรือเข้มกว่า | กันการเดารหัส / สแปมอีเมล |
| Authentication → **SMTP Settings** | ตั้ง SMTP ของสถาบันหรือผู้ให้บริการ | **จำเป็นถ้าเปิด Confirm email / ลืมรหัสผ่าน** — SMTP ตั้งต้นของ Supabase ส่งได้น้อยมากและส่งได้เฉพาะอีเมลสมาชิกทีม |
| Email Templates | แปลเป็นภาษาไทย (Confirm signup, Reset password) | ผู้ใช้เข้าใจ |

## 4. สร้าง admin คนแรก (ครั้งเดียว)

บนเครื่องที่พัฒนา ใส่ค่า production ชั่วคราวใน `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role ของ production>
INITIAL_ADMIN_EMAIL=<อีเมล admin จริง>
INITIAL_ADMIN_PASSWORD=          # เว้นว่าง → ระบบสุ่มรหัสชั่วคราวที่แข็งแรงให้
```

```bash
npm run create-admin
```

- สคริปต์จะแสดงรหัสชั่วคราว **ครั้งเดียว** — ส่งให้ admin ผ่านช่องทางที่ปลอดภัย
- `admin12345` และรหัสที่สั้นกว่า 12 ตัวจะถูกปฏิเสธ
- admin ต้องเปลี่ยนรหัสตอน login ครั้งแรก ก่อนเปลี่ยนรหัส **ฐานข้อมูลจะยังไม่ให้สิทธิ์ admin** (0026)
- เสร็จแล้ว **ลบ service role key ของ production ออกจาก `.env.local`** บนเครื่อง

## 5. ใส่ข้อมูลตั้งต้นที่อนุญาต

README อนุญาตให้ seed เฉพาะ categories, system configuration และ location ที่ยืนยันแล้ว

- **ประเภทสิ่งของ**: มีมาใน `setup_all.sql` แล้ว (13 ประเภท) ปรับเพิ่มได้ที่ `/admin/categories`
- **สถานที่** และ **จุดส่งมอบ**: **[ตัดสินใจ]** ใช้รายชื่อที่สถาบันยืนยัน แล้วเพิ่มผ่าน `/admin/locations` และ `/admin/handover-locations` (มีบันทึก audit ว่าใครเพิ่ม) หรือใช้ `supabase/seed/locations_template.sql`
  - ต้องมี **จุดส่งมอบอย่างน้อย 1 แห่ง** ไม่อย่างนั้นส่งมอบของไม่ได้
- **เจ้าหน้าที่**: ให้แต่ละคนสมัครบัญชีเอง แล้ว admin แต่งตั้งที่ `/admin/users` (ต้องระบุเหตุผล เช่น เลขที่คำสั่ง)

## 6. Deploy บน Vercel

1. Push โค้ดขึ้น GitHub (repo แบบ **private**)
2. Vercel → Add New Project → Import repo → Framework: Next.js
3. **Environment Variables** — ตั้งแยกตาม environment:

| ตัวแปร | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL ของ production | URL ของ **staging** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key ของ production | anon key ของ staging |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role ของ production (**Sensitive**) | ของ staging เท่านั้น |
| `NEXT_PUBLIC_SITE_URL` | `https://<โดเมนจริง>` | URL ของ preview |

   - ห้ามใส่ service role key ในตัวแปรที่ขึ้นต้นด้วย `NEXT_PUBLIC_` เด็ดขาด
   - ตอน build production จะรัน `scripts/check-env.mjs` อัตโนมัติ ถ้าคีย์สลับกัน / คีย์ผิด project / URL ไม่ใช่ https **build จะล้ม** แทนที่จะ deploy ของที่พัง
4. Deploy → ตั้งโดเมน (Settings → Domains) → กลับไปแก้ Site URL / Redirect URLs ในข้อ 3 ให้ตรงโดเมน
5. Settings → Deployment Protection: เปิดสำหรับ Preview (ไม่ให้คนนอกเห็น preview)

## 7. ตรวจหลัง deploy

```bash
npm run smoke:prod -- https://<โดเมนจริง>
```

ตรวจแบบอ่านอย่างเดียว ไม่ login และไม่เขียนข้อมูล ครอบคลุม: health, หน้า public, หน้าที่ต้อง login, callback ไม่พาออกไปเว็บอื่น, security headers, บังคับ https, JavaScript ไม่มี service key, guest อ่านตารางลับผ่าน API ไม่ได้, guest list ไฟล์หลักฐานไม่ได้

จากนั้น

1. SQL Editor → `supabase/verify/production_readiness.sql` → ❌ ต้องเป็น 0 แถว ส่วน ⚠️ ให้คนตรวจ (รายชื่อเจ้าหน้าที่, สถานที่)
2. ทดสอบ Core Flow ด้วยมือตาม `docs/PHASE_12_README.md` หัวข้อ "ทดสอบ Core Flow ด้วยมือ" บน **Preview deployment ที่ต่อกับ staging** (โค้ดชุดเดียวกับ production) — ไม่ทดสอบบน production เพราะระบบลบรายการ/คำขอไม่ได้ (เก็บ audit) ข้อมูลทดสอบจะค้างเป็นข้อมูลปลอม
3. ตั้ง uptime monitor (เช่น UptimeRobot) ยิง `https://<โดเมน>/api/health` ทุก 5 นาที

## 8. หลังเปิดใช้งาน

- ดู `/admin` ทุกวันทำการ (คำขอรอตรวจ, ข้อพิพาท, สัญญาณเสี่ยง, ของค้างกับผู้พบ)
- ทุกเดือน: ตรวจรายชื่อ staff/admin ที่ `/admin/users`, ดู `/admin/audit`, รัน `production_readiness.sql`
- migration ใหม่ในอนาคต: ทดสอบบน staging ก่อน, ฟังก์ชันใหม่ต้อง `revoke ... from public, anon` (ตัวตรวจ 0026 จะฟ้อง)
- ถ้าสงสัยว่าคีย์รั่ว: Supabase → Settings → API → roll key → อัปเดตใน Vercel → Redeploy
