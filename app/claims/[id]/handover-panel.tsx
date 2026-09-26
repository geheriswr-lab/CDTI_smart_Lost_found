"use client";

import { useFormState, useFormStatus } from "react-dom";
import { issueHandoverCodeAction, type CodeState } from "@/lib/actions/handover";

const initial: CodeState = { error: null, code: null, issuedAt: null };

function IssueButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-cdti-600 px-4 py-2 text-sm text-white hover:bg-cdti-700 disabled:opacity-60">
      {pending ? "กำลังสร้างรหัส..." : label}
    </button>
  );
}

export function HandoverCodePanel({
  claimId,
  hasActiveCode,
  codesLeft,
}: {
  claimId: string;
  hasActiveCode: boolean;
  codesLeft: number;
}) {
  const [state, action] = useFormState(issueHandoverCodeAction, initial);

  if (state.code) {
    const expires = new Date(Date.parse(state.issuedAt!) + 48 * 3600 * 1000);
    return (
      <div className="rounded-lg border-2 border-cdti-600 bg-white p-5 text-center">
        <p className="text-sm text-gray-600">รหัสรับของของคุณ</p>
        <p className="my-2 font-mono text-4xl font-bold tracking-[0.3em] text-cdti-700" aria-label={`รหัส ${state.code.split("").join(" ")}`}>
          {state.code}
        </p>
        <p className="text-xs text-gray-500">
          ใช้ได้ครั้งเดียว หมดอายุ{" "}
          {expires.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })}
        </p>
        <div className="mt-3 rounded-md bg-amber-50 p-3 text-left text-xs text-amber-900">
          <p className="font-semibold">จดหรือถ่ายภาพรหัสนี้ไว้ — ระบบจะไม่แสดงรหัสนี้อีก</p>
          <ul className="mt-1 list-disc pl-4">
            <li>แสดงรหัสให้เจ้าหน้าที่ที่จุดรับของเท่านั้น พร้อมบัตรประจำตัว</li>
            <li>ห้ามส่งรหัสทางแชทหรือโทรศัพท์ — เจ้าหน้าที่จะไม่ขอรหัสทางช่องทางอื่น</li>
            <li>ถ้าลืมรหัส ขอรหัสใหม่ได้ (รหัสเดิมจะใช้ไม่ได้ทันที)</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="claim_id" value={claimId} />
      <p className="text-sm text-gray-700">
        {hasActiveCode
          ? "คุณมีรหัสที่ยังใช้ได้อยู่ ถ้าลืมรหัส สามารถขอรหัสใหม่ได้ (รหัสเดิมจะใช้ไม่ได้)"
          : "เมื่อพร้อมไปรับของ ให้กดขอรหัส แล้วนำรหัสไปแสดงกับเจ้าหน้าที่ภายใน 48 ชั่วโมง"}
      </p>
      {codesLeft > 0 ? (
        <IssueButton label={hasActiveCode ? "ขอรหัสใหม่" : "ขอรหัสรับของ"} />
      ) : (
        <p className="text-sm text-red-700">ขอรหัสครบจำนวนครั้งแล้ว กรุณาติดต่อเจ้าหน้าที่</p>
      )}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <p className="text-xs text-gray-400">ขอรหัสได้อีก {codesLeft} ครั้ง</p>
    </form>
  );
}
