// Phase 13 — Social Enterprise model: labels + the fee formula shown in the UI.
// The database (0028 public.reward_fee) is the source of truth; feeFor() only
// previews the same formula so people see the split before confirming.

export type RewardStatus = "pledged" | "payable" | "paid" | "disbursed" | "donated" | "cancelled";
export type FinderChoice = "receive" | "donate";
export type FundingKind = "institution_subscription" | "partner_sponsorship" | "donation";
export type VoucherStatus = "issued" | "redeemed" | "revoked" | "expired";
export type VoucherRedeemResult = "redeemed" | "already_redeemed" | "revoked" | "expired" | "not_found";

export type PlatformSettings = {
  id: number;
  reward_fee_percent: number;
  reward_fee_min: number;
  reward_min: number;
  reward_max: number;
  reward_offer_days: number;
  vouchers_per_finder_30d: number;
  payment_mode: "demo";
  updated_at: string;
  updated_by: string | null;
};

/** Wording: a voluntary thank-you, never a price for getting the item back. */
export const REWARD_NAME = "สินน้ำใจสำหรับผู้พบ";

export const REWARD_PRESETS = [100, 300, 500] as const;

export const REWARD_STATUS_OWNER: Record<RewardStatus, string> = {
  pledged: "ตั้งไว้ — จะมอบเมื่อได้ของคืนแล้วเท่านั้น",
  payable: "ได้ของคืนแล้ว — รอคุณยืนยันการมอบ (ไม่บังคับ)",
  paid: "ยืนยันการมอบแล้ว — รอเจ้าหน้าที่โอนให้ผู้พบ",
  disbursed: "โอนให้ผู้พบแล้ว",
  donated: "ผู้พบมอบสินน้ำใจให้โครงการ",
  cancelled: "ยกเลิกแล้ว",
};

export const REWARD_STATUS_FINDER: Record<RewardStatus, string> = {
  pledged: "-",
  payable: "เจ้าของกำลังยืนยันการมอบ",
  paid: "เจ้าของยืนยันแล้ว — รอเจ้าหน้าที่โอน",
  disbursed: "ได้รับแล้ว",
  donated: "คุณมอบให้โครงการแล้ว ขอบคุณ",
  cancelled: "ยกเลิก",
};

export const REWARD_STATUS_STAFF: Record<RewardStatus, string> = {
  pledged: "ตั้งไว้ (ยังไม่คืน)",
  payable: "รอเจ้าของยืนยัน",
  paid: "ชำระแล้ว — รอโอน",
  disbursed: "โอนให้ผู้พบแล้ว",
  donated: "ผู้พบบริจาคให้โครงการ",
  cancelled: "ยกเลิก",
};

export const FINDER_CHOICE_TH: Record<FinderChoice, string> = {
  receive: "รับสินน้ำใจ",
  donate: "มอบให้โครงการ",
};

export const FUNDING_KIND_TH: Record<FundingKind, string> = {
  institution_subscription: "ค่าบำรุงระบบจากสถาบัน/หน่วยงาน",
  partner_sponsorship: "ค่าสนับสนุนจากพันธมิตร",
  donation: "เงินบริจาค",
};

export const VOUCHER_STATUS_TH: Record<VoucherStatus, string> = {
  issued: "ใช้ได้",
  redeemed: "ใช้แล้ว",
  revoked: "ถูกยกเลิก",
  expired: "หมดอายุ",
};

export const VOUCHER_REDEEM_TH: Record<VoucherRedeemResult, { ok: boolean; message: string }> = {
  redeemed: { ok: true, message: "ใช้คูปองเรียบร้อย" },
  already_redeemed: { ok: false, message: "คูปองนี้ถูกใช้ไปแล้ว" },
  revoked: { ok: false, message: "คูปองนี้ถูกยกเลิก" },
  expired: { ok: false, message: "คูปองหมดอายุแล้ว" },
  not_found: { ok: false, message: "ไม่พบรหัสคูปองนี้" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Same formula as public.reward_fee(): max(amount × %, floor), never above the amount. */
export function feeFor(amount: number, feePercent: number, feeMin: number): { fee: number; finder: number } {
  const fee = Math.min(amount, Math.max(round2((amount * feePercent) / 100), feeMin));
  return { fee: round2(fee), finder: round2(amount - fee) };
}

export function formatBaht(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : n ?? 0;
  return `${v.toLocaleString("th-TH", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} บาท`;
}

/** Whole baht within the configured range. */
export function validRewardAmount(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,6}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}
