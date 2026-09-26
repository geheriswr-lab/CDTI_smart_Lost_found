"use client";

import { useFormState } from "react-dom";
import { submitClaimAction, type ClaimFormState } from "@/lib/actions/claims";
import type { Question } from "@/lib/claims/questionnaire";
import { Field, FormError, SubmitButton, inputClass } from "@/components/report/form-parts";

const initialState: ClaimFormState = { error: null, fieldErrors: {} };

export function ClaimForm({
  foundItemId,
  questions,
  matchOptions,
  isResubmission,
}: {
  foundItemId: string;
  questions: Question[];
  matchOptions: { id: string; label: string }[];
  isResubmission: boolean;
}) {
  const [state, formAction] = useFormState(submitClaimAction, initialState);
  const e = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="found_item_id" value={foundItemId} />
      <FormError message={state.error} />

      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p className="font-semibold">เจ้าหน้าที่จะไม่ขอรหัสผ่าน, PIN, OTP หรือรหัสปลดล็อกเครื่องจากคุณ</p>
        <p className="mt-0.5 text-xs">ห้ามใส่ข้อมูลเหล่านี้ รวมถึงเลขบัตรประชาชน/เลขบัตร/เลขบัญชีแบบเต็ม ในคำตอบใด ๆ</p>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-cdti-700">คำถามยืนยันความเป็นเจ้าของ</legend>
        <p className="-mt-1 text-xs text-gray-500">
          ตอบจากความจำของคุณเอง ยิ่งละเอียดยิ่งช่วยให้ตรวจสอบได้เร็ว — คำตอบเห็นเฉพาะคุณและเจ้าหน้าที่ ผู้ที่พบของจะไม่เห็น
        </p>
        {questions.map((q) => (
          <Field key={q.key} id={`q_${q.key}`} label={q.label} required={q.required} hint={q.hint} error={e[q.key]}>
            {q.multiline ? (
              <textarea id={`q_${q.key}`} name={`q_${q.key}`} rows={3} maxLength={q.max} className={inputClass} aria-invalid={!!e[q.key]} />
            ) : (
              <input id={`q_${q.key}`} name={`q_${q.key}`} maxLength={q.max} className={inputClass} aria-invalid={!!e[q.key]} autoComplete="off" />
            )}
          </Field>
        ))}
      </fieldset>

      {matchOptions.length > 0 && (
        <fieldset className="space-y-2 rounded-lg border border-gray-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-cdti-700">เชื่อมกับรายการของหายของคุณ (ไม่บังคับ)</legend>
          <select name="match_id" defaultValue={matchOptions[0].id} className={inputClass}>
            {matchOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="">ไม่เชื่อม</option>
          </select>
        </fieldset>
      )}

      <fieldset className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
        <legend className="px-1 text-sm font-semibold text-amber-800">หลักฐานเพิ่มเติม (ไม่บังคับ · ลับ)</legend>
        <p className="text-xs text-amber-900">
          เช่น รูปถ่ายเก่าที่เห็นสิ่งของ ใบเสร็จ กล่องที่มี serial — ไม่เกิน 3 ไฟล์ (JPG/PNG/WebP/PDF ไม่เกิน 5 MB ต่อไฟล์)
          เห็นได้เฉพาะคุณและเจ้าหน้าที่ · ควรปิดบังเลขบัตรหรือข้อมูลส่วนตัวที่ไม่เกี่ยวข้องก่อนอัปโหลด
        </p>
        <input
          type="file"
          name="evidence"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-cdti-700"
        />
        {e.evidence && <p className="text-xs text-red-600">{e.evidence}</p>}
      </fieldset>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" name="confirm_truthful" value="yes" className="mt-1 accent-cdti-600" />
        <span>
          ข้าพเจ้ายืนยันว่าข้อมูลข้างต้นเป็นความจริง และเข้าใจว่าการแอบอ้างเป็นเจ้าของทรัพย์สินผู้อื่นเป็นความผิด
          {e.confirm_truthful && <span className="block text-xs text-red-600">{e.confirm_truthful}</span>}
        </span>
      </label>

      <SubmitButton label={isResubmission ? "ส่งข้อมูลใหม่" : "ส่งคำขอรับของ"} />
    </form>
  );
}
