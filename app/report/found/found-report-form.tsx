"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { reportFoundItemAction, type ReportFormState } from "@/lib/actions/reports";
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

const CUSTODY_CHOICES = [
  {
    value: "with_finder",
    title: "ของยังอยู่กับฉัน",
    detail: "ฉันเก็บรักษาไว้เองระหว่างรอเจ้าของหรือรอนำส่งจุดรับของกลาง",
  },
  {
    value: "transferred_to_staff",
    title: "ฉันส่งมอบให้เจ้าหน้าที่ / จุดรับของกลางแล้ว",
    detail: "เจ้าหน้าที่จะยืนยันการรับของในระบบภายหลัง",
  },
] as const;

export function FoundReportForm({ categories, locations, handoverLocations }: ReferenceData) {
  const [state, formAction] = useFormState(reportFoundItemAction, initialState);
  const [custody, setCustody] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const e = state.fieldErrors;
  const today = bangkokToday();

  const isHighValue = categories.find((c) => c.id === categoryId)?.is_high_value ?? false;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />

      {/* 1. Custody first — README Phase 3: ask custody status immediately */}
      <fieldset className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-cdti-700">
          ตอนนี้สิ่งของอยู่ที่ไหน? <span className="text-red-500">*</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {CUSTODY_CHOICES.map((c) => (
            <label
              key={c.value}
              className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${
                custody === c.value ? "border-cdti-500 bg-cdti-50" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="custody_status"
                value={c.value}
                required
                checked={custody === c.value}
                onChange={() => setCustody(c.value)}
                className="mt-1 accent-cdti-600"
              />
              <span>
                <span className="block font-medium text-gray-900">{c.title}</span>
                <span className="block text-xs text-gray-500">{c.detail}</span>
              </span>
            </label>
          ))}
        </div>
        {e.custody_status && <p className="text-xs text-red-600">{e.custody_status}</p>}

        <DropOffAdvice
          emphasize={custody === "with_finder" && isHighValue}
          show={custody !== "transferred_to_staff"}
          handoverLocations={handoverLocations}
        />
      </fieldset>

      <PublicSection>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="category_id" label="ประเภท" required error={e.category_id}>
            <select
              id="category_id"
              name="category_id"
              required
              value={categoryId}
              onChange={(ev) => setCategoryId(ev.target.value)}
              className={inputClass}
              aria-invalid={!!e.category_id}
            >
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

          <Field id="general_name" label="ชื่อเรียกทั่วไป" required error={e.general_name} hint="เช่น โทรศัพท์มือถือ, กุญแจ — ไม่ต้องระบุรุ่น/ยี่ห้อ">
            <input id="general_name" name="general_name" required maxLength={LIMITS.name} className={inputClass} aria-invalid={!!e.general_name} />
          </Field>

          <Field id="color" label="สีคร่าว ๆ" error={e.color}>
            <input id="color" name="color" maxLength={LIMITS.color} className={inputClass} aria-invalid={!!e.color} />
          </Field>

          <Field id="found_date" label="วันที่พบ" required error={e.found_date}>
            <input id="found_date" name="found_date" type="date" required max={today} defaultValue={today} className={inputClass} aria-invalid={!!e.found_date} />
          </Field>
        </div>

        <Field
          id="location_id"
          label="บริเวณที่พบ (คร่าว ๆ)"
          error={e.location_id}
          hint={locations.length === 0 ? "ยังไม่มีรายการสถานที่ในระบบ — ระบุตำแหน่งจริงในช่องข้อมูลลับด้านล่าง" : "เลือกเฉพาะอาคาร/พื้นที่ ส่วนตำแหน่งที่แน่ชัดให้ใส่ในข้อมูลลับ"}
        >
          <select id="location_id" name="location_id" defaultValue="" className={inputClass} disabled={locations.length === 0}>
            <option value="">ไม่ระบุ</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="description" label="คำอธิบายทั่วไป" error={e.description} hint="บอกเพียงลักษณะกว้าง ๆ — อย่าบอกจุดสังเกต, ของข้างใน, ยี่ห้อ/รุ่น หรือ serial เพื่อป้องกันการแอบอ้าง">
          <textarea id="description" name="description" rows={3} maxLength={LIMITS.description} className={inputClass} aria-invalid={!!e.description} />
        </Field>

        <PhotoPrivacyWarning />
        <ImageInput id="public_image" label="รูปสิ่งของ (แสดงสาธารณะ)" error={e.public_image} hint="ไม่บังคับ • ถ่ายให้เห็นแค่รูปทรงทั่วไป ไม่เห็นจุดสังเกต" />
      </PublicSection>

      <PrivateSection
        intro={
          <>
            ข้อมูลนี้ใช้ตรวจสอบว่าผู้ที่มาขอรับเป็นเจ้าของจริง — ผู้ขอรับจะต้องบอกรายละเอียดเหล่านี้ได้เองโดยไม่เห็นคำตอบ
            จะไม่แสดงในประกาศ การแจ้งเตือน หรือส่งให้ผู้ขอรับ
          </>
        }
      >
        <Field id="secret_details" label="จุดสังเกตลับ" required error={e.secret_details} hint="สิ่งที่เจ้าของตัวจริงเท่านั้นจะรู้ เช่น สติกเกอร์/รอยตำหนิ, ของที่อยู่ข้างใน, วอลล์เปเปอร์, พวงกุญแจ">
          <textarea id="secret_details" name="secret_details" rows={4} required maxLength={LIMITS.privateText} className={inputClass} aria-invalid={!!e.secret_details} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="exact_location" label="ตำแหน่งที่พบอย่างละเอียด" error={e.exact_location} hint="เช่น โต๊ะริมหน้าต่าง ชั้น 2 ห้อง 204">
            <input id="exact_location" name="exact_location" maxLength={LIMITS.exactLocation} className={inputClass} aria-invalid={!!e.exact_location} />
          </Field>

          <Field id="exact_time" label="เวลาที่พบ" error={e.exact_time} hint="เวลาประเทศไทย (ไม่บังคับ)">
            <input id="exact_time" name="exact_time" type="datetime-local" className={inputClass} aria-invalid={!!e.exact_time} />
          </Field>
        </div>

        <Field id="serial_number" label="หมายเลขเครื่อง / Serial (ถ้ามี)" error={e.serial_number}>
          <input id="serial_number" name="serial_number" maxLength={LIMITS.serial} className={inputClass} aria-invalid={!!e.serial_number} autoComplete="off" />
        </Field>

        <ImageInput id="private_image" label="รูปสำหรับตรวจสอบ (ลับ)" error={e.private_image} hint="ไม่บังคับ • รูปที่เห็นจุดสังเกต/serial ชัดเจน — เห็นได้เฉพาะคุณและเจ้าหน้าที่" />
      </PrivateSection>

      <SubmitButton label="แจ้งพบของ" />
    </form>
  );
}

