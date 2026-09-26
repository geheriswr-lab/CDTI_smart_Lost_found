import Link from "next/link";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { LocationForm } from "./location-form";

export const metadata = { title: "จุดส่งมอบ — Admin" };

// README Phase 8: handover locations are managed by admin, never hard-coded.
// Admin writes are allowed by RLS handover_locations_write_admin; delete is
// revoked (deactivate instead) so custody history keeps its references.
export default async function HandoverLocationsPage() {
  const me = await requireStaffOrAdmin();
  const isAdmin = me.role === "admin";
  const supabase = await createClient();
  const { data: locations } = await supabase
    .from("handover_locations")
    .select("id, name, address, is_active")
    .order("is_active", { ascending: false })
    .order("name");

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-cdti-600 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-bold text-cdti-700">จุดส่งมอบ / จุดรับของกลาง</h1>
      <p className="text-sm text-gray-600">
        ใช้เป็นจุดเก็บของและจุดส่งมอบ แสดงให้ผู้พบเห็นในหน้าแจ้งพบของ และให้ผู้ได้รับอนุมัติเห็นเป็นสถานที่รับของ
        {!isAdmin && " (แก้ไขได้เฉพาะ admin)"}
      </p>

      {isAdmin && (
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-cdti-700">เพิ่มจุดใหม่</h2>
          <LocationForm />
        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow-sm">
        {(locations ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">ยังไม่มีจุดส่งมอบ — ต้องเพิ่มอย่างน้อย 1 จุดก่อนจึงจะรับของเข้าและส่งมอบได้</p>
        ) : (
          <ul className="divide-y">
            {locations!.map((l) => (
              <li key={l.id} className="py-3">
                {isAdmin ? (
                  <LocationForm location={l} />
                ) : (
                  <p className="text-sm">
                    <span className="font-medium">{l.name}</span>
                    {l.address && <span className="text-gray-500"> — {l.address}</span>}
                    {!l.is_active && <span className="ml-2 text-xs text-gray-400">(ปิดใช้)</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
