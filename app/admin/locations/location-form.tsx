"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveLocationAction, type AdminState } from "@/lib/actions/admin";

const initial: AdminState = { error: null, ok: false };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-3 py-1.5 text-xs text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "..." : label}
    </button>
  );
}

export function PlaceForm({ l }: { l?: { id: string; name: string; description: string | null; is_active: boolean } }) {
  const [state, action] = useFormState(saveLocationAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      {l && <input type="hidden" name="id" value={l.id} />}
      <input name="name" required maxLength={120} defaultValue={l?.name} placeholder="ชื่อพื้นที่ เช่น อาคาร 1, โรงอาหาร" className="w-56 rounded-md border border-gray-300 px-2 py-1" />
      <input name="description" maxLength={300} defaultValue={l?.description ?? ""} placeholder="คำอธิบาย (ไม่บังคับ)" className="w-64 rounded-md border border-gray-300 px-2 py-1" />
      {l && (
        <select name="is_active" defaultValue={l.is_active ? "yes" : "no"} className="rounded-md border border-gray-300 px-2 py-1">
          <option value="yes">เปิดใช้</option>
          <option value="no">ปิดใช้</option>
        </select>
      )}
      <Submit label={l ? "บันทึก" : "เพิ่มสถานที่"} />
      {state.ok && <span className="text-xs text-green-700">บันทึกแล้ว</span>}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
