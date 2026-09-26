"use client";

import { useFormState, useFormStatus } from "react-dom";
import { resolveRiskEventAction, setAccountRestrictionAction, type RiskActionState } from "@/lib/actions/risk";
import { RISK_RESOLUTION_TH, STAFF_RESOLUTIONS } from "@/lib/risk/labels";

const initial: RiskActionState = { error: null, ok: false };

function Submit({ label, tone = "primary" }: { label: string; tone?: "primary" | "danger" | "plain" }) {
  const { pending } = useFormStatus();
  const cls =
    tone === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : tone === "plain"
        ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        : "bg-cdti-600 text-white hover:bg-cdti-700";
  return (
    <button type="submit" disabled={pending} className={`rounded-md px-3 py-1.5 text-xs disabled:opacity-60 ${cls}`}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function ResolveRiskForm({ eventId }: { eventId: string }) {
  const [state, action] = useFormState(resolveRiskEventAction, initial);
  if (state.ok) return <p className="text-xs text-green-700">บันทึกแล้ว</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="event_id" value={eventId} />
      <select name="resolution" required defaultValue="" className="rounded-md border border-gray-300 px-2 py-1 text-xs">
        <option value="" disabled>
          ผลการตรวจสอบ…
        </option>
        {STAFF_RESOLUTIONS.map((r) => (
          <option key={r} value={r}>
            {RISK_RESOLUTION_TH[r]}
          </option>
        ))}
      </select>
      <input name="note" maxLength={1000} placeholder="บันทึก (ไม่บังคับ)" className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs" />
      <Submit label="บันทึก" />
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function RestrictionForm({ userId, restricted }: { userId: string; restricted: boolean }) {
  const [state, action] = useFormState(setAccountRestrictionAction, initial);
  if (state.ok) return <p className="text-xs text-green-700">{restricted ? "ยกเลิกการจำกัดสิทธิ์แล้ว" : "จำกัดสิทธิ์แล้ว"}</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="restricted" value={restricted ? "false" : "true"} />
      {!restricted && (
        <input
          name="reason"
          required
          minLength={5}
          maxLength={1000}
          placeholder="เหตุผล (เห็นเฉพาะเจ้าหน้าที่)"
          className="w-52 rounded-md border border-gray-300 px-2 py-1 text-xs"
        />
      )}
      <Submit label={restricted ? "ยกเลิกการจำกัดสิทธิ์" : "จำกัดสิทธิ์บัญชี"} tone={restricted ? "plain" : "danger"} />
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
