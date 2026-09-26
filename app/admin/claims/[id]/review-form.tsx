"use client";

import { useFormState, useFormStatus } from "react-dom";
import { reviewClaimAction, type ReviewFormState } from "@/lib/actions/claims";
import { CHECKLIST_ITEMS, REVIEW_OUTCOMES } from "@/lib/claims/labels";
import type { ClaimStatus, VerificationLevel } from "@/types/database.types";

const initial: ReviewFormState = { error: null, ok: false };

const VALUE_LABEL = { yes: "ใช่", no: "ไม่ใช่", na: "ไม่เกี่ยว/ไม่แน่ใจ" } as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-4 py-2 text-sm text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "กำลังบันทึก..." : "บันทึกผลการตรวจสอบ"}
    </button>
  );
}

export function ReviewForm({
  claimId,
  status,
  level,
  hasOtherActive,
}: {
  claimId: string;
  status: ClaimStatus;
  level: VerificationLevel;
  hasOtherActive: boolean;
}) {
  const [state, action] = useFormState(reviewClaimAction, initial);

  // Mirror the DB rule so the UI doesn't offer an option that will be refused.
  const canApprove =
    !hasOtherActive && (level === "enhanced" ? status === "verified" : status === "likely_owner" || status === "verified");
  const outcomes = REVIEW_OUTCOMES.filter((o) => o.value !== "approved" || canApprove);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="claim_id" value={claimId} />

      <fieldset>
        <legend className="text-sm font-semibold text-gray-800">Verification checklist</legend>
        <table className="mt-2 w-full text-sm">
          <tbody className="divide-y">
            {CHECKLIST_ITEMS.map((item) => (
              <tr key={item.key}>
                <td className="py-2 pr-3">{item.label}</td>
                {(["yes", "no", "na"] as const).map((v) => (
                  <td key={v} className="py-2 pr-2 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="radio" name={`chk_${item.key}`} value={v} defaultChecked={v === "na"} className="accent-cdti-600" />
                      {VALUE_LABEL[v]}
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-800">ผลการตรวจสอบ</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {outcomes.map((o) => (
            <label key={o.value} className="flex cursor-pointer gap-2 rounded-md border border-gray-200 p-2 text-sm hover:border-cdti-200">
              <input type="radio" name="outcome" value={o.value} required className="mt-1 accent-cdti-600" />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-xs text-gray-500">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        {hasOtherActive && (
          <p className="mt-2 text-xs text-red-700">มีคำขออื่นที่เปิดอยู่ (ข้อพิพาท) — ยังอนุมัติไม่ได้</p>
        )}
        {!hasOtherActive && level === "enhanced" && !canApprove && (
          <p className="mt-2 text-xs text-amber-700">ของมูลค่าสูง: ต้องบันทึก &ldquo;ยืนยันแล้ว&rdquo; ก่อน จึงจะอนุมัติได้</p>
        )}
      </fieldset>

      <label className="block text-sm">
        <span className="font-semibold text-gray-800">บันทึกภายใน (เห็นเฉพาะเจ้าหน้าที่)</span>
        <textarea name="note" rows={3} maxLength={2000} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
      </label>

      {state.error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="rounded-md bg-green-50 p-2 text-sm text-green-700">บันทึกแล้ว</p>}
      <Submit />
    </form>
  );
}
