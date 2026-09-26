"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import type { SystemRole } from "@/types/database.types";

export type RoleState = { error: string | null; ok: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: SystemRole[] = ["user", "staff", "admin"];

function roleError(m: string | undefined): string {
  const s = m ?? "";
  if (s.includes("cannot change your own role")) return "เปลี่ยนสิทธิ์ของตัวเองไม่ได้";
  if (s.includes("last admin")) return "ต้องมี admin อย่างน้อย 1 คน — แต่งตั้ง admin คนอื่นก่อน";
  if (s.includes("ROLE_FORBIDDEN")) return "คุณไม่มีสิทธิ์ดำเนินการนี้";
  if (s.includes("ROLE_INVALID")) return "ข้อมูลไม่ถูกต้อง — ระบุเหตุผลอย่างน้อย 3 ตัวอักษร";
  return "ไม่สามารถดำเนินการได้ กรุณาลองใหม่";
}

export async function setUserRoleAction(_prev: RoleState, formData: FormData): Promise<RoleState> {
  await requireAdmin(); // set_user_role() re-checks is_admin() in the DB
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as SystemRole;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID_RE.test(userId) || !ROLES.includes(role)) return { error: "ข้อมูลไม่ถูกต้อง", ok: false };
  if (reason.length < 3 || reason.length > 500) return { error: "กรุณาระบุเหตุผล (3–500 ตัวอักษร)", ok: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", { p_user_id: userId, p_role: role, p_reason: reason });
  if (error) return { error: roleError(error.message), ok: false };
  revalidatePath("/admin/users");
  return { error: null, ok: true };
}
