"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireStaffOrAdmin } from "@/lib/auth/session";
import { asClaimFormType, validateClaimAnswers } from "@/lib/claims/questionnaire";
import { CHECKLIST_ITEMS, CHECKLIST_VALUES, REVIEW_OUTCOMES } from "@/lib/claims/labels";
import { MAX_EVIDENCE_FILES, checkEvidenceFile, evidenceFiles, type FieldErrors } from "@/lib/reports/validation";
import { PRIVATE_BUCKET } from "@/lib/reports/storage";
import type { ClaimStatus } from "@/types/database.types";

export type ClaimFormState = { error: string | null; fieldErrors: FieldErrors };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DB error codes (0021) -> neutral Thai messages. Never echoes the raw error. */
function claimErrorMessage(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("CLAIM_ALREADY_ACTIVE")) return "คุณมีคำขอรับของรายการนี้อยู่ระหว่างตรวจสอบแล้ว";
  if (m.includes("CLAIM_COOLDOWN")) return "กรุณารอให้ครบ 24 ชั่วโมงก่อนส่งข้อมูลใหม่";
  if (m.includes("CLAIM_LOCKED")) return "ไม่สามารถส่งคำขอสำหรับรายการนี้ได้อีก หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่";
  if (m.includes("CLAIM_RATE_LIMIT")) return "คุณส่งคำขอรับของบ่อยเกินไป กรุณาลองใหม่ภายหลัง";
  if (m.includes("CLAIM_NOT_AVAILABLE")) return "รายการนี้ไม่เปิดรับคำขอแล้ว";
  if (m.includes("CLAIM_NOT_ALLOWED")) return "คุณไม่สามารถส่งคำขอรับของรายการนี้ได้";
  if (m.includes("CLAIM_ENHANCED")) return "รายการมูลค่าสูงต้องบันทึกผล 'ยืนยันแล้ว' ก่อนจึงจะอนุมัติได้";
  if (m.includes("CLAIM_CONFLICT")) return "คุณเกี่ยวข้องกับรายการนี้ (เป็นผู้พบหรือผู้ขอ) จึงตรวจสอบเองไม่ได้";
  if (m.includes("CLAIM_FINAL")) return "คำขอนี้ปิดไปแล้ว";
  if (m.includes("CLAIM_DISPUTED")) return "ของชิ้นนี้ยังมีคำขออื่นที่เปิดอยู่ (ข้อพิพาท) — ต้องปิดคำขออื่นก่อนจึงจะอนุมัติได้";
  if (m.includes("CLAIM_FORBIDDEN")) return "เฉพาะเจ้าหน้าที่เท่านั้น";
  if (m.includes("CLAIM_INVALID")) return "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
  return "ไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง";
}

// ---------------------------------------------------------------------------
// Claimant: submit / resubmit
// ---------------------------------------------------------------------------
export async function submitClaimAction(_prev: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  const profile = await requireProfile();
  const foundItemId = String(formData.get("found_item_id") ?? "");
  if (!UUID_RE.test(foundItemId)) return { error: "ข้อมูลไม่ถูกต้อง", fieldErrors: {} };

  const supabase = await createClient();

  // Questionnaire type comes from the item's category (server-side), not from the form.
  const { data: pub } = await supabase
    .from("public_found_items")
    .select("id, category_id")
    .eq("id", foundItemId)
    .maybeSingle();
  if (!pub) return { error: "รายการนี้ไม่เปิดรับคำขอแล้ว", fieldErrors: {} };
  let formType = asClaimFormType(null);
  if (pub.category_id) {
    const { data: cat } = await supabase.from("categories").select("claim_form").eq("id", pub.category_id).maybeSingle();
    formType = asClaimFormType(cat?.claim_form);
  }

  const parsed = validateClaimAnswers(formType, formData);
  const files = evidenceFiles(formData);
  const fieldErrors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  if (files.length > MAX_EVIDENCE_FILES) fieldErrors.evidence = `แนบหลักฐานได้ไม่เกิน ${MAX_EVIDENCE_FILES} ไฟล์ต่อครั้ง`;
  const checked = await Promise.all(files.map(checkEvidenceFile));
  const badFile = checked.find((c) => !c.ok);
  if (badFile && !badFile.ok) fieldErrors.evidence = badFile.error;
  if (!parsed.ok || Object.keys(fieldErrors).length > 0) {
    return { error: "กรุณาตรวจสอบข้อมูลที่ไฮไลต์ไว้", fieldErrors };
  }

  const matchIdRaw = String(formData.get("match_id") ?? "");
  const { data: claimId, error } = await supabase.rpc("submit_claim", {
    p_found_item_id: foundItemId,
    p_answers: parsed.answers,
    p_match_id: UUID_RE.test(matchIdRaw) ? matchIdRaw : null,
  });
  if (error || !claimId) return { error: claimErrorMessage(error?.message), fieldErrors: {} };

  // Evidence: private bucket, <uid>/claims/<claim_id>/<random>.<ext>.
  // The DB guard (0021) re-checks path ownership and the per-claim limit.
  let evidenceFailed = 0;
  for (const c of checked) {
    if (!c.ok) continue;
    const path = `${profile.id}/claims/${claimId}/${randomUUID()}.${c.ext}`;
    const up = await supabase.storage.from(PRIVATE_BUCKET).upload(path, c.file, { contentType: c.mime, upsert: false });
    if (up.error) {
      evidenceFailed++;
      continue;
    }
    const ins = await supabase.from("claim_evidence").insert({ claim_id: claimId, evidence_url: path });
    if (ins.error) evidenceFailed++;
  }

  revalidatePath("/dashboard");
  redirect(`/claims/${claimId}?submitted=1${evidenceFailed ? "&evidence_failed=1" : ""}`);
}

// ---------------------------------------------------------------------------
// Claimant: cancel
// ---------------------------------------------------------------------------
export async function cancelClaimAction(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("claim_id") ?? "");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.rpc("cancel_claim", { p_claim_id: id });
  revalidatePath(`/claims/${id}`);
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Staff: review
// ---------------------------------------------------------------------------
export type ReviewFormState = { error: string | null; ok: boolean };

export async function reviewClaimAction(_prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  await requireStaffOrAdmin(); // UX guard — review_claim() re-checks is_staff_or_admin() in the DB
  const claimId = String(formData.get("claim_id") ?? "");
  const outcome = String(formData.get("outcome") ?? "") as ClaimStatus;
  const note = String(formData.get("note") ?? "").trim();

  if (!UUID_RE.test(claimId)) return { error: "ข้อมูลไม่ถูกต้อง", ok: false };
  if (!REVIEW_OUTCOMES.some((o) => o.value === outcome)) return { error: "กรุณาเลือกผลการตรวจสอบ", ok: false };
  if (note.length > 2000) return { error: "บันทึกยาวเกิน 2000 ตัวอักษร", ok: false };

  const checklist: Record<string, string> = {};
  for (const item of CHECKLIST_ITEMS) {
    const v = String(formData.get(`chk_${item.key}`) ?? "");
    if ((CHECKLIST_VALUES as readonly string[]).includes(v)) checklist[item.key] = v;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_claim", {
    p_claim_id: claimId,
    p_outcome: outcome,
    p_checklist: checklist,
    p_note: note || null,
  });
  if (error) return { error: claimErrorMessage(error.message), ok: false };

  revalidatePath(`/admin/claims/${claimId}`);
  revalidatePath("/admin/claims");
  return { error: null, ok: true };
}
