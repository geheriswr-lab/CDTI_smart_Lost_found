"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveCategoryAction, type AdminState } from "@/lib/actions/admin";

const initial: AdminState = { error: null, ok: false };
const FORMS = [
  { v: "general", l: "ทั่วไป" },
  { v: "wallet", l: "กระเป๋าสตางค์" },
  { v: "key", l: "กุญแจ" },
  { v: "electronics", l: "อิเล็กทรอนิกส์" },
];

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-3 py-1.5 text-xs text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "..." : label}
    </button>
  );
}

export function CategoryForm({
  c,
}: {
  c?: { id: string; name_th: string; name_en: string | null; is_high_value: boolean; claim_form: string; is_active: boolean };
}) {
  const [state, action] = useFormState(saveCategoryAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input name="name_th" required maxLength={80} defaultValue={c?.name_th} placeholder="ชื่อภาษาไทย" className="w-48 rounded-md border border-gray-300 px-2 py-1" />
      <input name="name_en" maxLength={80} defaultValue={c?.name_en ?? ""} placeholder="English" className="w-36 rounded-md border border-gray-300 px-2 py-1" />
      <select name="claim_form" defaultValue={c?.claim_form ?? "general"} className="rounded-md border border-gray-300 px-2 py-1" aria-label="แบบสอบถามขอรับของ">
        {FORMS.map((f) => (
          <option key={f.v} value={f.v}>
            แบบฟอร์ม: {f.l}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" name="is_high_value" value="yes" defaultChecked={c?.is_high_value} className="accent-cdti-600" />
        มูลค่าสูง
      </label>
      {c && (
        <select name="is_active" defaultValue={c.is_active ? "yes" : "no"} className="rounded-md border border-gray-300 px-2 py-1">
          <option value="yes">เปิดใช้</option>
          <option value="no">ปิดใช้</option>
        </select>
      )}
      <Submit label={c ? "บันทึก" : "เพิ่มประเภท"} />
      {state.ok && <span className="text-xs text-green-700">บันทึกแล้ว</span>}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
