import Link from "next/link";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatThaiDateTime } from "@/lib/reports/labels";
import { ResolveEscalationForm } from "./resolve-form";

export const metadata = { title: "เรื่องส่งต่อ — Admin" };

const TYPE_TH = { claim: "คำขอรับของ", risk_event: "สัญญาณ", found_item: "รายการพบของ" } as const;

function entityHref(type: keyof typeof TYPE_TH, id: string) {
  if (type === "claim") return `/admin/claims/${id}`;
  if (type === "risk_event") return "/admin/risk";
  return "/admin/custody";
}

export default async function EscalationsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const me = await requireStaffOrAdmin();
  const isAdmin = me.role === "admin";
  const closed = searchParams.tab === "resolved";
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("case_escalations")
    .select("*")
    .eq("status", closed ? "resolved" : "open")
    .order("created_at", { ascending: !closed })
    .limit(200);
  const ids = [...new Set((rows ?? []).flatMap((r) => [r.escalated_by, r.resolved_by]).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] as { id: string; full_name: string }[] };
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">เรื่องส่งต่อให้ admin</h1>
        <p className="text-sm text-gray-600">เจ้าหน้าที่ส่งต่อเรื่องที่ต้องการการตัดสินใจระดับ admin · ปิดเรื่องได้เฉพาะ admin</p>
      </div>
      <nav className="flex gap-2 text-sm">
        <Link href="/admin/escalations" className={`rounded-full px-3 py-1 ${!closed ? "bg-cdti-600 text-white" : "bg-white"}`}>
          เปิดอยู่
        </Link>
        <Link href="/admin/escalations?tab=resolved" className={`rounded-full px-3 py-1 ${closed ? "bg-cdti-600 text-white" : "bg-white"}`}>
          ปิดแล้ว
        </Link>
      </nav>
      {(rows ?? []).length === 0 ? (
        <p className="rounded-lg bg-white p-8 text-center text-sm text-gray-500 shadow-sm">ไม่มีรายการ</p>
      ) : (
        <ul className="space-y-3">
          {rows!.map((r) => (
            <li key={r.id} className="rounded-lg bg-white p-4 text-sm shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={entityHref(r.entity_type, r.entity_id)} className="font-medium text-cdti-700 hover:underline">
                  {TYPE_TH[r.entity_type]} {r.entity_id.slice(0, 8)}
                </Link>
                <span className="text-xs text-gray-500">
                  ส่งโดย {name.get(r.escalated_by) ?? "-"} · {formatThaiDateTime(r.created_at)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-gray-700">{r.reason}</p>
              {closed ? (
                <p className="mt-2 text-xs text-gray-500">
                  ปิดโดย {name.get(r.resolved_by ?? "") ?? "-"} · {formatThaiDateTime(r.resolved_at)}
                  {r.resolution_note && ` — ${r.resolution_note}`}
                </p>
              ) : isAdmin ? (
                <div className="mt-2">
                  <ResolveEscalationForm id={r.id} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
