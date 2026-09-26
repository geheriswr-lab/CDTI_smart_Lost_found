"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveHandoverLocationAction, type SimpleState } from "@/lib/actions/handover";

const initial: SimpleState = { error: null, ok: false };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-3 py-1.5 text-xs text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "..." : label}
    </button>
  );
}

export function LocationForm({
  location,
}: {
  location?: { id: string; name: string; address: string | null; is_active: boolean };
}) {
  const [state, action] = useFormState(saveHandoverLocationAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {location && <input type="hidden" name="id" value={location.id} />}
      <input name="name" required maxLength={120} defaultValue={location?.name} placeholder="ชื่อจุด เช่น ห้องกิจการนักศึกษา" className="w-56 rounded-md border border-gray-300 px-2 py-1 text-sm" />
      <input name="address" maxLength={300} defaultValue={location?.address ?? ""} placeholder="อาคาร / ชั้น / เวลาทำการ" className="w-64 rounded-md border border-gray-300 px-2 py-1 text-sm" />
      {location && (
        <select name="is_active" defaultValue={location.is_active ? "yes" : "no"} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="yes">เปิดใช้</option>
          <option value="no">ปิดใช้</option>
        </select>
      )}
      <Submit label={location ? "บันทึก" : "เพิ่มจุดส่งมอบ"} />
      {state.ok && <span className="text-xs text-green-700">บันทึกแล้ว</span>}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
