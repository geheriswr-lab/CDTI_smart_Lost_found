// Phase 6 — claim questionnaires per category type (categories.claim_form).
//
// RULE: never ask for passwords, PINs, OTPs, unlock codes or any other
// credential. Questions only ask what a real owner would naturally know
// about the OBJECT. Answers that look like credentials are refused
// server-side (see findCredentialLike) so they are never stored.

import type { FieldErrors } from "@/lib/reports/validation";

export type ClaimFormType = "general" | "wallet" | "key" | "electronics";
export const CLAIM_FORM_TYPES: readonly ClaimFormType[] = ["general", "wallet", "key", "electronics"];

export type Question = {
  key: string;
  label: string;
  hint?: string;
  required: boolean;
  multiline: boolean;
  max: number;
  /** Long digit strings are allowed (serial / IMEI). */
  allowLongNumbers?: boolean;
};

const WHERE_WHEN: Question = {
  key: "where_when",
  label: "คุณคิดว่าทำหายที่ไหน และเมื่อไหร่ (โดยประมาณ)",
  hint: "เช่น โรงอาหาร ช่วงพักเที่ยงวันจันทร์",
  required: true,
  multiline: false,
  max: 300,
};

const MARKS: Question = {
  key: "identifying_marks",
  label: "จุดสังเกตเฉพาะที่มีแค่ของคุณ",
  hint: "เช่น รอยขีดข่วน สติกเกอร์ ชื่อที่เขียนไว้ สิ่งที่ห้อยหรือติดอยู่",
  required: true,
  multiline: true,
  max: 1000,
};

export const QUESTIONNAIRES: Record<ClaimFormType, Question[]> = {
  general: [
    { key: "describe_item", label: "อธิบายลักษณะของสิ่งของโดยละเอียด", hint: "รูปทรง ขนาด วัสดุ สี ยี่ห้อ", required: true, multiline: true, max: 1000 },
    MARKS,
    { key: "contents", label: "มีอะไรอยู่ข้างใน หรือติดมากับสิ่งของไหม (ถ้ามี)", required: false, multiline: true, max: 1000 },
    WHERE_WHEN,
  ],
  wallet: [
    { key: "describe_item", label: "ลักษณะกระเป๋าสตางค์", hint: "ยี่ห้อ สี วัสดุ แบบพับ/ยาว", required: true, multiline: false, max: 300 },
    {
      key: "contents",
      label: "ในกระเป๋ามีอะไรบ้าง",
      hint: "เช่น บัตรนักศึกษา บัตรธนาคารของธนาคารอะไร รูปถ่าย จำนวนเงินสดโดยประมาณ — ไม่ต้องใส่เลขบัตร",
      required: true,
      multiline: true,
      max: 1000,
    },
    { key: "name_on_cards", label: "ชื่อที่ปรากฏบนบัตร (ถ้ามี)", required: false, multiline: false, max: 200 },
    MARKS,
    WHERE_WHEN,
  ],
  key: [
    { key: "key_count", label: "มีกุญแจกี่ดอก", required: true, multiline: false, max: 50 },
    { key: "keychain", label: "พวงกุญแจหรือสิ่งที่ห้อยอยู่", hint: "รูปร่าง สี ตัวการ์ตูน ฯลฯ", required: true, multiline: false, max: 300 },
    { key: "key_details", label: "ลักษณะดอกกุญแจ (ถ้าจำได้)", hint: "เช่น กุญแจรถยี่ห้ออะไร ปลอกสีอะไร", required: false, multiline: true, max: 500 },
    MARKS,
    WHERE_WHEN,
  ],
  electronics: [
    { key: "brand_model", label: "ยี่ห้อและรุ่น", required: true, multiline: false, max: 200 },
    { key: "case_accessories", label: "เคส สติกเกอร์ หรืออุปกรณ์ที่ติดอยู่", required: false, multiline: true, max: 500 },
    {
      key: "lockscreen",
      label: "ภาพหน้าจอล็อก / วอลเปเปอร์ (อธิบายภาพ)",
      hint: "อธิบายว่าเป็นภาพอะไร — ห้ามใส่รหัสปลดล็อก",
      required: false,
      multiline: false,
      max: 300,
    },
    {
      key: "serial",
      label: "หมายเลขเครื่อง / Serial / IMEI (ถ้าทราบ)",
      hint: "ดูได้จากกล่องหรือใบเสร็จ",
      required: false,
      multiline: false,
      max: 100,
      allowLongNumbers: true,
    },
    MARKS,
    WHERE_WHEN,
  ],
};

export function asClaimFormType(value: string | null | undefined): ClaimFormType {
  return (CLAIM_FORM_TYPES as readonly string[]).includes(value ?? "") ? (value as ClaimFormType) : "general";
}

// ---------------------------------------------------------------------------
// Credential / sensitive-number detection
// ---------------------------------------------------------------------------

const CREDENTIAL_RE =
  /(password|passcode|pass\s*word|รหัสผ่าน|รหัสปลดล็อก|รหัสเข้าเครื่อง|รหัส\s*atm|\bpin\b|otp)\s*(?:คือ|is|:|=)?\s*\S*\d{3,}/i;
const LONG_NUMBER_RE = /\d[\d\s-]{11,}\d/; // 13+ digit-ish sequences: ID / card / account numbers

export type SensitiveHit = "credential" | "long_number" | null;

export function findSensitive(value: string, allowLongNumbers = false): SensitiveHit {
  if (CREDENTIAL_RE.test(value)) return "credential";
  if (!allowLongNumbers && LONG_NUMBER_RE.test(value) && value.replace(/\D/g, "").length >= 13) return "long_number";
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ClaimAnswers = { _form: ClaimFormType } & Record<string, string>;

export function validateClaimAnswers(
  form: ClaimFormType,
  formData: FormData
): { ok: true; answers: ClaimAnswers } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const answers: ClaimAnswers = { _form: form };

  for (const q of QUESTIONNAIRES[form]) {
    const raw = formData.get(`q_${q.key}`);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      if (q.required) errors[q.key] = "กรุณาตอบข้อนี้";
      continue;
    }
    if (value.length > q.max) {
      errors[q.key] = `ความยาวต้องไม่เกิน ${q.max} ตัวอักษร`;
      continue;
    }
    const hit = findSensitive(value, q.allowLongNumbers);
    if (hit === "credential") {
      errors[q.key] = "ห้ามใส่รหัสผ่าน, PIN, OTP หรือรหัสปลดล็อก — เจ้าหน้าที่จะไม่ขอข้อมูลเหล่านี้";
      continue;
    }
    if (hit === "long_number") {
      errors[q.key] = "ไม่ต้องใส่เลขบัตรประชาชน เลขบัตร หรือเลขบัญชีแบบเต็ม";
      continue;
    }
    answers[q.key] = value;
  }

  const agree = formData.get("confirm_truthful");
  if (agree !== "yes") errors.confirm_truthful = "กรุณายืนยันว่าข้อมูลเป็นความจริง";

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers };
}

/** Pairs stored answers with their question labels, for display. */
export function labelledAnswers(answers: Record<string, unknown>): { label: string; value: string }[] {
  const form = asClaimFormType(typeof answers._form === "string" ? answers._form : null);
  const out: { label: string; value: string }[] = [];
  for (const q of QUESTIONNAIRES[form]) {
    const v = answers[q.key];
    if (typeof v === "string" && v) out.push({ label: q.label, value: v });
  }
  return out;
}
