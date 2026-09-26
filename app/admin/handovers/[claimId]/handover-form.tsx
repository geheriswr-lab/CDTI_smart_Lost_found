"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { completeHandoverAction, type SimpleState } from "@/lib/actions/handover";
import { ID_DOCUMENT_TH, ID_DOCUMENT_TYPES } from "@/lib/handover/labels";

const initial: SimpleState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-full rounded-md bg-cdti-600 px-4 py-2.5 text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "กำลังตรวจสอบ..." : "ยืนยันการส่งมอบ"}
    </button>
  );
}

export function HandoverForm({
  claimId,
  enhanced,
  locations,
  defaultLocation,
}: {
  claimId: string;
  enhanced: boolean;
  locations: { id: string; name: string }[];
  defaultLocation: string | null;
}) {
  const [state, action] = useFormState(completeHandoverAction, initial);
  const [idChecked, setIdChecked] = useState(false);

  if (state.ok) {
    return <p className="rounded-md bg-green-50 p-4 text-sm font-medium text-green-800">{state.message}</p>;
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="claim_id" value={claimId} />
      <label className="block">
        <span className="text-sm font-medium text-gray-700">รหัสรับของ 6 หลัก (จากหน้าจอของผู้รับ)</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="off"
          maxLength={9}
          required
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-center font-mono text-2xl tracking-[0.3em]"
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">จุดส่งมอบ</span>
        <select name="location_id" required defaultValue={defaultLocation ?? ""} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2">
          <option value="" disabled>
            เลือกจุดส่งมอบ
          </option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className={`rounded-md border p-3 text-sm ${enhanced ? "border-amber-300 bg-amber-50" : "border-gray-200"}`}>
        <legend className="px-1 font-medium text-gray-700">ตรวจบัตรประจำตัว{enhanced && <span className="text-red-600"> (บังคับ — ของมูลค่าสูง)</span>}</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="id_checked" value="yes" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} className="accent-cdti-600" />
          ตรวจบัตรตัวจริงแล้ว ชื่อตรงกับผู้ขอรับในระบบ
        </label>
        {idChecked && (
          <select name="id_document_type" required defaultValue="" className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5">
            <option value="" disabled>
              ประเภทบัตรที่ตรวจ
            </option>
            {ID_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ID_DOCUMENT_TH[t]}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1 text-xs text-gray-500">ระบบบันทึกเฉพาะประเภทบัตร ไม่บันทึกเลขบัตร</p>
      </fieldset>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">บันทึก (ไม่บังคับ)</span>
        <textarea name="note" rows={2} maxLength={1000} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
      </label>

      {state.error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{state.error}</p>}
      <Submit />
    </form>
  );
}
