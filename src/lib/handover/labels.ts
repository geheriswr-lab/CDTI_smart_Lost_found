import type { HandoverResult, IdDocumentType } from "@/types/database.types";

export const ID_DOCUMENT_TH: Record<IdDocumentType, string> = {
  student_card: "บัตรนักศึกษา / บัตรนักเรียน",
  staff_card: "บัตรบุคลากร",
  national_id: "บัตรประชาชน",
  passport: "หนังสือเดินทาง",
  driver_license: "ใบขับขี่",
  other: "เอกสารอื่น",
};
export const ID_DOCUMENT_TYPES = Object.keys(ID_DOCUMENT_TH) as IdDocumentType[];

export const HANDOVER_RESULT_TH: Record<HandoverResult, { ok: boolean; message: string }> = {
  completed: { ok: true, message: "ส่งมอบเรียบร้อย บันทึกการรับของแล้ว" },
  invalid_code: { ok: false, message: "รหัสไม่ถูกต้อง — ตรวจสอบกับผู้รับอีกครั้ง (กรอกผิดได้ไม่เกิน 5 ครั้ง)" },
  expired: { ok: false, message: "รหัสหมดอายุแล้ว — ให้ผู้รับขอรหัสใหม่จากหน้าคำขอรับของ" },
  locked: { ok: false, message: "รหัสนี้ถูกล็อกหรือใช้ไปแล้ว — ให้ผู้รับขอรหัสใหม่" },
  no_code: { ok: false, message: "ผู้รับยังไม่ได้ขอรหัสรับของ — ให้ผู้รับกด 'ขอรหัสรับของ' ในหน้าคำขอ" },
};

/** Normalises what staff type: keeps digits only (people add spaces/dashes). */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}
