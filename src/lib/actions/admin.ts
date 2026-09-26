"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaffOrAdmin } from "@/lib/auth/session";
import type { CaseEscalation, InternalNote } from "@/types/database.types";

export type AdminState = { error: string | null; ok: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_TYPES: InternalNote["entity_type"][] = ["claim", "found_item", "lost_item", "risk_event", "user", "escalation"];
const ESC_TYPES: CaseEscalation["entity_type"][] = ["claim", "risk_event", "found_item"];
const CLAIM_FORMS = ["general", "wallet", "key", "electronics"] as const;

function back(formData: FormData) {
  const p = String(formData.get("return_to") ?? "");
  if (/^\/admin(\/[\w\-/?=&.]*)?$/.test(p)) revalidatePath(p.split("?")[0]);
}

// ---------------------------------------------------------------------------
// Internal notes (RLS: staff insert as themselves; author or admin delete)
// ---------------------------------------------------------------------------
export async function addNoteAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const me = await requireStaffOrAdmin();
  const entityType = String(formData.get("entity_type") ?? "") as InternalNote["entity_type"];
  const entityId = String(formData.get("entity_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!NOTE_TYPES.includes(entityType) || !UUID_RE.test(entityId)) return { error: "ข้อมูลไม่ถูกต้อง", ok: false };
  if (!note || note.length > 2000) return { error: "บันทึกต้องมี 1–2000 ตัวอักษร", ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("internal_notes").insert({ entity_type: entityType, entity_id: entityId, author_id: me.id, note });
  if (error) return { error: "บันทึกไม่สำเร็จ", ok: false };
  back(formData);
  return { error: null, ok: true };
}

export async function deleteNoteAction(formData: FormData) {
  await requireStaffOrAdmin();
  const id = String(formData.get("note_id") ?? "");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("internal_notes").delete().eq("id", id); // RLS: author or admin only
  back(formData);
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------
export async function escalateAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireStaffOrAdmin();
  const type = String(formData.get("entity_type") ?? "") as CaseEscalation["entity_type"];
  const id = String(formData.get("entity_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!ESC_TYPES.includes(type) || !UUID_RE.test(id)) return { error: "ข้อมูลไม่ถูกต้อง", ok: false };
  if (reason.length < 5 || reason.length > 1000) return { error: "กรุณาระบุเหตุผล 5–1000 ตัวอักษร", ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("escalate_case", { p_entity_type: type, p_entity_id: id, p_reason: reason });
  if (error) {
    if (error.message.includes("ESCALATE_DUPLICATE")) return { error: "เรื่องนี้ถูกส่งต่อแล้ว รอ admin พิจารณา", ok: false };
    return { error: "ส่งต่อไม่สำเร็จ", ok: false };
  }
  back(formData);
  revalidatePath("/admin/escalations");
  return { error: null, ok: true };
}

export async function resolveEscalationAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const id = String(formData.get("escalation_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "ข้อมูลไม่ถูกต้อง", ok: false };
  if (note.length > 1000) return { error: "บันทึกยาวเกินไป", ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_escalation", { p_id: id, p_note: note || null });
  if (error) return { error: "ปิดเรื่องไม่สำเร็จ", ok: false };
  revalidatePath("/admin/escalations");
  return { error: null, ok: true };
}

// ---------------------------------------------------------------------------
// Reference data (admin; RLS *_write_admin). Deactivate instead of delete.
// ---------------------------------------------------------------------------
export async function saveCategoryAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const nameTh = String(formData.get("name_th") ?? "").trim();
  const nameEn = String(formData.get("name_en") ?? "").trim();
  const claimForm = String(formData.get("claim_form") ?? "general");
  if (!nameTh || nameTh.length > 80 || nameEn.length > 80) return { error: "ชื่อต้องมี 1–80 ตัวอักษร", ok: false };
  if (!(CLAIM_FORMS as readonly string[]).includes(claimForm)) return { error: "แบบฟอร์มไม่ถูกต้อง", ok: false };
  const row = {
    name_th: nameTh,
    name_en: nameEn || null,
    is_high_value: formData.get("is_high_value") === "yes",
    claim_form: claimForm as (typeof CLAIM_FORMS)[number],
    is_active: formData.get("is_active") !== "no",
  };
  const supabase = await createClient();
  const { error } = UUID_RE.test(id)
    ? await supabase.from("categories").update(row).eq("id", id)
    : await supabase.from("categories").insert(row);
  if (error) return { error: "บันทึกไม่สำเร็จ (ต้องเป็น admin)", ok: false };
  revalidatePath("/admin/categories");
  return { error: null, ok: true };
}

export async function saveLocationAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name || name.length > 120) return { error: "ชื่อต้องมี 1–120 ตัวอักษร", ok: false };
  if (description.length > 300) return { error: "คำอธิบายยาวเกิน 300 ตัวอักษร", ok: false };
  const row = { name, description: description || null, is_active: formData.get("is_active") !== "no" };
  const supabase = await createClient();
  const { error } = UUID_RE.test(id)
    ? await supabase.from("locations").update(row).eq("id", id)
    : await supabase.from("locations").insert(row);
  if (error) return { error: "บันทึกไม่สำเร็จ (ต้องเป็น admin)", ok: false };
  revalidatePath("/admin/locations");
  return { error: null, ok: true };
}
