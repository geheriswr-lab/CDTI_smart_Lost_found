import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CategoryForm } from "./category-form";

export const metadata = { title: "ประเภทสิ่งของ — Admin" };

export default async function CategoriesPage() {
  const me = await requireStaffOrAdmin();
  const isAdmin = me.role === "admin";
  const supabase = await createClient();
  const { data: cats } = await supabase
    .from("categories")
    .select("id, name_th, name_en, is_high_value, claim_form, is_active")
    .order("is_active", { ascending: false })
    .order("name_th");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">ประเภทสิ่งของ</h1>
        <p className="text-sm text-gray-600">
          &ldquo;มูลค่าสูง&rdquo; = คำขอต้องผ่านการยืนยันเพิ่ม และตรวจบัตรตอนส่งมอบ · &ldquo;แบบฟอร์ม&rdquo; = ชุดคำถามตอนขอรับของ ·
          ปิดใช้แทนการลบ เพื่อไม่ให้รายการเก่าเสียข้อมูล{!isAdmin && " · แก้ไขได้เฉพาะ admin"}
        </p>
      </div>
      {isAdmin && (
        <section className="rounded-lg bg-white p-4 shadow-sm">
          <CategoryForm />
        </section>
      )}
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <ul className="divide-y">
          {(cats ?? []).map((c) => (
            <li key={c.id} className="py-2">
              {isAdmin ? (
                <CategoryForm c={c} />
              ) : (
                <p className="text-sm">
                  {c.name_th} {c.name_en && <span className="text-gray-400">({c.name_en})</span>}
                  {c.is_high_value && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">มูลค่าสูง</span>}
                  {!c.is_active && <span className="ml-2 text-xs text-gray-400">ปิดใช้</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
