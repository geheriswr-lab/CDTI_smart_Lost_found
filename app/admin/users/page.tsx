import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatThaiDateTime } from "@/lib/reports/labels";
import { RoleForm } from "./role-form";

const USER_TYPE_TH: Record<string, string> = {
  vocational_student: "นักเรียนอาชีวศึกษา",
  university_student: "นักศึกษาระดับอุดมศึกษา",
  teacher_staff: "ครู/บุคลากร",
  royal_household_staff: "บุคลากรสำนักพระราชวัง",
  external_visitor: "บุคคลภายนอก",
};
const ROLE_BADGE: Record<string, string> = {
  admin: "bg-red-100 text-red-800",
  staff: "bg-cdti-50 text-cdti-700",
  user: "bg-gray-100 text-gray-600",
};

// Phase 12: appoint / remove staff. Admin only (page + set_user_role() in the DB).
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireAdmin();
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim().slice(0, 100);
  const supabase = await createClient();

  // PostgREST filter syntax: strip characters that have meaning inside or()/ilike.
  const safe = q.replace(/[%,()*\\]/g, " ").trim();
  const query = supabase
    .from("profiles")
    .select("id, email, full_name, user_type, role, is_restricted, must_change_password, created_at")
    .order("role", { ascending: true })
    .order("email", { ascending: true })
    .limit(50);
  const { data: people } = safe
    ? await query.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`)
    : await query.in("role", ["staff", "admin"]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">ผู้ใช้ / สิทธิ์</h1>
        <p className="text-sm text-gray-600">
          แต่งตั้งหรือถอดถอนเจ้าหน้าที่ ทุกการเปลี่ยนแปลงต้องระบุเหตุผลและถูกบันทึกใน Audit log · เปลี่ยนสิทธิ์ตัวเองไม่ได้ ·
          ต้องมี admin เหลืออย่างน้อย 1 คน
        </p>
      </div>

      <form className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">ค้นหาผู้ใช้</label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="ค้นหาด้วยอีเมลหรือชื่อ"
          className="w-72 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button className="rounded-md bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-cdti-50">ค้นหา</button>
      </form>

      <p className="text-xs text-gray-500">
        {safe ? `ผลการค้นหา "${safe}" (สูงสุด 50 รายการ)` : "แสดงเฉพาะเจ้าหน้าที่และผู้ดูแลระบบ — ค้นหาเพื่อแต่งตั้งผู้ใช้คนอื่น"}
      </p>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">ผู้ใช้</th>
              <th className="px-3 py-2">ประเภท</th>
              <th className="px-3 py-2">สิทธิ์ปัจจุบัน</th>
              <th className="px-3 py-2">เปลี่ยนสิทธิ์</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(people ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{p.full_name}</div>
                  <div className="text-xs text-gray-500">
                    {p.email} · สมัคร {formatThaiDateTime(p.created_at)}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">{USER_TYPE_TH[p.user_type] ?? p.user_type}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${ROLE_BADGE[p.role]}`}>{p.role}</span>
                  {p.is_restricted && <span className="ml-1 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-white">ถูกจำกัดสิทธิ์</span>}
                  {p.must_change_password && <span className="ml-1 text-xs text-amber-700">รอเปลี่ยนรหัส</span>}
                </td>
                <td className="px-3 py-2">
                  {p.id === me.id ? <span className="text-xs text-gray-400">บัญชีของคุณ</span> : <RoleForm userId={p.id} current={p.role} />}
                </td>
              </tr>
            ))}
            {(people ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                  ไม่พบผู้ใช้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
