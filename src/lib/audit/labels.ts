// Human-readable labels for audit actions and notification types.
// audit.test.ts scans the migrations + matching code and fails if any
// action/type is emitted without a label here.

export const AUDIT_ACTION_TH: Record<string, string> = {
  "lost_item.created": "แจ้งของหาย",
  "lost_item.edited": "แก้ไขรายการของหาย",
  "found_item.created": "แจ้งพบของ",
  "found_item.edited": "แก้ไขรายการพบของ",
  "match.created": "ระบบพบรายการที่อาจตรงกัน",
  "claim.submitted": "ส่งคำขอรับของ",
  "claim.cancelled": "ผู้ขอยกเลิกคำขอ",
  "claim.reviewed": "เจ้าหน้าที่บันทึกผลตรวจคำขอ",
  "claim.disputed": "เกิดข้อพิพาท (ผู้ขอมากกว่า 1 คน)",
  "risk.flagged": "ระบบพบสัญญาณที่ต้องตรวจสอบ",
  "risk.resolved": "เจ้าหน้าที่บันทึกผลสัญญาณ",
  "custody.changed": "เปลี่ยนการครอบครอง",
  "handover.code_issued": "ผู้ขอขอรหัสรับของ",
  "handover.code_failed": "กรอกรหัสรับของไม่ถูกต้อง",
  "handover.completed": "ส่งมอบของเรียบร้อย",
  "account.restricted": "จำกัดสิทธิ์บัญชี",
  "account.unrestricted": "ยกเลิกการจำกัดสิทธิ์บัญชี",
  "profile.role_changed": "เปลี่ยนสิทธิ์ผู้ใช้ (role)",
  "profile.restriction_changed": "เปลี่ยนสถานะจำกัดสิทธิ์ (แก้ตรง)",
  "profile.password_flag_changed": "เปลี่ยนสถานะบังคับเปลี่ยนรหัสผ่าน",
  "reference.created": "เพิ่มข้อมูลอ้างอิง",
  "reference.updated": "แก้ไขข้อมูลอ้างอิง",
  "reference.deleted": "ลบข้อมูลอ้างอิง",
  "internal_note.created": "เพิ่มบันทึกภายใน",
  "internal_note.deleted": "ลบบันทึกภายใน",
  "case.escalated": "ส่งต่อเรื่องให้ admin",
  "case.escalation_resolved": "admin ปิดเรื่องที่ส่งต่อ",
  "user.role_set": "admin แต่งตั้ง/เปลี่ยนสิทธิ์ผู้ใช้",
};

export const AUDIT_GROUPS: { key: string; label: string; prefixes: string[] }[] = [
  { key: "items", label: "รายการของหาย/พบของ", prefixes: ["lost_item.", "found_item.", "match."] },
  { key: "claims", label: "คำขอรับของ", prefixes: ["claim."] },
  { key: "custody", label: "การครอบครอง/ส่งมอบ", prefixes: ["custody.", "handover."] },
  { key: "risk", label: "สัญญาณความเสี่ยง", prefixes: ["risk."] },
  { key: "admin", label: "การกระทำของ admin", prefixes: ["account.", "profile.", "user.", "reference.", "internal_note.", "case."] },
];

export const ENTITY_TH: Record<string, string> = {
  lost_item: "ของหาย",
  found_item: "พบของ",
  claim: "คำขอรับของ",
  match: "การจับคู่",
  user: "ผู้ใช้",
  risk_event: "สัญญาณ",
  categories: "ประเภทสิ่งของ",
  locations: "สถานที่",
  handover_locations: "จุดส่งมอบ",
  escalation: "เรื่องส่งต่อ",
};

export const NOTIFICATION_TYPE_TH: Record<string, string> = {
  potential_match: "พบรายการที่อาจตรงกัน",
  claim_received: "ได้รับคำขอ",
  claim_more_info: "ต้องการข้อมูลเพิ่ม",
  claim_approved: "ผ่านการตรวจสอบ",
  claim_rejected: "ผลการตรวจสอบ",
  claim_review_required: "รอตรวจสอบ (เจ้าหน้าที่)",
  dispute_review_required: "ข้อพิพาท (เจ้าหน้าที่)",
  handover_ready: "พร้อมรับของ",
  handover_completed: "รับของแล้ว",
  item_returned: "ของคืนเจ้าของแล้ว",
  account_restricted: "บัญชีถูกจำกัดสิทธิ์",
  account_unrestricted: "บัญชีใช้งานได้ปกติ",
  case_escalated: "เรื่องส่งต่อ (admin)",
  role_changed: "สิทธิ์การใช้งานเปลี่ยน",
};

const SAFE_KEYS = new Set([
  "from", "to", "outcome", "from_status", "attempt", "issue", "score", "verification_level", "risk_level",
  "event_type", "resolution", "restricted", "must_change_password", "changed_fields", "id_checked", "name",
  "is_active", "active_claims", "reason", "escalation_id", "has_public_image", "has_private_image", "custody_status",
]);

/**
 * Short, display-safe summary of audit metadata. Only whitelisted keys are
 * shown (ids and anything unexpected are hidden) — defence in depth on top of
 * the DB never writing private values into metadata.
 */
export function summarizeMetadata(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (!SAFE_KEYS.has(k) || v === null || v === undefined) continue;
    const val = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? "" : String(v);
    if (val) parts.push(`${k}: ${val}`);
  }
  return parts.join(" · ");
}
