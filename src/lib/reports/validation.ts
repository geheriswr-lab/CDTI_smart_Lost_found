// Pure validation for Phase 3 report forms. No Supabase / Next imports so it
// can be unit-tested directly (see validation.test.ts) and reused by the
// client for early feedback. The server action ALWAYS re-runs this — the
// client copy is only a UX nicety — and the DB triggers in
// 0018_phase3_reporting.sql enforce the same rules a third time.

import type { CustodyStatus } from "@/types/database.types";

export const LIMITS = {
  name: 120,
  brand: 80,
  color: 50,
  description: 2000,
  privateText: 2000,
  exactLocation: 300,
  serial: 120,
} as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Custody states a finder may self-declare. The rest are staff-only (Phase 8). */
export const FINDER_CUSTODY_OPTIONS = ["with_finder", "transferred_to_staff"] as const satisfies readonly CustodyStatus[];

export type FieldErrors = Partial<Record<string, string>>;

export type LostReportInput = {
  item_name: string;
  category_id: string;
  brand: string | null;
  color: string | null;
  lost_date: string;
  location_id: string | null;
  description: string | null;
  private_ownership_details: string;
};

export type FoundReportInput = {
  general_name: string;
  category_id: string;
  color: string | null;
  found_date: string;
  location_id: string | null;
  description: string | null;
  custody_status: (typeof FINDER_CUSTODY_OPTIONS)[number];
  exact_location: string | null;
  exact_time: string | null; // ISO string with +07:00 offset resolved
  serial_number: string | null;
  secret_details: string;
};

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Today's date (YYYY-MM-DD) in Asia/Bangkok. */
export function bangkokToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function optional(value: string): string | null {
  return value === "" ? null : value;
}

function checkLength(errors: FieldErrors, key: string, value: string, max: number) {
  if (value.length > max) errors[key] = `ความยาวต้องไม่เกิน ${max} ตัวอักษร`;
}

function checkDate(errors: FieldErrors, key: string, value: string, now: Date, label: string) {
  if (!value) {
    errors[key] = `กรุณาระบุ${label}`;
    return;
  }
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) {
    errors[key] = "รูปแบบวันที่ไม่ถูกต้อง";
    return;
  }
  if (value > bangkokToday(now)) {
    errors[key] = `${label}ต้องไม่เป็นวันในอนาคต`;
  }
}

/** Converts an <input type="datetime-local"> value (Bangkok wall-clock) to ISO. */
export function bangkokLocalToIso(value: string): string | null {
  const m = DATETIME_LOCAL_RE.exec(value);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:00+07:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function validateLostReport(formData: FormData, now: Date = new Date()): ValidationResult<LostReportInput> {
  const errors: FieldErrors = {};

  const item_name = str(formData, "item_name");
  const category_id = str(formData, "category_id");
  const brand = str(formData, "brand");
  const color = str(formData, "color");
  const lost_date = str(formData, "lost_date");
  const location_id = str(formData, "location_id");
  const description = str(formData, "description");
  const private_ownership_details = str(formData, "private_ownership_details");

  if (!item_name) errors.item_name = "กรุณาระบุชื่อสิ่งของ";
  checkLength(errors, "item_name", item_name, LIMITS.name);

  if (!UUID_RE.test(category_id)) errors.category_id = "กรุณาเลือกประเภทสิ่งของ";
  if (location_id && !UUID_RE.test(location_id)) errors.location_id = "สถานที่ไม่ถูกต้อง";

  checkLength(errors, "brand", brand, LIMITS.brand);
  checkLength(errors, "color", color, LIMITS.color);
  checkLength(errors, "description", description, LIMITS.description);
  checkDate(errors, "lost_date", lost_date, now, "วันที่ทำหาย");

  if (!private_ownership_details) {
    errors.private_ownership_details =
      "กรุณาระบุรายละเอียดที่ยืนยันความเป็นเจ้าของ (เจ้าหน้าที่ใช้ตรวจสอบเท่านั้น)";
  }
  checkLength(errors, "private_ownership_details", private_ownership_details, LIMITS.privateText);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      item_name,
      category_id,
      brand: optional(brand),
      color: optional(color),
      lost_date,
      location_id: optional(location_id),
      description: optional(description),
      private_ownership_details,
    },
  };
}

