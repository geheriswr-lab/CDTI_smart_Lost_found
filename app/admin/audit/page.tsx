import Link from "next/link";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AUDIT_ACTION_TH, AUDIT_GROUPS, ENTITY_TH, summarizeMetadata } from "@/lib/audit/labels";
import { formatThaiDateTime } from "@/lib/reports/labels";

export const metadata = { title: "Audit log — Admin" };

const PAGE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { group?: string; from?: string; to?: string; entity?: string; page?: string };

function href(p: Params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, String(v));
  const s = q.toString();
  return s ? `/admin/audit?${s}` : "/admin/audit";
}

// Read-only view (RLS audit_logs_select_staff). The table itself is
// immutable for everyone — see 0024 (update/delete/truncate triggers).
export default async function AuditPage({ searchParams }: { searchParams: Params }) {
  await requireStaffOrAdmin();
  const group = AUDIT_GROUPS.find((g) => g.key === searchParams.group);
  const from = DATE_RE.test(searchParams.from ?? "") ? searchParams.from! : "";
  const to = DATE_RE.test(searchParams.to ?? "") ? searchParams.to! : "";
  const entity = UUID_RE.test(searchParams.entity ?? "") ? searchParams.entity! : "";
  const page = Math.max(1, Math.min(1000, Number.parseInt(searchParams.page ?? "1", 10) || 1));

  const supabase = await createClient();
  let q = supabase
    .from("audit_logs")
    .select("id, actor_id, action, entity_type, entity_id, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (group) q = q.or(group.prefixes.map((p) => `action.like.${p}*`).join(","));
  if (from) q = q.gte("created_at", `${from}T00:00:00+07:00`);
  if (to) q = q.lte("created_at", `${to}T23:59:59.999+07:00`);
  if (entity) q = q.or(`entity_id.eq.${entity},actor_id.eq.${entity}`);
  const { data: rows, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);

  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id).filter((x): x is string => !!x))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", actorIds)
    : { data: [] as { id: string; full_name: string; role: string }[] };
  const actor = new Map((actors ?? []).map((a) => [a.id, a]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const base: Params = { group: group?.key, from, to, entity };

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-cdti-600 hover:underline">
        ← Admin
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">Audit log</h1>
        <p className="mt-1 text-sm text-gray-600">
          บันทึกเหตุการณ์สำคัญทั้งหมด — อ่านได้อย่างเดียว ไม่มีใครแก้ไขหรือลบได้ (รวมถึง admin)
          · ไม่มีข้อมูลลับ คำตอบ หรือรหัสในบันทึก
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 text-sm shadow-sm">
        <label>
          <span className="block text-xs text-gray-500">หมวด</span>
          <select name="group" defaultValue={group?.key ?? ""} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5">
            <option value="">ทั้งหมด</option>
            {AUDIT_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-gray-500">ตั้งแต่</span>
          <input type="date" name="from" defaultValue={from} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5" />
        </label>
        <label>
          <span className="block text-xs text-gray-500">ถึง</span>
          <input type="date" name="to" defaultValue={to} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="min-w-[18rem] flex-1">
          <span className="block text-xs text-gray-500">รหัสรายการหรือผู้ใช้ (UUID)</span>
          <input name="entity" defaultValue={entity} placeholder="เช่น id ของคำขอ" className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs" />
        </label>
        <button type="submit" className="rounded-md bg-cdti-600 px-4 py-1.5 text-white hover:bg-cdti-700">
          กรอง
        </button>
        <Link href="/admin/audit" className="px-2 py-1.5 text-gray-500">
          ล้าง
        </Link>
      </form>

      <p className="text-xs text-gray-500">{(count ?? 0).toLocaleString("th-TH")} รายการ</p>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">เวลา</th>
              <th className="px-4 py-2">เหตุการณ์</th>
              <th className="px-4 py-2">ผู้กระทำ</th>
              <th className="px-4 py-2">รายการ</th>
              <th className="px-4 py-2">รายละเอียด</th>
            </tr>
          </thead>
          <tbody className="divide-y align-top">
            {(rows ?? []).map((r) => {
              const a = r.actor_id ? actor.get(r.actor_id) : null;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">{formatThaiDateTime(r.created_at)}</td>
                  <td className="px-4 py-2">
                    <p>{AUDIT_ACTION_TH[r.action] ?? r.action}</p>
                    <p className="font-mono text-[10px] text-gray-400">{r.action}</p>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {a ? (
                      <Link href={href({ entity: a.id })} className="hover:underline">
                        {a.full_name} <span className="text-gray-400">({a.role})</span>
                      </Link>
                    ) : (
                      <span className="text-gray-400">ระบบ</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {ENTITY_TH[r.entity_type] ?? r.entity_type}
                    {r.entity_id && (
                      <>
                        {" "}
                        {r.entity_type === "claim" ? (
                          <Link href={`/admin/claims/${r.entity_id}`} className="font-mono text-[10px] text-cdti-600 hover:underline">
                            {r.entity_id.slice(0, 8)}
                          </Link>
                        ) : (
                          <Link href={href({ entity: r.entity_id })} className="font-mono text-[10px] text-gray-500 hover:underline">
                            {r.entity_id.slice(0, 8)}
                          </Link>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">{summarizeMetadata(r.metadata)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && <Link href={href({ ...base, page: String(page - 1) })} className="rounded-md border bg-white px-3 py-1.5">← ก่อนหน้า</Link>}
          <span className="text-gray-500">หน้า {page} / {pages}</span>
          {page < pages && <Link href={href({ ...base, page: String(page + 1) })} className="rounded-md border bg-white px-3 py-1.5">ถัดไป →</Link>}
        </nav>
      )}
    </div>
  );
}
