"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addNoteAction, escalateAction, type AdminState } from "@/lib/actions/admin";

const initial: AdminState = { error: null, ok: false };

function Submit({ label, tone = "primary" }: { label: string; tone?: "primary" | "warn" }) {
  const { pending } = useFormStatus();
  const cls = tone === "warn" ? "bg-amber-600 hover:bg-amber-700" : "bg-cdti-600 hover:bg-cdti-700";
  return (
    <button type="submit" disabled={pending} className={`rounded-md px-3 py-1.5 text-xs text-white disabled:opacity-60 ${cls}`}>
      {pending ? "..." : label}
    </button>
  );
}

export function NoteForm({ entityType, entityId, returnTo }: { entityType: string; entityId: string; returnTo: string }) {
  const [state, action] = useFormState(addNoteAction, initial);
  return (
    <form action={action} className="space-y-2" key={state.ok ? Date.now() : "form"}>
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <textarea name="note" rows={2} maxLength={2000} required placeholder="บันทึกภายใน (เห็นเฉพาะเจ้าหน้าที่ แก้ไขภายหลังไม่ได้)" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
      <div className="flex items-center gap-2">
        <Submit label="เพิ่มบันทึก" />
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function EscalateForm({ entityType, entityId, returnTo }: { entityType: "claim" | "risk_event" | "found_item"; entityId: string; returnTo: string }) {
  const [state, action] = useFormState(escalateAction, initial);
  if (state.ok) return <p className="text-xs text-green-700">ส่งต่อให้ admin แล้ว</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input name="reason" required minLength={5} maxLength={1000} placeholder="เหตุผลที่ส่งต่อ" className="min-w-[14rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
      <Submit label="ส่งต่อให้ admin" tone="warn" />
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
