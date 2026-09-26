import type { RiskEventType, RiskLevel, RiskResolution } from "@/types/database.types";

// README Phase 7: use neutral states only ("Needs Review", "Suspicious
// Activity") — never label anyone a thief/scammer. The DB enforces the same
// vocabulary with check constraints (0022). risk.test.ts scans these labels.

export const RISK_TYPE_TH: Record<RiskEventType, { label: string; explain: string }> = {
  frequent_claims: {
    label: "ส่งคำขอรับของถี่",
    explain: "ส่งคำขอรับของตั้งแต่ 5 รายการขึ้นไปใน 7 วัน",
  },
  repeated_rejections: {
    label: "คำขอไม่ผ่านการตรวจสอบหลายครั้ง",
    explain: "ผลตรวจเป็น 'ข้อมูลไม่พอ' หรือ 'ปฏิเสธ' ตั้งแต่ 3 ครั้งขึ้นไปใน 30 วัน",
  },
  duplicate_claim_target: {
    label: "ส่งคำขอซ้ำกับรายการเดิม",
    explain: "ส่งข้อมูลขอรับของชิ้นเดียวกันเป็นครั้งที่ 2 หรือ 3",
  },
  answer_changed: {
    label: "คำตอบต่างจากครั้งก่อน",
    explain: "คำตอบอย่างน้อย 2 ข้อไม่สอดคล้องกับที่ตอบในครั้งก่อน (ไม่นับการเพิ่มรายละเอียด)",
  },
  new_account_high_value: {
    label: "บัญชีใหม่ขอรับของมูลค่าสูง",
    explain: "บัญชีสมัครไม่ถึง 7 วัน และขอรับของในหมวดมูลค่าสูง",
  },
};

export const RISK_LEVEL_TH: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "ต่ำ", className: "bg-gray-100 text-gray-700" },
  medium: { label: "ปานกลาง", className: "bg-amber-100 text-amber-800" },
  high: { label: "สูง", className: "bg-red-100 text-red-800" },
};

export const RISK_RESOLUTION_TH: Record<RiskResolution, string> = {
  needs_review: "ต้องตรวจสอบ (Needs Review)",
  suspicious_activity: "พฤติกรรมที่ต้องเฝ้าระวัง (Suspicious Activity)",
  cleared: "ตรวจแล้ว ไม่พบปัญหา",
  account_restricted: "จำกัดสิทธิ์บัญชีแล้ว",
};

/** Resolutions staff can pick (account_restricted is set only by the admin restriction action). */
export const STAFF_RESOLUTIONS = ["needs_review", "suspicious_activity", "cleared"] as const;

/** Human-readable summary of an event's details (numbers / field names only). */
export function describeRiskDetails(type: RiskEventType, details: Record<string, unknown>): string {
  const n = (k: string) => (typeof details[k] === "number" ? (details[k] as number) : null);
  switch (type) {
    case "frequent_claims":
      return n("claims_7d") !== null ? `${n("claims_7d")} คำขอใน 7 วัน` : "";
    case "repeated_rejections":
      return n("negative_outcomes_30d") !== null ? `${n("negative_outcomes_30d")} ครั้งใน 30 วัน` : "";
    case "duplicate_claim_target":
      return n("attempt") !== null ? `ครั้งที่ ${n("attempt")}` : "";
    case "answer_changed": {
      const f = Array.isArray(details.changed_fields) ? (details.changed_fields as string[]) : [];
      return f.length ? `${f.length} ข้อ` : "";
    }
    case "new_account_high_value":
      return n("account_age_days") !== null ? `อายุบัญชี ${n("account_age_days")} วัน` : "";
  }
}
