"use client";

import { useFormState, useFormStatus } from "react-dom";
import { resolveEscalationAction, type AdminState } from "@/lib/actions/admin";

const initial: AdminState = { error: null, ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-3 py-1.5 text-xs text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "..." : "ปิดเรื่อง"}
    </button>
  );
}

export function ResolveEscalationForm({ id }: { id: string }) {
  const [state, action] = useFormState(resolveEscalationAction, initial);
  if (state.ok) return <p className="text-xs text-green-700">ปิดเรื่องแล้ว</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="escalation_id" value={id} />
      <input name="note" maxLength={1000} placeholder="ผลการพิจารณา" className="w-56 rounded-md border border-gray-300 px-2 py-1 text-xs" />
      <Submit />
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
