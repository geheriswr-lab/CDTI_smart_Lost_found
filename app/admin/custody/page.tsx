import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CUSTODY_STATUS_TH, FOUND_STATUS_TH, formatThaiDate } from "@/lib/reports/labels";
import { CustodyForm } from "./custody-form";

export const metadata = { title: "การครอบครองของ — Admin" };

// Staff-only (admin layout + found_items_select_staff). Items not yet returned.
export default async function AdminCustodyPage() {
  const supabase = await createClient();
  const [{ data: items }, { data: locations }] = await Promise.all([
    supabase
      .from("found_items")
      .select("id, finder_id, general_name, found_date, status, custody_status, created_at")
      .neq("custody_status", "released_to_owner")
      .in("status", ["reported", "in_custody", "matched", "claim_pending", "verified"])
      .order("created_at", { ascending: true })
      .limit(300),
    supabase.from("handover_locations").select("id, name").eq("is_active", true).order("name"),
  ]);

  const ids = (items ?? []).map((i) => i.id);
  const finderIds = [...new Set((items ?? []).map((i) => i.finder_id))];
  const [{ data: finders }, { data: history }, { data: approved }] = await Promise.all([
    finderIds.length ? supabase.from("profiles").select("id, full_name").in("id", finderIds) : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("custody_history").select("found_item_id, location_id, created_at").in("found_item_id", ids).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("claims").select("found_item_id").in("found_item_id", ids).eq("status", "approved") : Promise.resolve({ data: [] }),
  ]);
  const finderName = new Map((finders ?? []).map((f) => [f.id, f.full_name]));
  const locName = new Map((locations ?? []).map((l) => [l.id, l.name]));
  const lastLoc = new Map<string, string>();
  for (const h of history ?? []) if (h.location_id && !lastLoc.has(h.found_item_id)) lastLoc.set(h.found_item_id, h.location_id);
  const approvedSet = new Set((approved ?? []).map((a) => a.found_item_id));

  const withFinder = (items ?? []).filter((i) => i.custody_status === "with_finder" || i.custody_status === "transferred_to_staff");
  const inStorage = (items ?? []).filter((i) => i.custody_status === "in_storage");

  const Table = ({ rows }: { rows: typeof withFinder }) => (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2">สิ่งของ</th>
            <th className="px-4 py-2">ผู้พบ</th>
            <th className="px-4 py-2">การครอบครอง</th>
            <th className="px-4 py-2">บันทึกการรับ/ย้าย</th>
          </tr>
        </thead>
        <tbody className="divide-y align-top">
          {rows.map((i) => (
            <tr key={i.id}>
              <td className="px-4 py-2">
                <p className="font-medium">{i.general_name}</p>
                <p className="text-xs text-gray-500">
                  พบ {formatThaiDate(i.found_date)} · {FOUND_STATUS_TH[i.status]}
                  {approvedSet.has(i.id) && <span className="ml-1 rounded bg-green-100 px-1 text-green-800">มีผู้ได้รับอนุมัติรอรับ</span>}
                </p>
              </td>
              <td className="px-4 py-2 text-xs">{finderName.get(i.finder_id) ?? "-"}</td>
              <td className="px-4 py-2 text-xs">
                {CUSTODY_STATUS_TH[i.custody_status]}
                {lastLoc.get(i.id) && <span className="block text-gray-500">{locName.get(lastLoc.get(i.id)!) ?? "จุดที่ปิดใช้แล้ว"}</span>}
              </td>
              <td className="px-4 py-2">
                <CustodyForm foundItemId={i.id} current={i.custody_status} locations={locations ?? []} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-cdti-600 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-bold text-cdti-700">การครอบครองของ</h1>
      <p className="text-sm text-gray-600">
        บันทึกทุกครั้งที่รับของจากผู้พบหรือย้ายจุดเก็บ ระบบเก็บว่าใครรับ ที่ไหน เมื่อไหร่ (แก้ไขย้อนหลังไม่ได้)
      </p>

      <h2 className="pt-2 font-semibold text-cdti-700">ยังไม่เข้าจุดรับของกลาง ({withFinder.length})</h2>
      {withFinder.length ? <Table rows={withFinder} /> : <p className="text-sm text-gray-400">ไม่มี</p>}

      <h2 className="pt-2 font-semibold text-cdti-700">อยู่ในจุดรับของกลาง ({inStorage.length})</h2>
      {inStorage.length ? <Table rows={inStorage} /> : <p className="text-sm text-gray-400">ไม่มี</p>}
    </div>
  );
}
