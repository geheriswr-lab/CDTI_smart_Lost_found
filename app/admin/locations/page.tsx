import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PlaceForm } from "./location-form";

export const metadata = { title: "สถานที่ — Admin" };

// Areas people choose when reporting ("บริเวณที่พบ/ทำหาย"). Shown publicly,
// so use general area names only — exact spots belong in the private fields.
export default async function LocationsPage() {
  const me = await requireStaffOrAdmin();
  const isAdmin = me.role === "admin";
  const supabase = await createClient();
  const { data: locs } = await supabase
    .from("locations")
    .select("id, name, description, is_active")
    .order("is_active", { ascending: false })
    .order("name");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">สถานที่ / พื้นที่ในสถาบัน</h1>
        <p className="text-sm text-gray-600">
          ใช้ในฟอร์มแจ้งของหาย/พบของ และแสดงในประกาศสาธารณะ — ใช้ชื่อพื้นที่กว้าง ๆ (อาคาร/โซน) เท่านั้น ·
          ปิดใช้แทนการลบ{!isAdmin && " · แก้ไขได้เฉพาะ admin"}
        </p>
      </div>
      {isAdmin && (
        <section className="rounded-lg bg-white p-4 shadow-sm">
          <PlaceForm />
        </section>
      )}
      <section className="rounded-lg bg-white p-4 shadow-sm">
        {(locs ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">ยังไม่มีสถานที่ — ผู้ใช้จะเลือก &ldquo;ไม่ระบุ&rdquo; ได้อย่างเดียวจนกว่าจะเพิ่ม</p>
        ) : (
          <ul className="divide-y">
            {locs!.map((l) => (
              <li key={l.id} className="py-2">
                {isAdmin ? (
                  <PlaceForm l={l} />
                ) : (
                  <p className="text-sm">
                    {l.name} {l.description && <span className="text-gray-400">— {l.description}</span>}
                    {!l.is_active && <span className="ml-2 text-xs text-gray-400">ปิดใช้</span>}
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
