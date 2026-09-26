"use client";

import { useFormState, useFormStatus } from "react-dom";
import { recordCustodyAction, type SimpleState } from "@/lib/actions/handover";
import type { CustodyStatus } from "@/types/database.types";

const initial: SimpleState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-3 py-1.5 text-xs text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "..." : "บันทึก"}
    </button>
  );
}

export function CustodyForm({
  foundItemId,
  current,
  locations,
}: {
  foundItemId: string;
  current: CustodyStatus;
  locations: { id: string; name: string }[];
}) {
  const [state, action] = useFormState(recordCustodyAction, initial);
  if (state.ok) return <p className="text-xs text-green-700">บันทึกแล้ว</p>;
  if (locations.length === 0) return <p className="text-xs text-red-600">ยังไม่มีจุดส่งมอบที่เปิดใช้ — ให้ admin เพิ่มก่อน</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="found_item_id" value={foundItemId} />
      <select name="to_status" defaultValue="in_storage" className="rounded-md border border-gray-300 px-2 py-1 text-xs">
        {current === "with_finder" && <option value="transferred_to_staff">รับจากผู้พบแล้ว (ยังไม่เข้าคลัง)</option>}
        <option value="in_storage">{current === "in_storage" ? "ย้ายจุดเก็บ" : "เก็บเข้าจุดรับของกลาง"}</option>
      </select>
      <select name="location_id" required defaultValue="" className="rounded-md border border-gray-300 px-2 py-1 text-xs">
        <option value="" disabled>
          จุดเก็บ…
        </option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <input name="note" maxLength={1000} placeholder="บันทึก (ไม่บังคับ)" className="w-40 rounded-md border border-gray-300 px-2 py-1 text-xs" />
      <Submit />
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
