import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { STAFF_STATUS } from "@/lib/claims/labels";
import { formatThaiDateTime } from "@/lib/reports/labels";
import type { ClaimStatus } from "@/types/database.types";

export const metadata = { title: "คำขอรับของ — Admin" };

const TABS: { key: string; label: string; statuses: ClaimStatus[] }[] = [
  { key: "open", label: "รอตรวจสอบ", statuses: ["pending", "needs_review", "likely_owner", "verified", "disputed"] },
  { key: "disputed", label: "ข้อพิพาท", statuses: ["disputed"] },
  { key: "waiting", label: "รอผู้ขอส่งข้อมูล", statuses: ["insufficient"] },
  { key: "closed", label: "ปิดแล้ว", statuses: ["approved", "rejected", "cancelled"] },
];

// Guarded by app/admin/layout.tsx (requireStaffOrAdmin) + RLS claims_select_staff.
export default async function AdminClaimsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = TABS.find((t) => t.key === searchParams.tab) ?? TABS[0];
  const ACTIVE = TABS[0].statuses;
  const supabase = await createClient();

  const { data: claims } = await supabase
    .from("claims")
    .select("id, claimant_id, found_item_id, status, verification_level, claim_attempt_count, created_at, updated_at")
    .in("status", tab.statuses)
    .order("created_at", { ascending: true })
    .limit(200);

  const itemIds = [...new Set((claims ?? []).map((c) => c.found_item_id))];
  const userIds = [...new Set((claims ?? []).map((c) => c.claimant_id))];
  const [{ data: items }, { data: people }, { data: allOpen }] = await Promise.all([
    itemIds.length ? supabase.from("found_items").select("id, general_name").in("id", itemIds) : Promise.resolve({ data: [] }),
    userIds.length ? supabase.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
    // Items with more than one open claim -> flag for dispute handling (Phase 7)
    itemIds.length
      ? supabase.from("claims").select("found_item_id").in("found_item_id", itemIds).in("status", ACTIVE)
      : Promise.resolve({ data: [] }),
  ]);
  const itemName = new Map((items ?? []).map((i) => [i.id, i.general_name]));
  const personName = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const openPerItem = new Map<string, number>();
  for (const c of allOpen ?? []) openPerItem.set(c.found_item_id, (openPerItem.get(c.found_item_id) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-cdti-600 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-bold text-cdti-700">คำขอรับของ</h1>

      <nav className="flex gap-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/claims?tab=${t.key}`}
            className={`rounded-full px-3 py-1 ${t.key === tab.key ? "bg-cdti-600 text-white" : "bg-white text-gray-700 hover:bg-cdti-50"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {!claims || claims.length === 0 ? (
        <p className="rounded-lg bg-white p-8 text-center text-sm text-gray-500 shadow-sm">ไม่มีรายการ</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">สิ่งของ</th>
                <th className="px-4 py-2">ผู้ขอ</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2">ระดับ</th>
                <th className="px-4 py-2">ครั้งที่</th>
                <th className="px-4 py-2">ส่งเมื่อ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {claims.map((c) => (
                <tr key={c.id} className="hover:bg-cdti-50/40">
                  <td className="px-4 py-2">
                    <Link href={`/admin/claims/${c.id}`} className="font-medium text-cdti-700 hover:underline">
                      {itemName.get(c.found_item_id) ?? "-"}
                    </Link>
                    {(openPerItem.get(c.found_item_id) ?? 0) > 1 && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                        มีผู้ขอ {openPerItem.get(c.found_item_id)} คน
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{personName.get(c.claimant_id) ?? "-"}</td>
                  <td className="px-4 py-2">{STAFF_STATUS[c.status]}</td>
                  <td className="px-4 py-2">
                    {c.verification_level === "enhanced" ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">enhanced</span>
                    ) : (
                      <span className="text-xs text-gray-500">standard</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{c.claim_attempt_count}/3</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{formatThaiDateTime(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
