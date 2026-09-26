"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireProfile, requireStaffOrAdmin } from "@/lib/auth/session";
import { HANDOVER_RESULT_TH, ID_DOCUMENT_TYPES, normalizeCode } from "@/lib/handover/labels";
import type { CustodyStatus, HandoverResult, IdDocumentType } from "@/types/database.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SimpleState = { error: string | null; ok: boolean; message?: string };

function handoverError(m: string | undefined): string {
  const s = m ?? "";
  if (s.includes("HANDOVER_NOT_READY")) return "ยังส่งมอบไม่ได้ — ของต้องอยู่ในความดูแลของเจ้าหน้าที่ และคำขอต้องได้รับอนุมัติ";
  if (s.includes("HANDOVER_DISPUTED")) return "มีคำขออื่นที่ยังเปิดอยู่ (ข้อพิพาท) — ยังส่งมอบไม่ได้";
  if (s.includes("HANDOVER_CONFLICT")) return "คุณเป็นผู้พบหรือผู้ขอของรายการนี้ ให้เจ้าหน้าที่คนอื่นส่งมอบ";
  if (s.includes("HANDOVER_ID_REQUIRED")) return "ของมูลค่าสูง: ต้องตรวจบัตรประจำตัวและเลือกประเภทบัตรก่อนส่งมอบ";
  if (s.includes("HANDOVER_DONE")) return "รายการนี้ส่งมอบไปแล้ว";
  if (s.includes("HANDOVER_LOCKED")) return "ขอรหัสครบจำนวนครั้งแล้ว กรุณาติดต่อเจ้าหน้าที่";
  if (s.includes("HANDOVER_FORBIDDEN") || s.includes("CUSTODY_FORBIDDEN")) return "คุณไม่มีสิทธิ์ดำเนินการนี้";
  if (s.includes("CUSTODY_INVALID") || s.includes("HANDOVER_INVALID")) return "ข้อมูลไม่ถูกต้อง";
  return "ไม่สามารถดำเนินการได้ กรุณาลองใหม่";
}

// ---------------------------------------------------------------------------
// Claimant: issue a one-time code (returned ONCE, never stored in plaintext)
// ---------------------------------------------------------------------------
export type CodeState = { error: string | null; code: string | null; issuedAt: string | null };

export async function issueHandoverCodeAction(_prev: CodeState, formData: FormData): Promise<CodeState> {
  await requireProfile();
  const claimId = String(formData.get("claim_id") ?? "");
  if (!UUID_RE.test(claimId)) return { error: "ข้อมูลไม่ถูกต้อง", code: null, issuedAt: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_handover_code", { p_claim_id: claimId });
  if (error || !data) return { error: handoverError(error?.message), code: null, issuedAt: null };
  return { error: null, code: data, issuedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Staff: custody transfer
// ---------------------------------------------------------------------------
const TRANSFER_TARGETS: CustodyStatus[] = ["transferred_to_staff", "in_storage"];

export async function recordCustodyAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireStaffOrAdmin();
  const itemId = String(formData.get("found_item_id") ?? "");
  const to = String(formData.get("to_status") ?? "") as CustodyStatus;
  const loc = String(formData.get("location_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID_RE.test(itemId) || !UUID_RE.test(loc)) return { error: "กรุณาเลือกจุดเก็บของ", ok: false };
  if (!TRANSFER_TARGETS.includes(to)) return { error: "สถานะไม่ถูกต้อง", ok: false };
  if (note.length > 1000) return { error: "บันทึกยาวเกินไป", ok: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_custody_transfer", {
    p_found_item_id: itemId,
    p_to_status: to,
    p_location_id: loc,
    p_note: note || null,
  });
  if (error) return { error: handoverError(error.message), ok: false };
  revalidatePath("/admin/custody");
  revalidatePath("/admin/handovers");
  return { error: null, ok: true };
}

// ---------------------------------------------------------------------------
// Staff: complete handover
// ---------------------------------------------------------------------------
export async function completeHandoverAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireStaffOrAdmin(); // complete_handover() re-checks role, conflict, code, ID rule
  const claimId = String(formData.get("claim_id") ?? "");
  const code = normalizeCode(String(formData.get("code") ?? ""));
  const loc = String(formData.get("location_id") ?? "");
  const idChecked = formData.get("id_checked") === "yes";
  const idTypeRaw = String(formData.get("id_document_type") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!UUID_RE.test(claimId) || !UUID_RE.test(loc)) return { error: "กรุณาเลือกจุดส่งมอบ", ok: false };
  if (code.length !== 6) return { error: "กรุณากรอกรหัส 6 หลักจากผู้รับ", ok: false };
  const idType = (ID_DOCUMENT_TYPES as string[]).includes(idTypeRaw) ? (idTypeRaw as IdDocumentType) : null;
  if (idChecked && !idType) return { error: "กรุณาเลือกประเภทบัตรที่ตรวจ", ok: false };
  if (note.length > 1000) return { error: "บันทึกยาวเกินไป", ok: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_handover", {
    p_claim_id: claimId,
    p_code: code,
    p_location_id: loc,
    p_id_checked: idChecked,
    p_id_document_type: idChecked ? idType : null,
    p_note: note || null,
  });
  if (error) return { error: handoverError(error.message), ok: false };
  const result = HANDOVER_RESULT_TH[(data as HandoverResult) ?? "invalid_code"] ?? HANDOVER_RESULT_TH.invalid_code;
  if (result.ok) {
    revalidatePath("/admin/handovers");
    revalidatePath(`/admin/handovers/${claimId}`);
    return { error: null, ok: true, message: result.message };
  }
  return { error: result.message, ok: false };
}

// ---------------------------------------------------------------------------
// Admin: handover locations (RLS handover_locations_write_admin)
// ---------------------------------------------------------------------------
export async function saveHandoverLocationAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const active = formData.get("is_active") !== "no";
  if (!name || name.length > 120) return { error: "ชื่อจุดส่งมอบต้องมี 1–120 ตัวอักษร", ok: false };
  if (address.length > 300) return { error: "ที่อยู่ยาวเกิน 300 ตัวอักษร", ok: false };

  const supabase = await createClient();
  const row = { name, address: address || null, is_active: active };
  const { error } = UUID_RE.test(id)
    ? await supabase.from("handover_locations").update(row).eq("id", id)
    : await supabase.from("handover_locations").insert(row);
  if (error) return { error: "บันทึกไม่สำเร็จ (ต้องเป็น admin)", ok: false };
  revalidatePath("/admin/handover-locations");
  return { error: null, ok: true };
}
