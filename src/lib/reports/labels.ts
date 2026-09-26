import type { CustodyStatus, FoundItemStatus, LostItemStatus } from "@/types/database.types";

export const LOST_STATUS_TH: Record<LostItemStatus, string> = {
  reported: "แจ้งแล้ว",
  matched: "พบรายการที่อาจตรงกัน",
  claim_pending: "รอตรวจสอบการขอรับ",
  returned: "ได้รับคืนแล้ว",
  closed: "ปิดรายการ",
  cancelled: "ยกเลิก",
};

export const FOUND_STATUS_TH: Record<FoundItemStatus, string> = {
  reported: "แจ้งแล้ว",
  in_custody: "อยู่ในความดูแลของเจ้าหน้าที่",
  matched: "พบรายการที่อาจตรงกัน",
  claim_pending: "มีผู้ขอรับ รอตรวจสอบ",
  verified: "ยืนยันเจ้าของแล้ว",
  returned: "ส่งคืนเจ้าของแล้ว",
  closed: "ปิดรายการ",
};

export const CUSTODY_STATUS_TH: Record<CustodyStatus, string> = {
  with_finder: "อยู่กับผู้พบ",
  transferred_to_staff: "ส่งมอบให้เจ้าหน้าที่แล้ว (รอเจ้าหน้าที่ยืนยัน)",
  in_storage: "เก็บรักษาที่จุดรับของกลาง",
  released_to_owner: "ส่งคืนเจ้าของแล้ว",
};

export function formatThaiDate(value: string | null): string {
  if (!value) return "-";
  const d = value.length === 10 ? new Date(value + "T00:00:00+07:00") : new Date(value);
  return d.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
}

export function formatThaiDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
