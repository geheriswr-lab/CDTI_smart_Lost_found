"use client";

import { useFormState, useFormStatus } from "react-dom";
import { setUserRoleAction, type RoleState } from "@/lib/actions/users";
import type { SystemRole } from "@/types/database.types";

const initial: RoleState = { error: null, ok: false };

const ROLE_TH: Record<SystemRole, string> = { user: "ผู้ใช้ทั่วไป", staff: "เจ้าหน้าที่", admin: "ผู้ดูแลระบบ" };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-3 py-1.5 text-xs text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "กำลังบันทึก..." : "บันทึกสิทธิ์"}
    </button>
  );
}

export function RoleForm({ userId, current }: { userId: string; current: SystemRole }) {
  const [state, action] = useFormState(setUserRoleAction, initial);
  if (state.ok) return <p className="text-xs text-green-700">บันทึกแล้ว (มีบันทึกใน Audit log)</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <label className="sr-only" htmlFor={`role-${userId}`}>สิทธิ์</label>
      <select id={`role-${userId}`} name="role" defaultValue={current} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
        {(Object.keys(ROLE_TH) as SystemRole[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_TH[r]}
          </option>
        ))}
      </select>
      <input
        name="reason"
        required
        minLength={3}
        maxLength={500}
        placeholder="เหตุผล เช่น คำสั่งแต่งตั้งเลขที่…"
        className="w-56 rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
      <Submit />
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
