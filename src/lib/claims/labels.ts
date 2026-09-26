import type { ClaimStatus } from "@/types/database.types";

/**
 * What the CLAIMANT sees. Intermediate review steps are collapsed into
 * "อยู่ระหว่างตรวจสอบ" so progress never hints at which answers matched.
 */
export const CLAIMANT_STATUS: Record<ClaimStatus, { label: string; tone: "neutral" | "info" | "good" | "bad" }> = {
  pending: { label: "อยู่ระหว่างตรวจสอบ", tone: "info" },
  needs_review: { label: "อยู่ระหว่างตรวจสอบ", tone: "info" },
  likely_owner: { label: "อยู่ระหว่างตรวจสอบ", tone: "info" },
  verified: { label: "อยู่ระหว่างตรวจสอบ", tone: "info" },
  disputed: { label: "อยู่ระหว่างตรวจสอบ", tone: "info" },
  insufficient: { label: "ต้องการข้อมูลเพิ่มเติม", tone: "neutral" },
  approved: { label: "ผ่านการตรวจสอบ — รอนัดรับของ", tone: "good" },
  rejected: { label: "ไม่สามารถยืนยันได้", tone: "bad" },
  cancelled: { label: "ยกเลิกแล้ว", tone: "neutral" },
};

/** Staff-facing labels — full detail. */
export const STAFF_STATUS: Record<ClaimStatus, string> = {
  pending: "รอตรวจ (pending)",
  needs_review: "ต้องตรวจเพิ่ม (needs_review)",
  likely_owner: "น่าจะเป็นเจ้าของ (likely_owner)",
  verified: "ยืนยันแล้ว (verified)",
  approved: "อนุมัติ (approved)",
  insufficient: "ข้อมูลไม่พอ (insufficient)",
  rejected: "ปฏิเสธ (rejected)",
  disputed: "มีข้อพิพาท (disputed)",
  cancelled: "ผู้ขอยกเลิก (cancelled)",
};

export const OPEN_CLAIM_STATUSES: ClaimStatus[] = ["pending", "needs_review", "likely_owner", "verified", "disputed"];

export const REVIEW_OUTCOMES: { value: ClaimStatus; label: string; help: string }[] = [
  { value: "needs_review", label: "ต้องตรวจเพิ่ม", help: "ยังตัดสินไม่ได้ ต้องตรวจสอบเพิ่มเติม (ผู้ขอไม่ได้รับแจ้ง)" },
  { value: "likely_owner", label: "น่าจะเป็นเจ้าของ", help: "คำตอบสอดคล้องเป็นส่วนใหญ่ (ผู้ขอไม่ได้รับแจ้ง)" },
  { value: "verified", label: "ยืนยันแล้ว", help: "ตรวจครบ สอดคล้องชัดเจน — จำเป็นก่อนอนุมัติของมูลค่าสูง" },
  { value: "approved", label: "อนุมัติ", help: "อนุมัติให้รับของ — ผู้ขอจะได้รับแจ้ง" },
  { value: "insufficient", label: "ข้อมูลไม่พอ", help: "ให้ผู้ขอส่งข้อมูลใหม่ได้หลัง 24 ชม. (สูงสุด 3 ครั้ง) — ข้อความแจ้งเป็นกลาง" },
  { value: "rejected", label: "ปฏิเสธ", help: "ปิดคำขอถาวร — ข้อความแจ้งเป็นกลาง ไม่บอกว่าข้อไหนผิด" },
];

export const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "answers_match_secret", label: "คำตอบสอดคล้องกับจุดสังเกตลับของผู้พบ" },
  { key: "details_consistent", label: "ลักษณะ/ของข้างใน สอดคล้องกับของที่พบ" },
  { key: "time_place_consistent", label: "เวลา/สถานที่ทำหาย สอดคล้องกับที่พบ" },
  { key: "serial_match", label: "Serial / IMEI ตรงกัน" },
  { key: "evidence_supports", label: "หลักฐานที่แนบสนับสนุนความเป็นเจ้าของ" },
];

export const CHECKLIST_VALUES = ["yes", "no", "na"] as const;
export type ChecklistValue = (typeof CHECKLIST_VALUES)[number];
