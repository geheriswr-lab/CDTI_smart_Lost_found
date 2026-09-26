"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/reports/validation";

export const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none aria-[invalid=true]:border-red-400";

export function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function PublicSection({ children }: { children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <legend className="px-1 text-sm font-semibold text-cdti-700">ข้อมูลสาธารณะ</legend>
      <p className="-mt-1 text-xs text-gray-500">
        ข้อมูลส่วนนี้จะแสดงในประกาศให้ทุกคนเห็น — อย่าใส่ข้อมูลที่ใช้ยืนยันความเป็นเจ้าของ
      </p>
      {children}
    </fieldset>
  );
}

export function PrivateSection({ intro, children }: { intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-amber-800">
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current">
          <path d="M10 1a4.5 4.5 0 0 0-4.5 4.5V8H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm2.5 7h-5V5.5a2.5 2.5 0 0 1 5 0V8Z" />
        </svg>
        ข้อมูลลับ — ไม่แสดงต่อสาธารณะ
      </legend>
      <div className="-mt-1 text-xs text-amber-900">{intro}</div>
      {children}
    </fieldset>
  );
}

export function PhotoPrivacyWarning() {
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
      <p className="font-semibold">ก่อนถ่ายรูป / อัปโหลด</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>หลีกเลี่ยงการถ่ายให้เห็นข้อมูลส่วนบุคคลชัดเจน เช่น ชื่อ-นามสกุล เลขบัตร ใบหน้า หน้าจอโทรศัพท์ หรือเอกสาร</li>
        <li>ห้ามถ่ายให้เห็นหมายเลขเครื่อง (serial) หรือจุดสังเกตเฉพาะในรูปสาธารณะ</li>
        <li>ถ้าต้องเก็บรูปที่มีรายละเอียดเหล่านี้ ให้ใช้ช่อง &ldquo;รูปสำหรับตรวจสอบ (ลับ)&rdquo; แทน</li>
      </ul>
    </div>
  );
}

export function ImageInput({
  id,
  label,
  hint,
  error,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setClientError(null);
    setPreview(null);
    if (!file) return;
    // Early UX feedback only — the server re-checks size and magic bytes.
    if (file.size > MAX_IMAGE_BYTES) {
      setClientError("ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB");
      e.target.value = "";
      return;
    }
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setClientError("รองรับเฉพาะไฟล์รูป JPG, PNG หรือ WebP");
      e.target.value = "";
      return;
    }
    setPreview(URL.createObjectURL(file));
  }

  const shownError = clientError ?? error;

  return (
    <Field id={id} label={label} hint={hint} error={shownError}>
      <input
        id={id}
        name={id}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        onChange={onChange}
        aria-invalid={!!shownError}
        className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-cdti-50 file:px-3 file:py-2 file:text-cdti-700 hover:file:bg-cdti-100"
      />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        <img src={preview} alt="ตัวอย่างรูป" className="mt-2 h-32 w-auto rounded-md border object-cover" />
      )}
    </Field>
  );
}

export function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-cdti-600 px-4 py-2.5 text-white hover:bg-cdti-700 disabled:opacity-60 sm:w-auto"
    >
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {message}
    </p>
  );
}
