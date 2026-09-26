import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cancelClaimAction } from "@/lib/actions/claims";
import { CLAIMANT_STATUS } from "@/lib/claims/labels";
import { labelledAnswers } from "@/lib/claims/questionnaire";
import { formatThaiDateTime } from "@/lib/reports/labels";
import { HandoverCodePanel } from "./handover-panel";
import { OfferRewardForm, PayDemoForm } from "@/components/se/se-forms";
import { getPlatformSettings } from "@/lib/se/queries";
import { REWARD_NAME, REWARD_STATUS_OWNER, feeFor, formatBaht } from "@/lib/se/labels";

export const metadata = { title: "คำขอรับของ — CDTI Smart Lost & Found" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TONE: Record<string, string> = {
  info: "bg-sky-100 text-sky-800",
  good: "bg-green-100 text-green-800",
  bad: "bg-gray-200 text-gray-700",
  neutral: "bg-amber-100 text-amber-800",
};

// Claimant's own view. Shows ONLY: their own answers, a collapsed status,
// neutral guidance. Never staff checklist/notes (claim_reviews is staff-only).
export default async function MyClaimPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { submitted?: string; evidence_failed?: string };
}) {
  if (!UUID_RE.test(params.id)) notFound();
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: claim } = await supabase
    .from("claims")
    .select("id, found_item_id, status, answers, claim_attempt_count, last_attempt_at, created_at")
    .eq("id", params.id)
    .eq("claimant_id", profile.id)
    .maybeSingle();
  if (!claim) notFound();

  const [{ data: item }, { count: evidenceCount }] = await Promise.all([
    supabase.from("public_found_items").select("id, general_name").eq("id", claim.found_item_id).maybeSingle(),
    supabase.from("claim_evidence").select("id", { count: "exact", head: true }).eq("claim_id", claim.id),
  ]);

  const status = CLAIMANT_STATUS[claim.status];

  // Pickup info (approved claims only). my_handover_info() returns nothing for anyone else.
  const { data: handoverRows } =
    claim.status === "approved" ? await supabase.rpc("my_handover_info", { p_claim_id: claim.id }) : { data: null };
  const handover = handoverRows?.[0] ?? null;
  const returned = claim.status === "approved" && !!handover?.completed;
  const [settings, { data: myRewards }] = returned
    ? await Promise.all([getPlatformSettings(), supabase.rpc("my_rewards")])
    : [null, { data: null }];
  const reward = (myRewards ?? []).find((r) => r.my_role === "owner" && r.claim_id === claim.id && r.status !== "cancelled") ?? null;
  const canCancel = ["pending", "needs_review", "insufficient"].includes(claim.status);
  const canResubmit =
    (claim.status === "insufficient" || claim.status === "cancelled") && claim.claim_attempt_count < 3;

  return (
    <div className="space-y-4">
      <Link href="/dashboard" className="text-sm text-cdti-600 hover:underline">
        ← กลับแดชบอร์ด
      </Link>

      {searchParams.submitted && (
        <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          ส่งคำขอรับของเรียบร้อยแล้ว เจ้าหน้าที่จะตรวจสอบและแจ้งผลผ่านหน้าการแจ้งเตือน
        </p>
      )}
      {searchParams.evidence_failed && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          อัปโหลดหลักฐานบางไฟล์ไม่สำเร็จ คำขอของคุณถูกบันทึกแล้ว หากจำเป็นเจ้าหน้าที่จะติดต่อขอเพิ่มเติม
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-cdti-700">คำขอรับของ{item ? `: ${item.general_name}` : ""}</h1>
        <span className={`rounded-full px-3 py-1 text-sm ${TONE[status.tone]}`}>{status.label}</span>
      </div>
      <p className="text-xs text-gray-500">
        ส่งเมื่อ {formatThaiDateTime(claim.created_at)} · ส่งข้อมูลแล้ว {claim.claim_attempt_count}/3 ครั้ง · หลักฐาน{" "}
        {evidenceCount ?? 0} ไฟล์
      </p>

      <section className="rounded-lg bg-white p-5 text-sm shadow-sm">
        {claim.status === "approved" && !handover?.completed && !handover?.ready && (
          <p>คำขอของคุณผ่านการตรวจสอบแล้ว ขณะนี้เจ้าหน้าที่กำลังรับของเข้าจุดรับของกลาง ระบบจะแจ้งเตือนเมื่อพร้อมให้รับ</p>
        )}
        {claim.status === "approved" && handover?.completed && (
          <p className="font-medium text-green-800">คุณได้รับของคืนเรียบร้อยแล้ว</p>
        )}
        {claim.status === "approved" && handover?.ready && !handover.completed && (
          <div className="space-y-3">
            <p className="font-medium text-green-800">ของพร้อมให้รับแล้ว</p>
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs text-gray-500">สถานที่รับของ</p>
              <p className="font-medium">{handover.location_name ?? "จุดรับของกลาง"}</p>
              {handover.location_address && <p className="text-xs text-gray-600">{handover.location_address}</p>}
              <p className="mt-1 text-xs text-gray-500">นำบัตรประจำตัว (บัตรนักศึกษา/บัตรประชาชน) และรหัสรับของไปด้วย</p>
            </div>
            <HandoverCodePanel claimId={claim.id} hasActiveCode={handover.code_active} codesLeft={handover.codes_left} />
          </div>
        )}
        {claim.status === "rejected" && (
          <p>ไม่สามารถยืนยันความเป็นเจ้าของได้จากข้อมูลที่ได้รับ หากคุณมีหลักฐานเพิ่มเติม กรุณาติดต่อเจ้าหน้าที่โดยตรง</p>
        )}
        {claim.status === "insufficient" && (
          <p>
            ข้อมูลที่ได้รับยังไม่เพียงพอสำหรับการยืนยัน คุณสามารถส่งข้อมูลใหม่ได้หลังครบ 24 ชั่วโมงจากครั้งล่าสุด
            {canResubmit && item && (
              <>
                {" "}
                <Link href={`/found/${item.id}/claim`} className="text-cdti-600 hover:underline">
                  ส่งข้อมูลใหม่
                </Link>
              </>
            )}
          </p>
        )}
        {status.tone === "info" && <p>เจ้าหน้าที่กำลังตรวจสอบ ระบบจะแจ้งให้ทราบเมื่อมีผล</p>}
        {claim.status === "cancelled" && <p>คุณยกเลิกคำขอนี้แล้ว</p>}
      </section>

      {returned && settings && (
        <section id="thanks" className="rounded-lg border border-green-100 bg-white p-5 text-sm shadow-sm">
          <h2 className="font-semibold text-cdti-700">{REWARD_NAME}</h2>
          {reward ? (
            <div className="mt-2 space-y-2">
              <p>
                {formatBaht(reward.amount)} — {REWARD_STATUS_OWNER[reward.status]}
              </p>
              {reward.fee_amount !== null && (
                <p className="text-xs text-gray-500">
                  ผู้พบได้รับ {formatBaht(reward.finder_amount)} · ค่าดำเนินการระบบ {formatBaht(reward.fee_amount)}
                  {reward.payment_ref && ` · เลขอ้างอิง ${reward.payment_ref}`}
                </p>
              )}
              {reward.status === "payable" && <PayDemoForm rewardId={reward.id} returnTo={`/claims/${claim.id}`} />}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-500">
                หากต้องการขอบคุณผู้ที่ช่วยส่งคืน สามารถมอบสินน้ำใจได้ตามความสมัครใจภายใน {settings.reward_offer_days} วัน —
                ไม่ให้ก็ได้ ไม่มีผลใด ๆ กับคุณ
              </p>
              <OfferRewardForm claimId={claim.id} settings={settings} />
              <p className="text-xs text-gray-400">
                ตัวอย่าง: 300 บาท → ผู้พบได้รับ {formatBaht(feeFor(300, settings.reward_fee_percent, settings.reward_fee_min).finder)}
              </p>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-cdti-700">คำตอบของคุณ (ครั้งล่าสุด)</h2>
        <dl className="mt-3 space-y-3 text-sm">
          {labelledAnswers(claim.answers ?? {}).map((a) => (
            <div key={a.label}>
              <dt className="text-gray-500">{a.label}</dt>
              <dd className="whitespace-pre-wrap break-words">{a.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {canCancel && (
        <form action={cancelClaimAction}>
          <input type="hidden" name="claim_id" value={claim.id} />
          <button type="submit" className="text-sm text-gray-500 underline hover:text-gray-700">
            ยกเลิกคำขอนี้
          </button>
        </form>
      )}
    </div>
  );
}
