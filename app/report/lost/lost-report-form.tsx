"use client";

import { useFormState } from "react-dom";
import { reportLostItemAction, type ReportFormState } from "@/lib/actions/reports";
import { LIMITS, bangkokToday } from "@/lib/reports/validation";
import type { ReferenceData } from "@/lib/reports/queries";
import {
  Field,
  FormError,
  ImageInput,
  PhotoPrivacyWarning,
  PrivateSection,
  PublicSection,
  SubmitButton,
  inputClass,
} from "@/components/report/form-parts";

const initialState: ReportFormState = { error: null, fieldErrors: {} };

export function LostReportForm({ categories, locations }: Pick<ReferenceData, "categories" | "locations">) {
  const [state, formAction] = useFormState(reportLostItemAction, initialState);
  const e = state.fieldErrors;
  const today = bangkokToday();

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />

      <PublicSection>
        <Field id="item_name" label="ชื่อสิ่งของ" required error={e.item_name} hint="เช่น กระเป๋าสตางค์, หูฟังไร้สาย">
          <input id="item_name" name="item_name" required maxLength={LIMITS.name} className={inputClass} aria-invalid={!!e.item_name} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="category_id" label="ประเภท" required error={e.category_id}>
            <select id="category_id" name="category_id" required defaultValue="" className={inputClass} aria-invalid={!!e.category_id}>
              <option value="" disabled>
                เลือกประเภท
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_th}
                </option>
              ))}
            </select>
          </Field>

          <Field id="lost_date" label="วันที่ทำหาย" required error={e.lost_date} hint="ถ้าจำไม่ได้แน่ชัด ให้ใส่วันที่ใกล้เคียงที่สุด">
            <input id="lost_date" name="lost_date" type="date" required max={today} className={inputClass} aria-invalid={!!e.lost_date} />
          </Field>

          <Field id="brand" label="ยี่ห้อ" error={e.brand} hint="ไม่แสดงในประกาศ — ใช้ช่วยจับคู่เท่านั้น">
            <input id="brand" name="brand" maxLength={LIMITS.brand} className={inputClass} aria-invalid={!!e.brand} />
          </Field>

          <Field id="color" label="สี" error={e.color}>
            <input id="color" name="color" maxLength={LIMITS.color} className={inputClass} aria-invalid={!!e.color} />
          </Field>
        </div>

        <Field
          id="location_id"
          label="สถานที่ที่คาดว่าทำหาย"
          error={e.location_id}
          hint={locations.length === 0 ? "ยังไม่มีรายการสถานที่ในระบบ — ระบุสถานที่คร่าว ๆ ในคำอธิบายแทน" : undefined}
        >
          <select id="location_id" name="location_id" defaultValue="" className={inputClass} disabled={locations.length === 0}>
            <option value="">ไม่ระบุ / ไม่แน่ใจ</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="description" label="คำอธิบายทั่วไป" error={e.description} hint="ลักษณะทั่วไปที่ช่วยให้คนอื่นสังเกตเห็น — ไม่ต้องใส่จุดสังเกตลับ">
          <textarea id="description" name="description" rows={3} maxLength={LIMITS.description} className={inputClass} aria-invalid={!!e.description} />
        </Field>

        <PhotoPrivacyWarning />
        <ImageInput id="public_image" label="รูปสิ่งของ (แสดงสาธารณะ)" error={e.public_image} hint="ไม่บังคับ • JPG/PNG/WebP ไม่เกิน 5 MB" />
      </PublicSection>

      <PrivateSection
        intro={
          <>
            ใช้โดยเจ้าหน้าที่เพื่อตรวจสอบว่าผู้ที่พบของได้คืนของให้เจ้าของตัวจริง จะไม่แสดงในประกาศหรือส่งให้ผู้อื่น
            <strong className="mt-1 block">ห้ามใส่รหัสผ่าน, PIN, รหัส OTP หรือข้อมูลเข้าสู่ระบบใด ๆ</strong>
          </>
        }
      >
        <Field
          id="private_ownership_details"
          label="รายละเอียดที่ยืนยันความเป็นเจ้าของ"
          required
          error={e.private_ownership_details}
          hint="เช่น ของที่อยู่ข้างใน, รอยขีดข่วน/สติกเกอร์เฉพาะ, หมายเลขเครื่อง (serial), ลักษณะพวงกุญแจ"
        >
          <textarea
            id="private_ownership_details"
            name="private_ownership_details"
            rows={4}
            required
            maxLength={LIMITS.privateText}
            className={inputClass}
            aria-invalid={!!e.private_ownership_details}
          />
        </Field>

        <ImageInput
          id="private_image"
          label="รูปสำหรับตรวจสอบ (ลับ)"
          error={e.private_image}
          hint="ไม่บังคับ • เช่น รูปถ่ายเก่าของสิ่งของ, ใบเสร็จ, กล่องที่มี serial — เห็นได้เฉพาะคุณและเจ้าหน้าที่"
        />
      </PrivateSection>

      <SubmitButton label="แจ้งของหาย" />
    </form>
  );
}
