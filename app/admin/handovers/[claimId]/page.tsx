import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CUSTODY_STATUS_TH, formatThaiDateTime } from "@/lib/reports/labels";
import { ID_DOCUMENT_TH } from "@/lib/handover/labels";
import { STAFF_STATUS } from "@/lib/claims/labels";
import { CustodyTimeline } from "@/components/handover/custody-timeline";
import { HandoverForm } from "./handover-form";

export const metadata = { title: "ส่งมอบของ — Admin" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HandoverDetailPage({ params }: { params: { claimId: string } }) {
  if (!UUID_RE.test(params.claimId)) notFound();
  const me = await requireStaffOrAdmin();
  const supabase = await createClient();

  const { data: claim } = await supabase
    .from("claims")
    .select("id, claimant_id, found_item_id, status, verification_level, reviewed_by, reviewed_at")
    .eq("id", params.claimId)
    .maybeSingle();
  if (!claim) notFound();

  const [{ data: item }, { data: handover }, { data: custody }, { data: locations }, { data: others }] = await Promise.all([
    supabase.from("found_items").select("id, finder_id, general_name, custody_status, status").eq("id", claim.found_item_id).maybeSingle(),
    supabase.from("handovers").select("*").eq("claim_id", claim.id).maybeSingle(),
    supabase.from("custody_history").select("id, from_status, to_status, created_at, location_id, handled_by, notes").eq("found_item_id", claim.found_item_id).order("created_at"),
    supabase.from("handover_locations").select("id, name").eq("is_active", true).order("name"),
    supabase.from("claims").select("id").eq("found_item_id", claim.found_item_id).neq("id", claim.id)
      .in("status", ["pending", "needs_review", "likely_owner", "verified", "disputed"]),
  ]);
  if (!item) notFound();

  const peopleIds = [
    item.finder_id, claim.claimant_id, claim.reviewed_by, handover?.handed_over_by, handover?.received_by,
    ...(custody ?? []).map((c) => c.handled_by),
  ].filter((x): x is string => !!x);
  const allLocIds = [...new Set([...(custody ?? []).map((c) => c.location_id), handover?.location_id].filter((x): x is string => !!x))];
  const [{ data: people }, { data: allLocs }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", [...new Set(peopleIds)]),
    allLocIds.length ? supabase.from("handover_locations").select("id, name").in("id", allLocIds) : Promise.resolve({ data: [] }),
  ]);
  const name = (id: string | null | undefined) => (id ? (people ?? []).find((p) => p.id === id)?.full_name ?? "-" : "-");
  const locName = new Map((allLocs ?? []).map((l) => [l.id, l.name]));
  const lastCustody = (custody ?? []).at(-1);
  const currentHolder =
    item.custody_status === "with_finder"
      ? name(item.finder_id) + " (ผู้พบ)"
      : item.custody_status === "released_to_owner"
        ? name(handover?.received_by) + " (เจ้าของ)"
        : `เจ้าหน้าที่ · ${lastCustody?.location_id ? locName.get(lastCustody.location_id) ?? "-" : "-"}`;

  const ready = item.custody_status === "transferred_to_staff" || item.custody_status === "in_storage";
  const conflict = me.id === claim.claimant_id || me.id === item.finder_id;
  const disputed = (others ?? []).length > 0;

  // README Phase 8: keep every role separate and visible.
  const roles: [string, string][] = [
    ["ผู้แจ้งพบของ", name(item.finder_id)],
    ["ผู้ครอบครองปัจจุบัน", currentHolder],
    ["เจ้าหน้าที่ที่รับของเข้า", name((custody ?? []).find((c) => c.to_status !== "with_finder")?.handled_by)],
    ["ผู้ขอรับ (claimant)", name(claim.claimant_id)],
    ["ผู้ตรวจสอบ/อนุมัติ", `${name(claim.reviewed_by)}${claim.reviewed_at ? ` · ${formatThaiDateTime(claim.reviewed_at)}` : ""}`],
    ["ผู้ส่งมอบ", handover ? name(handover.handed_over_by) : "—"],
    ["ผู้รับของจริง", handover ? name(handover.received_by) : "—"],
  ];

  return (
    <div className="space-y-4">
      <Link href="/admin/handovers" className="text-sm text-cdti-600 hover:underline">
        ← ส่งมอบของ
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-cdti-700">ส่งมอบ: {item.general_name}</h1>
        <div className="flex gap-2 text-sm">
          <span className="rounded-full bg-cdti-50 px-3 py-1 text-cdti-700">{STAFF_STATUS[claim.status]}</span>
          {claim.verification_level === "enhanced" && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">ต้องตรวจบัตร</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-cdti-700">บทบาทที่เกี่ยวข้อง</h2>
          <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
            {roles.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-gray-500">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h2 className="mt-5 text-sm font-semibold text-cdti-700">ประวัติการครอบครอง</h2>
          <div className="mt-3">
            <CustodyTimeline
              showPeople
              rows={(custody ?? []).map((c) => ({
                ...c,
                location_name: c.location_id ? locName.get(c.location_id) : null,
                handler_name: name(c.handled_by),
              }))}
            />
          </div>
        </section>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-cdti-700">ยืนยันการส่งมอบ</h2>
          {handover ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-gray-500">ส่งมอบเมื่อ</dt>
              <dd>{formatThaiDateTime(handover.created_at)}</dd>
              <dt className="text-gray-500">จุดส่งมอบ</dt>
              <dd>{locName.get(handover.location_id) ?? "-"}</dd>
              <dt className="text-gray-500">ตรวจบัตร</dt>
              <dd>{handover.id_checked ? `ตรวจแล้ว (${handover.id_document_type ? ID_DOCUMENT_TH[handover.id_document_type] : "-"})` : "ไม่ได้ตรวจ"}</dd>
              {handover.note && (
                <>
                  <dt className="text-gray-500">บันทึก</dt>
                  <dd className="whitespace-pre-wrap">{handover.note}</dd>
                </>
              )}
            </dl>
          ) : claim.status !== "approved" ? (
            <p className="text-sm text-gray-500">คำขอยังไม่ได้รับอนุมัติ</p>
          ) : disputed ? (
            <p className="text-sm text-red-700">มีคำขออื่นที่ยังเปิดอยู่ (ข้อพิพาท) — ระงับการส่งมอบ</p>
          ) : !ready ? (
            <p className="text-sm text-gray-600">
              ของยังไม่อยู่กับเจ้าหน้าที่ ({CUSTODY_STATUS_TH[item.custody_status]}) —{" "}
              <Link href="/admin/custody" className="text-cdti-600 underline">
                บันทึกการรับของเข้าก่อน
              </Link>
            </p>
          ) : conflict ? (
            <p className="text-sm text-red-700">คุณเป็นผู้พบหรือผู้ขอของรายการนี้ ให้เจ้าหน้าที่คนอื่นส่งมอบ</p>
          ) : (
            <HandoverForm
              claimId={claim.id}
              enhanced={claim.verification_level === "enhanced"}
              locations={locations ?? []}
              defaultLocation={lastCustody?.location_id && (locations ?? []).some((l) => l.id === lastCustody.location_id) ? lastCustody.location_id : null}
            />
          )}
        </section>
      </div>
    </div>
  );
}
