import Link from "next/link";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { RISK_LEVEL_TH, RISK_RESOLUTION_TH, RISK_TYPE_TH, describeRiskDetails } from "@/lib/risk/labels";
import { formatThaiDateTime } from "@/lib/reports/labels";
import type { RiskLevel } from "@/types/database.types";
import { ResolveRiskForm, RestrictionForm } from "./risk-forms";

export const metadata = { title: "สัญญาณที่ต้องตรวจสอบ — Admin" };

const LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

// Staff-only (admin layout + RLS risk_events_select_staff). Signals are
// prompts for human review — never a verdict.
export default async function AdminRiskPage({ searchParams }: { searchParams: { tab?: string } }) {
  const me = await requireStaffOrAdmin();
  const isAdmin = me.role === "admin";
  const showClosed = searchParams.tab === "closed";
  const supabase = await createClient();

  let q = supabase.from("risk_events").select("*").order("created_at", { ascending: false }).limit(200);
  q = showClosed ? q.not("resolved_at", "is", null) : q.is("resolved_at", null);
  const { data: events } = await q;

  const userIds = [...new Set((events ?? []).map((e) => e.related_user_id).filter((x): x is string => !!x))];
  const { data: people } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email, is_restricted, created_at").in("id", userIds)
    : { data: [] as { id: string; full_name: string; email: string; is_restricted: boolean; created_at: string }[] };
  const person = new Map((people ?? []).map((p) => [p.id, p]));

  // Per-user summary of OPEN signals, highest level first
  const summary = new Map<string, { count: number; max: RiskLevel }>();
  if (!showClosed) {
    for (const e of events ?? []) {
      if (!e.related_user_id) continue;
      const s = summary.get(e.related_user_id) ?? { count: 0, max: "low" as RiskLevel };
      s.count++;
      if (LEVEL_ORDER[e.risk_level] > LEVEL_ORDER[s.max]) s.max = e.risk_level;
      summary.set(e.related_user_id, s);
    }
  }
  const users = [...summary.entries()].sort((a, b) => LEVEL_ORDER[b[1].max] - LEVEL_ORDER[a[1].max] || b[1].count - a[1].count);

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-cdti-600 hover:underline">
        ← Admin
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">สัญญาณที่ต้องตรวจสอบ</h1>
        <p className="mt-1 text-sm text-gray-600">
          ระบบตรวจพบพฤติกรรมที่ควรให้เจ้าหน้าที่ดูเพิ่ม — <strong>ไม่ใช่ข้อสรุปว่าผู้ใช้ทำผิด</strong>{" "}
          กรุณาตรวจสอบบริบทก่อนตัดสินใจ และใช้ถ้อยคำที่เป็นกลางในบันทึก
        </p>
      </div>

      <nav className="flex gap-2 text-sm">
        <Link href="/admin/risk" className={`rounded-full px-3 py-1 ${!showClosed ? "bg-cdti-600 text-white" : "bg-white text-gray-700 hover:bg-cdti-50"}`}>
          ยังเปิดอยู่
        </Link>
        <Link href="/admin/risk?tab=closed" className={`rounded-full px-3 py-1 ${showClosed ? "bg-cdti-600 text-white" : "bg-white text-gray-700 hover:bg-cdti-50"}`}>
          ปิดแล้ว
        </Link>
      </nav>

      {!showClosed && users.length > 0 && (
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-cdti-700">ผู้ใช้ที่มีสัญญาณเปิดอยู่</h2>
          <ul className="mt-2 divide-y text-sm">
            {users.map(([uid, s]) => {
              const p = person.get(uid);
              return (
                <li key={uid} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{p?.full_name ?? "-"}</span>
                    <span className="ml-2 text-xs text-gray-500">{p?.email}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${RISK_LEVEL_TH[s.max].className}`}>
                      {s.count} สัญญาณ · สูงสุด {RISK_LEVEL_TH[s.max].label}
                    </span>
                    {p?.is_restricted && <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-white">ถูกจำกัดสิทธิ์</span>}
                  </span>
                  {isAdmin && uid !== me.id && <RestrictionForm userId={uid} restricted={!!p?.is_restricted} />}
                </li>
              );
            })}
          </ul>
          {!isAdmin && <p className="mt-2 text-xs text-gray-500">การจำกัดสิทธิ์บัญชีทำได้เฉพาะ admin</p>}
        </section>
      )}

      {!events || events.length === 0 ? (
        <p className="rounded-lg bg-white p-8 text-center text-sm text-gray-500 shadow-sm">ไม่มีรายการ</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">สัญญาณ</th>
                <th className="px-4 py-2">ระดับ</th>
                <th className="px-4 py-2">ผู้ใช้</th>
                <th className="px-4 py-2">เมื่อ</th>
                <th className="px-4 py-2">{showClosed ? "ผล" : "ดำเนินการ"}</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{RISK_TYPE_TH[e.event_type].label}</p>
                    <p className="text-xs text-gray-500">
                      {RISK_TYPE_TH[e.event_type].explain}
                      {describeRiskDetails(e.event_type, e.details ?? {}) && ` · ${describeRiskDetails(e.event_type, e.details ?? {})}`}
                    </p>
                    {e.related_claim_id && (
                      <Link href={`/admin/claims/${e.related_claim_id}`} className="text-xs text-cdti-600 hover:underline">
                        ดูคำขอที่เกี่ยวข้อง
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${RISK_LEVEL_TH[e.risk_level].className}`}>
                      {RISK_LEVEL_TH[e.risk_level].label}
                    </span>
                  </td>
                  <td className="px-4 py-2">{(e.related_user_id && person.get(e.related_user_id)?.full_name) ?? "-"}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{formatThaiDateTime(e.created_at)}</td>
                  <td className="px-4 py-2">
                    {showClosed ? (
                      <div className="text-xs">
                        <p>{e.resolution ? RISK_RESOLUTION_TH[e.resolution] : "-"}</p>
                        {e.resolution_note && <p className="text-gray-500">{e.resolution_note}</p>}
                      </div>
                    ) : e.related_user_id === me.id ? (
                      <span className="text-xs text-gray-400">เกี่ยวกับบัญชีของคุณ — ให้เจ้าหน้าที่คนอื่นตรวจ</span>
                    ) : (
                      <>
                        {e.resolution === "needs_review" && (
                          <p className="mb-1 text-xs text-gray-500">สถานะ: {RISK_RESOLUTION_TH.needs_review}</p>
                        )}
                        <ResolveRiskForm eventId={e.id} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
