"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaffOrAdmin } from "@/lib/auth/session";
import { STAFF_RESOLUTIONS } from "@/lib/risk/labels";

export type RiskActionState = { error: string | null; ok: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function riskError(m: string | undefined): string {
  const s = m ?? "";
  if (s.includes("RISK_CONFLICT")) return "ไม่สามารถดำเนินการกับรายการที่เกี่ยวกับตัวคุณเองได้";
  if (s.includes("RISK_FORBIDDEN")) return "คุณไม่มีสิทธิ์ดำเนินการนี้";
  if (s.includes("RISK_INVALID")) return "ข้อมูลไม่ถูกต้อง";
  return "ไม่สามารถดำเนินการได้ กรุณาลองใหม่";
}

export async function resolveRiskEventAction(_prev: RiskActionState, formData: FormData): Promise<RiskActionState> {
  await requireStaffOrAdmin(); // resolve_risk_event() re-checks in the DB
  const id = String(formData.get("event_id") ?? "");
  const resolution = String(formData.get("resolution") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "ข้อมูลไม่ถูกต้อง", ok: false };
  if (!(STAFF_RESOLUTIONS as readonly string[]).includes(resolution)) return { error: "กรุณาเลือกผลการตรวจสอบ", ok: false };
  if (note.length > 1000) return { error: "บันทึกยาวเกิน 1000 ตัวอักษร", ok: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_risk_event", {
    p_event_id: id,
    p_resolution: resolution as (typeof STAFF_RESOLUTIONS)[number],
    p_note: note || null,
  });
  if (error) return { error: riskError(error.message), ok: false };
  revalidatePath("/admin/risk");
  return { error: null, ok: true };
}

export async function setAccountRestrictionAction(_prev: RiskActionState, formData: FormData): Promise<RiskActionState> {
  await requireAdmin(); // set_account_restriction() re-checks is_admin() in the DB
  const userId = String(formData.get("user_id") ?? "");
  const restricted = formData.get("restricted") === "true";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID_RE.test(userId)) return { error: "ข้อมูลไม่ถูกต้อง", ok: false };
  if (restricted && reason.length < 5) return { error: "กรุณาระบุเหตุผลประกอบการจำกัดสิทธิ์", ok: false };
  if (reason.length > 1000) return { error: "เหตุผลยาวเกิน 1000 ตัวอักษร", ok: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_restriction", {
    p_user_id: userId,
    p_restricted: restricted,
    p_reason: reason || null,
  });
  if (error) return { error: riskError(error.message), ok: false };
  revalidatePath("/admin/risk");
  return { error: null, ok: true };
}