function DropOffAdvice({
  show,
  emphasize,
  handoverLocations,
}: {
  show: boolean;
  emphasize: boolean;
  handoverLocations: ReferenceData["handoverLocations"];
}) {
  if (!show) return null;
  return (
    <div
      role={emphasize ? "alert" : undefined}
      className={`rounded-md border p-3 text-xs ${
        emphasize ? "border-amber-400 bg-amber-50 text-amber-900" : "border-gray-200 bg-gray-50 text-gray-700"
      }`}
    >
      <p className="font-semibold">
        {emphasize
          ? "สิ่งของประเภทนี้มีมูลค่าสูง — ควรนำส่งจุดรับของกลางโดยเร็วที่สุด"
          : "คำแนะนำ: ของมีค่า (โทรศัพท์, คอมพิวเตอร์, กระเป๋าสตางค์, เครื่องประดับ) ควรนำส่งจุดรับของกลาง"}
      </p>
      <p className="mt-1">
        เพื่อความปลอดภัยของทั้งผู้พบและเจ้าของ และเพื่อให้การส่งคืนมีเจ้าหน้าที่ตรวจสอบ
        ไม่ควรนัดส่งคืนเองกับผู้ที่อ้างว่าเป็นเจ้าของ
      </p>
      {handoverLocations.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {handoverLocations.map((h) => (
            <li key={h.id}>
              <span className="font-medium">{h.name}</span>
              {h.address && <span className="text-gray-500"> — {h.address}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
