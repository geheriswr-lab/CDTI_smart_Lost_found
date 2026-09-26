import Link from "next/link";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { RISK_LEVEL_TH, RISK_TYPE_TH } from "@/lib/risk/labels";
import { STAFF_STATUS } from "@/lib/claims/labels";
import { formatThaiDateTime } from "@/lib/reports/labels";
import type { ClaimStatus } from "@/types/database.types";

const OPEN: ClaimStatus[] = ["pending", "needs_review", "likely_owner", "verified", "disputed"];

type Row = { key: string; href: string; title: string; sub?: string };

function Panel({
  title,
  explain,
  count,
  rows,
  moreHref,
  tone = "neutral",
}: {
  title: string;
  explain: string;
  count: number;
  rows: Row[];
  moreHref?: string;
  tone?: "neutral" | "warn" | "alert";
}) {
  const badge = count === 0 ? "bg-gray-100 text-gray-500" : tone === "alert" ? "bg-red-100 text-red-800" : tone === "warn" ? "bg-amber-100 text-amber-800" : "bg-cdti-50 text-cdti-700";
  return (
    <section className="flex flex-col rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500">{explain}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${badge}`}>{count}</span>
      </div>
      {rows.length > 0 && (
        <ul className="mt-3 divide-y text-sm">
          {rows.slice(0, 5).map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="block py-1.5 hover:text-cdti-700">
                <span className="line-clamp-1">{r.title}</span>
                {r.sub && <span className="block text-xs text-gray-500">{r.sub}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {moreHref && count > 0 && (
        <Link href={moreHref} className="mt-auto pt-2 text-xs text-cdti-600 hover:underline">
          ดูทั้งหมด →
        </Link>
      )}
    </section>
  );
}

// "รายการต้องตรวจสอบ" (README Phase 10). Staff-only via app/admin/layout.tsx + RLS.
export default async function AdminHomePage() {
  const me = await requireStaffOrAdmin();
  const supabase = await createClient();
  const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();

  const [
    { data: openClaims },
    { data: openRisks },
    { data: suspicious },
    { data: anomalies },
    { data: escalations },
    { data: approved },
    { data: done },
  ] = await Promise.all([
    supabase.from("claims").select("id, claimant_id, found_item_id, status, verification_level, created_at").in("status", OPEN).order("created_at"),
    supabase.from("risk_events").select("id, event_type, risk_level, related_user_id, related_claim_id, created_at").is("resolved_at", null).order("created_at", { ascending: false }),
    supabase.from("risk_events").select("id, event_type, related_user_id, resolved_at").eq("resolution", "suspicious_activity").gte("resolved_at", since30),
    supabase.rpc("admin_custody_anomalies"),
    supabase.from("case_escalations").select("id, entity_type, entity_id, created_at").eq("status", "open").order("created_at"),
    supabase.from("claims").select("id").eq("status", "approved"),
    supabase.from("handovers").select("claim_id"),
  ]);

  const itemIds = [...new Set([...(openClaims ?? []).map((c) => c.found_item_id), ...(anomalies ?? []).map((a) => a.found_item_id)])];
  const userIds = [...new Set([...(openClaims ?? []).map((c) => c.claimant_id), ...(openRisks ?? []).map((r) => r.related_user_id), ...(suspicious ?? []).map((r) => r.related_user_id)].filter((x): x is string => !!x))];
  const [{ data: items }, { data: people }] = await Promise.all([
    itemIds.length ? supabase.from("found_items").select("id, general_name").in("id", itemIds) : Promise.resolve({ data: [] }),
    userIds.length ? supabase.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const itemName = new Map((items ?? []).map((i) => [i.id, i.general_name]));
  const person = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  // Risky users = open medium/high signals
  const riskyUsers = new Map<string, string>();
  for (const r of openRisks ?? []) {
    if (r.related_user_id && r.risk_level !== "low" && !riskyUsers.has(r.related_user_id)) {
      riskyUsers.set(r.related_user_id, `${RISK_LEVEL_TH[r.risk_level].label} · ${RISK_TYPE_TH[r.event_type].label}`);
    }
  }

  const claimRow = (c: NonNullable<typeof openClaims>[number], sub?: string): Row => ({
    key: c.id,
    href: `/admin/claims/${c.id}`,
    title: `${itemName.get(c.found_item_id) ?? "-"} — ${person.get(c.claimant_id) ?? "-"}`,
    sub: sub ?? `${STAFF_STATUS[c.status]} · ${formatThaiDateTime(c.created_at)}`,
  });

  const disputedItems = new Map<string, NonNullable<typeof openClaims>[number]>();
  for (const c of openClaims ?? []) if (c.status === "disputed" && !disputedItems.has(c.found_item_id)) disputedItems.set(c.found_item_id, c);
  const highRisk = (openClaims ?? []).filter((c) => riskyUsers.has(c.claimant_id));
  const highValue = (openClaims ?? []).filter((c) => c.verification_level === "enhanced");
  const repeated = (openRisks ?? []).filter((r) => r.event_type === "repeated_rejections");
  const doneSet = new Set((done ?? []).map((d) => d.claim_id));
  const pendingHandover = (approved ?? []).filter((c) => !doneSet.has(c.id)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cdti-700">รายการต้องตรวจสอบ</h1>
          <p className="text-sm text-gray-600">สวัสดีคุณ {me.full_name} — สัญญาณทั้งหมดเป็นข้อมูลให้เจ้าหน้าที่พิจารณา ไม่ใช่ข้อสรุป</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/claims" className="rounded-md bg-white px-3 py-1.5 shadow-sm hover:bg-cdti-50">
            คำขอรอตรวจ <strong>{(openClaims ?? []).length}</strong>
          </Link>
          <Link href="/admin/handovers" className="rounded-md bg-white px-3 py-1.5 shadow-sm hover:bg-cdti-50">
            รอส่งมอบ <strong>{pendingHandover}</strong>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Panel
          title="ข้อพิพาท"
          explain="ของที่มีผู้ขอมากกว่า 1 คน — ระงับการอนุมัติ"
          count={disputedItems.size}
          tone="alert"
          moreHref="/admin/claims?tab=disputed"
          rows={[...disputedItems.values()].map((c) => claimRow(c, "มีผู้ขอหลายคน"))}
        />
        <Panel
          title="คำขอจากผู้ที่มีสัญญาณเสี่ยง"
          explain="คำขอที่เปิดอยู่ของผู้ใช้ที่มีสัญญาณระดับปานกลาง/สูง"
          count={highRisk.length}
          tone="warn"
          moreHref="/admin/risk"
          rows={highRisk.map((c) => claimRow(c, riskyUsers.get(c.claimant_id)))}
        />
        <Panel
          title="ของมูลค่าสูง"
          explain="คำขอ enhanced ที่ยังเปิดอยู่ — ต้องยืนยันก่อนอนุมัติ และตรวจบัตรตอนส่งมอบ"
          count={highValue.length}
          moreHref="/admin/claims"
          rows={highValue.map((c) => claimRow(c))}
        />
        <Panel
          title="คำขอไม่ผ่านซ้ำหลายครั้ง"
          explain="ผู้ใช้ที่ได้ผล 'ข้อมูลไม่พอ/ปฏิเสธ' ตั้งแต่ 3 ครั้งใน 30 วัน"
          count={repeated.length}
          tone="warn"
          moreHref="/admin/risk"
          rows={repeated.map((r) => ({ key: r.id, href: "/admin/risk", title: person.get(r.related_user_id ?? "") ?? "-", sub: formatThaiDateTime(r.created_at) }))}
        />
        <Panel
          title="พฤติกรรมที่ต้องเฝ้าระวัง"
          explain="บันทึกเป็น Suspicious Activity ใน 30 วันที่ผ่านมา"
          count={(suspicious ?? []).length}
          tone="warn"
          moreHref="/admin/risk?tab=closed"
          rows={(suspicious ?? []).map((r) => ({ key: r.id, href: "/admin/risk?tab=closed", title: person.get(r.related_user_id ?? "") ?? "-", sub: RISK_TYPE_TH[r.event_type].label }))}
        />
        <Panel
          title="ความผิดปกติของการครอบครอง"
          explain="ของค้างกับผู้พบ, ส่งต่อยังไม่ยืนยัน, อนุมัติแต่ไม่มารับ, กรอกรหัสผิดหลายครั้ง"
          count={(anomalies ?? []).length}
          tone="warn"
          moreHref="/admin/custody"
          rows={(anomalies ?? []).map((a) => ({
            key: `${a.kind}-${a.found_item_id}-${a.claim_id ?? ""}`,
            href: a.claim_id ? `/admin/handovers/${a.claim_id}` : "/admin/custody",
            title: itemName.get(a.found_item_id) ?? "-",
            sub: `${a.detail} · ตั้งแต่ ${formatThaiDateTime(a.since)}`,
          }))}
        />
        <Panel
          title="เรื่องส่งต่อให้ admin"
          explain="เจ้าหน้าที่ส่งต่อเพื่อให้ admin พิจารณา"
          count={(escalations ?? []).length}
          tone="alert"
          moreHref="/admin/escalations"
          rows={(escalations ?? []).map((e) => ({ key: e.id, href: "/admin/escalations", title: `${e.entity_type} ${e.entity_id.slice(0, 8)}`, sub: formatThaiDateTime(e.created_at) }))}
        />
        <Panel
          title="สัญญาณที่ยังเปิดอยู่ทั้งหมด"
          explain="ทุกระดับ — ตรวจและบันทึกผลที่หน้าสัญญาณ"
          count={(openRisks ?? []).length}
          moreHref="/admin/risk"
          rows={[]}
        />
      </div>
    </div>
  );
}
