# Phase 10 — Admin Dashboard

## สิ่งที่ส่งมอบ

```
supabase/
  migrations/0025_phase10_admin_dashboard.sql  (ใหม่ — ต้องรันบน Supabase)
  verify/0025_verify.sql                       (คำสั่งตรวจหลังรัน — ต้อง ✅ ทั้ง 7 แถว)
  tests/phase10_admin_dashboard.test.sql       (DB tests 21 กรณี)
  setup_all.sql                                (ต่อท้ายด้วย 0025 แล้ว)
src/lib/actions/admin.ts                       (บันทึกภายใน / ส่งต่อเรื่อง / ประเภท / สถานที่)
src/components/admin/                          (เมนู admin, บันทึกภายใน, ฟอร์มส่งต่อ)
app/admin/layout.tsx                           (ตรวจสิทธิ์ฝั่ง server + เมนู)
app/admin/page.tsx                             ("รายการต้องตรวจสอบ")
app/admin/stats/                               (สถิติ + กราฟรายเดือน)
app/admin/categories/, app/admin/locations/    (จัดการข้อมูลอ้างอิง)
app/admin/escalations/                         (เรื่องส่งต่อให้ admin)
app/admin/claims/[id]/page.tsx                 (+ บันทึกภายใน + ส่งต่อให้ admin)
```

## ขั้นตอนติดตั้ง

1. SQL Editor → รัน `supabase/migrations/0025_phase10_admin_dashboard.sql` (รันซ้ำได้)
2. SQL Editor → รัน `supabase/verify/0025_verify.sql` → ต้องได้ ✅ ทุกแถว (7 แถว)
3. เพิ่ม **สถานที่ (พื้นที่ในสถาบัน)** ที่ `/admin/locations` — ฟอร์มแจ้งของยังเป็น "ไม่ระบุ" ได้อย่างเดียวจนกว่าจะเพิ่ม

## ตรงตาม README

| README | ที่ไหน |
|---|---|
| Dashboard "รายการต้องตรวจสอบ" — high-risk claims, repeated rejections, high-value items, disputes, suspicious activity, custody anomalies | `/admin` (8 แผง + ลิงก์เข้ารายการ) |
| จัดการ Categories / Locations / Handover Locations | `/admin/categories` · `/admin/locations` · `/admin/handover-locations` |
| ตรวจสอบ Claims, Disputes, Risk Events, Custody History, Audit Logs | `/admin/claims` · `?tab=disputed` · `/admin/risk` · `/admin/custody` + `/admin/handovers/[id]` · `/admin/audit` |
| Internal Notes (staff/admin only) | หน้าตรวจคำขอ (component ใช้ซ้ำได้กับ entity อื่น) |
| Approve / Reject Claim, Restrict Account, **Escalate Case** | หน้าตรวจคำขอ · `/admin/risk` · **ใหม่:** ส่งต่อให้ admin → `/admin/escalations` |
| Statistics (reports, matches, claims, returns, rejected, avg return time, success rate) — ไม่เปิด risk รายบุคคล | `/admin/stats` — `admin_stats()` คืนเฉพาะตัวเลขรวม (มี test ยืนยันว่าไม่มีข้อมูลรายคน) |
| `/admin` ป้องกันด้วย role check ทั้ง server-side และ RLS | middleware + `app/admin/layout.tsx` (ตรวจ role จาก DB ทุก request) + RLS/ฟังก์ชันตรวจ role เอง |

## ความผิดปกติของการครอบครอง (`admin_custody_anomalies()`)

- ของมูลค่าสูงอยู่กับผู้พบเกิน 2 วัน / ของทั่วไปเกิน 7 วัน
- ผู้พบบอกว่าส่งให้เจ้าหน้าที่แล้ว แต่ยังไม่มีเจ้าหน้าที่ยืนยันเกิน 3 วัน
- อนุมัติแล้วแต่ผู้ขอยังไม่มารับเกิน 7 วัน
- กรอกรหัสรับของผิด ≥ 3 ครั้ง (อาจมีคนพยายามเดา)
- สถานะรายการกับสถานะการครอบครองไม่สอดคล้องกัน

## สถิติ

- อัตราส่งคืนสำเร็จ = ของที่แจ้งพบในช่วงเวลาที่เลือก และคืนเจ้าของแล้ว ÷ ของที่แจ้งพบในช่วงนั้น
- เวลาเฉลี่ยจนคืนของ = วันแจ้งพบ → วันส่งมอบ
- กราฟรายเดือน (แจ้งของหาย / แจ้งพบของ / ส่งคืนสำเร็จ): สีผ่านตัวตรวจ palette (colorblind-safe), มี legend, hover tooltip และปุ่ม "ดูเป็นตาราง"
- เลือกช่วงเวลาได้ไม่เกิน 2 ปี

## ปรับความปลอดภัยเพิ่ม

- **บันทึกภายใน:** เดิม (Phase 1) staff คนไหนก็ลบบันทึกของคนอื่นได้ → ตอนนี้ลบได้เฉพาะ**ผู้เขียนหรือ admin** · แก้ไขย้อนหลังไม่ได้ · ทุกการเพิ่ม/ลบอยู่ใน audit log
- **ส่งต่อเรื่อง:** staff ส่งต่อได้ (ต้องมีเหตุผล 5–1000 ตัวอักษร, ส่งซ้ำเรื่องเดิมที่ยังเปิดไม่ได้) · ปิดได้เฉพาะ admin · แจ้งเตือน admin ทุกคน · audit ไม่เก็บข้อความเหตุผล
- **ประเภท/สถานที่:** เพิ่ม/แก้ได้เฉพาะ admin · ตรวจความยาวชื่อ · **ลบไม่ได้ ใช้ "ปิดใช้" แทน** (รายการเก่ายังอ้างถึงอยู่)

## ผลการตรวจคุณภาพ

- `npm test` — 54/54 · typecheck / lint / build — ผ่าน
- DB tests Phase 3–10 บน PostgreSQL 16 — ผ่านทั้งหมด (0025 รันซ้ำ 2 รอบ)
- **Integration ผ่าน PostgREST จริง:** สถิติ (staff ได้ / user ไม่ได้), ความผิดปกติ, ส่งต่อ → staff ปิดไม่ได้ → admin ปิดได้,
  บันทึกภายใน (user อ่านไม่ได้), admin เพิ่มประเภทได้ / staff ไม่ได้, audit ครบ
- **ทดสอบสิทธิ์เข้า /admin จริง:** guest → ไปหน้า login · user ทั่วไป → ไป /dashboard · staff/admin → เข้าได้ (ทุกหน้าย่อย)
- Render test หน้าแดชบอร์ดและสถิติ (รวม hover tooltip)
- Verify SQL ทดสอบทั้งรันแล้ว / ยังไม่รัน · verify ของ 0018–0024 ยังผ่าน
