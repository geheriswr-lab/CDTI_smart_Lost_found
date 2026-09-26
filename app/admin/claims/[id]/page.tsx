import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { labelledAnswers } from "@/lib/claims/questionnaire";
import { buildClaimHints, type SerialHint } from "@/lib/claims/hints";
import { CHECKLIST_ITEMS, STAFF_STATUS } from "@/lib/claims/labels";
import { CUSTODY_STATUS_TH, FOUND_STATUS_TH, formatThaiDate, formatThaiDateTime } from "@/lib/reports/labels";
import { PRIVATE_BUCKET, PRIVATE_URL_TTL_SECONDS } from "@/lib/reports/storage";
import { RISK_LEVEL_TH, RISK_TYPE_TH, describeRiskDetails } from "@/lib/risk/labels";
import { ReviewForm } from "./review-form";
import { InternalNotes } from "@/components/admin/internal-notes";
import { EscalateForm } from "@/components/admin/admin-forms";

export const metadata = { title: "ตรวจสอบคำขอรับของ — Admin" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERIAL_TH: Record<SerialHint, string> = {
  match: "ตรงกัน",
  mismatch: "ไม่ตรงกัน",
  not_provided: "ผู้ขอไม่ได้ระบุ",
  no_record: "ผู้พบไม่ได้บันทึก",
};

// Staff-only (app/admin/layout.tsx + RLS). This is the ONLY place where the
// finder's secret details and the claimant's answers are shown side by side.
export default async function AdminClaimReviewPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const me = await requireStaffOrAdmin();
  const supabase = await createClient();

  const { data: claim } = await supabase.from("claims").select("*").eq("id", params.id).maybeSingle();
  if (!claim) notFound();

  const [{ data: item }, { data: claimant }, { data: evidence }, { data: reviews }, { data: history }, { data: siblings }, { data: risks }] =
    await Promise.all([
      supabase.from("found_items").select("*").eq("id", claim.found_item_id).maybeSingle(),
      supabase.from("profiles").select("id, full_name, email, user_type, created_at, is_restricted").eq("id", claim.claimant_id).maybeSingle(),
      supabase.from("claim_evidence").select("id, evidence_url, created_at").eq("claim_id", claim.id).order("created_at"),
      supabase.from("claim_reviews").select("*").eq("claim_id", claim.id).order("created_at", { ascending: false }),
      supabase.from("claims").select("status").eq("claimant_id", claim.claimant_id),
      supabase
        .from("claims")
        .select("id, status")
        .eq("found_item_id", claim.found_item_id)
        .neq("id", claim.id)
        .in("status", ["pending", "needs_review", "likely_owner", "verified", "disputed", "approved"]),
      supabase
        .from("risk_events")
        .select("id, event_type, risk_level, details, created_at")
        .eq("related_user_id", claim.claimant_id)
        .is("resolved_at", null)
        .order("created_at", { ascending: false }),
    ]);
  if (!item) notFound();

  const [{ data: cat }, { data: loc }] = await Promise.all([
    item.category_id ? supabase.from("categories").select("name_th").eq("id", item.category_id).maybeSingle() : Promise.resolve({ data: null }),
    item.location_id ? supabase.from("locations").select("name").eq("id", item.location_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const sign = async (path: string | null) =>
    path ? (await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, PRIVATE_URL_TTL_SECONDS)).data?.signedUrl ?? null : null;
  const privateImg = await sign(item.private_image_url);
  const evidenceLinks = await Promise.all((evidence ?? []).map(async (e) => ({ ...e, url: await sign(e.evidence_url) })));

  const reviewerIds = [...new Set((reviews ?? []).map((r) => r.reviewer_id))];
  const { data: reviewers } = reviewerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", reviewerIds)
    : { data: [] as { id: string; full_name: string }[] };
  const reviewerName = new Map((reviewers ?? []).map((r) => [r.id, r.full_name]));

  const answers = (claim.answers ?? {}) as Record<string, unknown>;
  const hints = buildClaimHints(answers, item);
  const stats = {
    total: history?.length ?? 0,
    rejected: (history ?? []).filter((h) => h.status === "rejected").length,
    insufficient: (history ?? []).filter((h) => h.status === "insufficient").length,
  };
  const isConflict = me.id === claim.claimant_id || me.id === item.finder_id;
  const isClosed = ["approved", "rejected", "cancelled"].includes(claim.status);

  return (
    <div className="space-y-4">
      <Link href="/admin/claims" className="text-sm text-cdti-600 hover:underline">
        ← คำขอรับของทั้งหมด
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-cdti-700">ตรวจสอบคำขอ: {item.general_name}</h1>
        <div className="flex gap-2 text-sm">
          <span className="rounded-full bg-cdti-50 px-3 py-1 text-cdti-700">{STAFF_STATUS[claim.status]}</span>
          {claim.verification_level === "enhanced" && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">enhanced · ของมูลค่าสูง</span>
          )}
        </div>
      </div>

      {(siblings?.length ?? 0) > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">ข้อพิพาท: ของชิ้นนี้มีคำขออื่นอีก {siblings!.length} รายการ</p>
          <p className="mt-0.5 text-xs">
            ระบบระงับการอนุมัติไว้จนกว่าจะเหลือคำขอที่เปิดอยู่เพียงรายการเดียว — ตรวจเทียบทุกคำขอ แล้วบันทึกผล
            &ldquo;ข้อมูลไม่พอ&rdquo; หรือ &ldquo;ปฏิเสธ&rdquo; ให้คำขอที่ไม่ผ่าน ผู้ขอแต่ละคนจะไม่ทราบว่ามีผู้ขอรายอื่น
          </p>
          <ul className="mt-1 flex flex-wrap gap-2 text-xs">
            {siblings!.map((s, i) => (
              <li key={s.id}>
                <Link href={`/admin/claims/${s.id}`} className="underline">
                  คำขออื่น #{i + 1} ({STAFF_STATUS[s.status]})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(risks?.length ?? 0) > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">สัญญาณที่ต้องตรวจสอบของผู้ขอรายนี้ (ไม่ใช่ข้อสรุป)</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {risks!.map((r) => (
              <li key={r.id}>
                <span className={`mr-1 rounded px-1 ${RISK_LEVEL_TH[r.risk_level].className}`}>{RISK_LEVEL_TH[r.risk_level].label}</span>
                {RISK_TYPE_TH[r.event_type].label}
                {describeRiskDetails(r.event_type, r.details ?? {}) && ` · ${describeRiskDetails(r.event_type, r.details ?? {})}`}
              </li>
            ))}
          </ul>
          <Link href="/admin/risk" className="mt-1 inline-block text-xs underline">
            ไปที่หน้าสัญญาณ
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Finder side (private) */}
        <section className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5 text-sm">
          <h2 className="font-semibold text-amber-900">ข้อมูลจากผู้พบ (ลับ)</h2>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-gray-600">จุดสังเกตลับ</dt>
            <dd className="whitespace-pre-wrap break-words font-medium">{item.secret_details || "-"}</dd>
            <dt className="text-gray-600">Serial</dt>
            <dd>{item.serial_number || "-"}</dd>
            <dt className="text-gray-600">ตำแหน่งที่พบ</dt>
            <dd>{item.exact_location || "-"}</dd>
            <dt className="text-gray-600">เวลาที่พบ</dt>
            <dd>{formatThaiDateTime(item.exact_time)}</dd>
            <dt className="text-gray-600">ประเภท / สี</dt>
            <dd>{[cat?.name_th, item.color].filter(Boolean).join(" · ") || "-"}</dd>
            <dt className="text-gray-600">บริเวณ / วันที่</dt>
            <dd>
              {loc?.name ?? "-"} · {formatThaiDate(item.found_date)}
            </dd>
            <dt className="text-gray-600">สถานะ</dt>
            <dd>
              {FOUND_STATUS_TH[item.status]} · {CUSTODY_STATUS_TH[item.custody_status]}
            </dd>
          </dl>
          {privateImg && (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={privateImg} alt="รูปสำหรับตรวจสอบ" className="mt-3 max-h-56 rounded border object-contain" />
          )}
        </section>

        {/* Claimant side */}
        <section className="rounded-lg bg-white p-5 text-sm shadow-sm">
          <h2 className="font-semibold text-cdti-700">คำตอบของผู้ขอ (ครั้งที่ {claim.claim_attempt_count})</h2>
          <dl className="mt-3 space-y-3">
            {labelledAnswers(answers).map((a) => (
              <div key={a.label}>
                <dt className="text-gray-500">{a.label}</dt>
                <dd className="whitespace-pre-wrap break-words">{a.value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-4 text-xs font-semibold text-gray-500">หลักฐาน ({evidenceLinks.length})</h3>
          <ul className="mt-1 space-y-1">
            {evidenceLinks.map((e, i) => (
              <li key={e.id}>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-cdti-600 hover:underline">
                    ไฟล์ {i + 1} ({e.evidence_url.split(".").pop()?.toUpperCase()}) — ลิงก์หมดอายุใน {PRIVATE_URL_TTL_SECONDS} วินาที
                  </a>
                ) : (
                  <span className="text-gray-400">ไฟล์ {i + 1} (เปิดไม่ได้)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg bg-white p-5 text-sm shadow-sm">
          <h2 className="font-semibold text-cdti-700">ตัวช่วยตรวจสอบ</h2>
          <p className="text-xs text-gray-500">เป็นข้อมูลประกอบเท่านั้น ไม่ใช่การตัดสิน — การตัดสินเป็นของเจ้าหน้าที่</p>
          <ul className="mt-2 space-y-1">
            <li>Serial: <strong>{SERIAL_TH[hints.serial]}</strong></li>
            <li>
              คำที่ตรงกับจุดสังเกตลับ: {hints.secretOverlap.length}/{hints.secretWordCount}{" "}
              {hints.secretOverlap.length > 0 && <span className="text-gray-500">({hints.secretOverlap.join(", ")})</span>}
            </li>
            <li>
              คำที่ตรงกับตำแหน่งที่พบ: {hints.locationOverlap.length > 0 ? hints.locationOverlap.join(", ") : "ไม่มี"}
            </li>
          </ul>
          <h3 className="mt-4 text-xs font-semibold text-gray-500">ผู้ขอ</h3>
          <p>
            {claimant?.full_name} · {claimant?.email}
            {claimant?.is_restricted && <span className="ml-1 text-red-600">(ถูกจำกัดสิทธิ์)</span>}
          </p>
          <p className="text-xs text-gray-500">
            สมัครเมื่อ {formatThaiDate(claimant?.created_at?.slice(0, 10) ?? null)} · คำขอทั้งหมด {stats.total} ·
            ปฏิเสธ {stats.rejected} · ข้อมูลไม่พอ {stats.insufficient}
          </p>
          {claim.verification_level === "enhanced" && (
            <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
              ของมูลค่าสูง: ต้องตรวจบัตรประจำตัวตัวจริงของผู้รับในวันส่งมอบ (Phase 8)
            </p>
          )}
        </section>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-cdti-700">บันทึกผล</h2>
          {isClosed ? (
            <p className="text-sm text-gray-500">คำขอนี้ปิดแล้ว</p>
          ) : isConflict ? (
            <p className="text-sm text-red-700">คุณเกี่ยวข้องกับรายการนี้ จึงไม่สามารถตรวจสอบเองได้ กรุณาให้เจ้าหน้าที่คนอื่นตรวจ</p>
          ) : (
            <ReviewForm
              claimId={claim.id}
              status={claim.status}
              level={claim.verification_level}
              hasOtherActive={(siblings ?? []).some((x) => x.status !== "approved")}
            />
          )}
        </section>
      </div>

      <section className="rounded-lg bg-white p-5 text-sm shadow-sm">
        <h2 className="font-semibold text-cdti-700">ประวัติการตรวจสอบ</h2>
        {(reviews ?? []).length === 0 ? (
          <p className="mt-2 text-gray-400">ยังไม่มี</p>
        ) : (
          <ul className="mt-2 divide-y">
            {reviews!.map((r) => (
              <li key={r.id} className="py-2">
                <p>
                  <strong>{STAFF_STATUS[r.from_status]}</strong> → <strong>{STAFF_STATUS[r.outcome]}</strong> · โดย{" "}
                  {reviewerName.get(r.reviewer_id) ?? "-"} · {formatThaiDateTime(r.created_at)}
                </p>
                <p className="text-xs text-gray-500">
                  {CHECKLIST_ITEMS.map((c) => `${c.label}: ${(r.checklist as Record<string, string>)[c.key] ?? "-"}`).join(" · ")}
                </p>
                {r.note && <p className="mt-1 whitespace-pre-wrap text-gray-700">{r.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <InternalNotes entityType="claim" entityId={claim.id} meId={me.id} isAdmin={me.role === "admin"} returnTo={`/admin/claims/${claim.id}`} />
        <section className="rounded-lg bg-white p-5 text-sm shadow-sm">
          <h2 className="font-semibold text-cdti-700">ส่งต่อให้ admin</h2>
          <p className="mb-2 text-xs text-gray-500">ใช้เมื่อเรื่องต้องการการตัดสินใจระดับ admin เช่น ผู้ขอโต้แย้งผล หรือกรณีซับซ้อน</p>
          <EscalateForm entityType="claim" entityId={claim.id} returnTo={`/admin/claims/${claim.id}`} />
        </section>
      </div>
    </div>
  );
}