export function validateFoundReport(formData: FormData, now: Date = new Date()): ValidationResult<FoundReportInput> {
  const errors: FieldErrors = {};

  const general_name = str(formData, "general_name");
  const category_id = str(formData, "category_id");
  const color = str(formData, "color");
  const found_date = str(formData, "found_date");
  const location_id = str(formData, "location_id");
  const description = str(formData, "description");
  const custody_status = str(formData, "custody_status");
  const exact_location = str(formData, "exact_location");
  const exact_time_raw = str(formData, "exact_time");
  const serial_number = str(formData, "serial_number");
  const secret_details = str(formData, "secret_details");

  if (!(FINDER_CUSTODY_OPTIONS as readonly string[]).includes(custody_status)) {
    errors.custody_status = "กรุณาระบุว่าตอนนี้สิ่งของอยู่ที่ใด";
  }

  if (!general_name) errors.general_name = "กรุณาระบุชื่อเรียกทั่วไปของสิ่งของ";
  checkLength(errors, "general_name", general_name, LIMITS.name);

  if (!UUID_RE.test(category_id)) errors.category_id = "กรุณาเลือกประเภทสิ่งของ";
  if (location_id && !UUID_RE.test(location_id)) errors.location_id = "สถานที่ไม่ถูกต้อง";

  checkLength(errors, "color", color, LIMITS.color);
  checkLength(errors, "description", description, LIMITS.description);
  checkDate(errors, "found_date", found_date, now, "วันที่พบ");

  checkLength(errors, "exact_location", exact_location, LIMITS.exactLocation);
  checkLength(errors, "serial_number", serial_number, LIMITS.serial);

  let exact_time: string | null = null;
  if (exact_time_raw) {
    exact_time = bangkokLocalToIso(exact_time_raw);
    if (!exact_time) {
      errors.exact_time = "รูปแบบเวลาไม่ถูกต้อง";
    } else if (Date.parse(exact_time) > now.getTime() + 5 * 60 * 1000) {
      errors.exact_time = "เวลาที่พบต้องไม่เป็นเวลาในอนาคต";
    } else if (!errors.found_date && found_date && exact_time_raw.slice(0, 10) !== found_date) {
      errors.exact_time = "วันที่ของเวลาที่พบต้องตรงกับวันที่พบ";
    }
  }

  if (!secret_details) {
    errors.secret_details = "กรุณาระบุจุดสังเกตลับอย่างน้อย 1 อย่าง (ใช้ตรวจสอบผู้มาขอรับ)";
  }
  checkLength(errors, "secret_details", secret_details, LIMITS.privateText);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      general_name,
      category_id,
      color: optional(color),
      found_date,
      location_id: optional(location_id),
      description: optional(description),
      custody_status: custody_status as FoundReportInput["custody_status"],
      exact_location: optional(exact_location),
      exact_time,
      serial_number: optional(serial_number),
      secret_details,
    },
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export type ImageCheck =
  | { ok: true; file: File; mime: AllowedImageType; ext: "jpg" | "png" | "webp" }
  | { ok: true; file: null }
  | { ok: false; error: string };

/** Detects the real image type from magic bytes — never trusts file.type / extension alone. */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) return "image/webp";
  return null;
}

const EXT: Record<AllowedImageType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function checkImage(value: FormDataEntryValue | null): Promise<ImageCheck> {
  // Browsers send an empty File (size 0, name "") when no file is chosen.
  if (value === null || typeof value === "string" || value.size === 0) {
    return { ok: true, file: null };
  }
  if (value.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB" };
  }
  const head = new Uint8Array(await value.slice(0, 16).arrayBuffer());
  const mime = sniffImageType(head);
  if (!mime) {
    return { ok: false, error: "รองรับเฉพาะไฟล์รูป JPG, PNG หรือ WebP" };
  }
  return { ok: true, file: value, mime, ext: EXT[mime] };
}

/** Maps DB guard errors (0018_phase3_reporting.sql) to user-facing Thai messages. */
export function mapReportDbError(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("REPORT_RATE_LIMIT")) return "คุณแจ้งรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (m.includes("REPORT_FORBIDDEN") || m.includes("row-level security"))
    return "บัญชีของคุณไม่มีสิทธิ์แจ้งรายการในขณะนี้ กรุณาติดต่อเจ้าหน้าที่";
  if (m.includes("REPORT_INVALID")) return "ข้อมูลบางส่วนไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่";
  return "ไม่สามารถบันทึกรายการได้ กรุณาลองใหม่อีกครั้ง";
}

// ---------------------------------------------------------------------------
// Claim evidence (Phase 6): images or PDF, private bucket only
// ---------------------------------------------------------------------------

export type EvidenceCheck =
  | { ok: true; file: File; mime: AllowedImageType | "application/pdf"; ext: "jpg" | "png" | "webp" | "pdf" }
  | { ok: false; error: string };

export const MAX_EVIDENCE_FILES = 3;

export async function checkEvidenceFile(file: File): Promise<EvidenceCheck> {
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "ไฟล์หลักฐานต้องมีขนาดไม่เกิน 5 MB ต่อไฟล์" };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const img = sniffImageType(head);
  if (img) return { ok: true, file, mime: img, ext: EXT[img] };
  if (head.length >= 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d) {
    return { ok: true, file, mime: "application/pdf", ext: "pdf" }; // %PDF-
  }
  return { ok: false, error: "หลักฐานรองรับเฉพาะรูป JPG/PNG/WebP หรือ PDF" };
}

/** Non-empty files from a multi-file input. */
export function evidenceFiles(formData: FormData, key = "evidence"): File[] {
  return formData.getAll(key).filter((v): v is File => typeof v !== "string" && v.size > 0);
}
