import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CUSTODY_STATUS_TH, formatThaiDateTime } from "@/lib/reports/labels";

export const metadata = { title: "ส่งมอบของ — Admin" };

export default async function AdminHandoversPage() {
  const supabase = await createClient();
  const [{ data: approved }, { data: done }] = await Promise.all([
    supabase.from("claims").select("id, claimant_id, found_item_id, verification_level, reviewed_at").eq("status", "approved").order("reviewed_at"),
    supabase.from("handovers").select("id, claim_id, found_item_id, received_by, id_checked, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const doneClaims = new Set((done ?? []).map((d) => d.claim_id));
  const pending = (approved ?? []).filter((c) => !doneClaims.has(c.id));

  const itemIds = [...new Set([...pending.map((c) => c.found_item_id), ...(done ?? []).map((d) => d.found_item_id)])];
  const peopleIds = [...new Set([...pending.map((c) => c.claimant_id), ...(done ?? []).map((d) => d.received_by)])];
  const [{ data: items }, { data: people }] = await Promise.all([
    itemIds.length ? supabase.from("found_items").select("id, general_name, custody_status").in("id", itemIds) : Promise.resolve({ data: [] }),
    peopleIds.length ? supabase.from("profiles").select("id, full_name").in("id", peopleIds) : Promise.resolve({ data: [] }),
  ]);
  const item = new Map((items ?? []).map((i) => [i.id, i]));
  const person = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-cdti-600 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-bold text-cdti-700">ส่งมอบของ</h1>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">รอส่งมอบ ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">ไม่มี</p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {pending.map((c) => {
              const it = item.get(c.found_item_id);
              const ready = it && (it.custody_status === "transferred_to_staff" || it.custody_status === "in_storage");
              return (
                <li key={c.id}>
                  <Link href={`/admin/handovers/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-gray-50">
                    <span>
                      <span className="font-medium">{it?.general_name ?? "-"}</span>
                      <span className="ml-2 text-gray-500">ผู้รับ: {person.get(c.claimant_id) ?? "-"}</span>
                      {c.verification_level === "enhanced" && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">ต้องตรวจบัตร</span>
                      )}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${ready ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {ready ? "พร้อมส่งมอบ" : `รอรับของเข้า (${it ? CUSTODY_STATUS_TH[it.custody_status] : "-"})`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">ส่งมอบแล้วล่าสุด</h2>
        {(done ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">ยังไม่มี</p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {done!.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/handovers/${d.claim_id}`} className="flex flex-wrap justify-between gap-2 py-2 hover:bg-gray-50">
                  <span>
                    {item.get(d.found_item_id)?.general_name ?? "-"} → {person.get(d.received_by) ?? "-"}
                    {d.id_checked && <span className="ml-2 text-xs text-green-700">ตรวจบัตรแล้ว</span>}
                  </span>
                  <span className="text-xs text-gray-500">{formatThaiDateTime(d.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
