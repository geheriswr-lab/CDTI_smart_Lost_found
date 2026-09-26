"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireProfile, requireStaffOrAdmin } from "@/lib/auth/session";
import { VOUCHER_REDEEM_TH, type FundingKind, type VoucherRedeemResult } from "@/lib/se/labels";

// Phase 13 — Social Enterprise actions. Every rule is re-checked inside the
// SECURITY DEFINER functions of 0028; these only validate shape and map errors.

export type SeState = { error: string | null; ok: boolean; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (error: string): SeState => ({ error, ok: false });

function seError(m: string | undefined): string {
  const s = m ?? "";
  if (s.includes("REWARD_INVALID")) {
    const range = s.match(/between (\d+) and (\d+)/);
    return range ? `จำนวนเงินต้องเป็นจำนวนเต็ม ${range[1]}–${range[2]} บาท` : "ข้อมูลไม่ถูกต้อง";
  }
  if (s.includes("REWARD_CLOSED")) return "รายการนี้ปิดแล้ว หรือพ้นระยะเวลาที่ให้สินน้ำใจได้";
  if (s.includes("REWARD_EXISTS")) return "มีสินน้ำใจสำหรับคำขอนี้อยู่แล้ว";
  if (s.includes("REWARD_CONFLICT") || s.includes("VOUCHER_CONFLICT")) return "ดำเนินการกับรายการที่เกี่ยวกับตัวคุณเองไม่ได้";
  if (s.includes("FORBIDDEN")) return "คุณไม่มีสิทธิ์ดำเนินการนี้";
  if (s.includes("INVALID")) return "ข้อมูลไม่ถูกต้อง";
  return "ไม่สามารถดำเนินการได้ กรุณาลองใหม่";
}

function wholeBaht(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  return /^\d{1,6}$/.test(s) ? Number(s) : null;
}

// ---------- Owner ----------
export async function pledgeRewardAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireProfile();
  const lostId = String(formData.get("lost_item_id") ?? "");
  const amount = wholeBaht(formData.get("amount") === "custom" ? formData.get("custom_amount") : formData.get("amount"));
  if (!UUID_RE.test(lostId)) return bad("ข้อมูลไม่ถูกต้อง");
  if (amount === null) return bad("กรุณาใส่จำนวนเงินเป็นจำนวนเต็ม (บาท)");
  const supabase = await createClient();
  const { error } = await supabase.rpc("pledge_reward", { p_lost_item_id: lostId, p_amount: amount });
  if (error) return bad(seError(error.message));
  revalidatePath(`/dashboard/lost/${lostId}`);
  return { error: null, ok: true, message: "บันทึกสินน้ำใจแล้ว" };
}

export async function cancelPledgeAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireProfile();
  const id = String(formData.get("reward_id") ?? "");
  const lostId = String(formData.get("lost_item_id") ?? "");
  if (!UUID_RE.test(id)) return bad("ข้อมูลไม่ถูกต้อง");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_reward_pledge", { p_reward_id: id });
  if (error) return bad(seError(error.message));
  if (UUID_RE.test(lostId)) revalidatePath(`/dashboard/lost/${lostId}`);
  return { error: null, ok: true, message: "ยกเลิกสินน้ำใจแล้ว" };
}

export async function offerRewardAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireProfile();
  const claimId = String(formData.get("claim_id") ?? "");
  const amount = wholeBaht(formData.get("amount") === "custom" ? formData.get("custom_amount") : formData.get("amount"));
  if (!UUID_RE.test(claimId)) return bad("ข้อมูลไม่ถูกต้อง");
  if (amount === null) return bad("กรุณาใส่จำนวนเงินเป็นจำนวนเต็ม (บาท)");
  const supabase = await createClient();
  const { error } = await supabase.rpc("offer_reward_after_return", { p_claim_id: claimId, p_amount: amount });
  if (error) return bad(seError(error.message));
  revalidatePath(`/claims/${claimId}`);
  return { error: null, ok: true, message: "บันทึกแล้ว กดยืนยันการมอบด้านล่างเมื่อพร้อม" };
}

export async function payRewardDemoAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireProfile();
  const id = String(formData.get("reward_id") ?? "");
  const back = String(formData.get("return_to") ?? "");
  if (!UUID_RE.test(id)) return bad("ข้อมูลไม่ถูกต้อง");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pay_reward_demo", { p_reward_id: id });
  if (error) return bad(seError(error.message));
  if (/^\/(claims|dashboard)\/[\w/-]*$/.test(back)) revalidatePath(back);
  revalidatePath("/dashboard/rewards");
  return { error: null, ok: true, message: `ยืนยันการมอบแล้ว (โหมดสาธิต — ไม่มีการตัดเงินจริง) เลขอ้างอิง ${data}` };
}

// ---------- Finder ----------
export async function setRewardChoiceAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireProfile();
  const id = String(formData.get("reward_id") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!UUID_RE.test(id) || (choice !== "receive" && choice !== "donate")) return bad("ข้อมูลไม่ถูกต้อง");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_reward_choice", { p_reward_id: id, p_choice: choice });
  if (error) return bad(seError(error.message));
  revalidatePath("/dashboard/rewards");
  return { error: null, ok: true, message: choice === "donate" ? "ขอบคุณที่สนับสนุนโครงการ" : "บันทึกแล้ว" };
}

// ---------- Staff ----------
export async function settleRewardAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireStaffOrAdmin();
  const id = String(formData.get("reward_id") ?? "");
  if (!UUID_RE.test(id)) return bad("ข้อมูลไม่ถูกต้อง");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_reward", { p_reward_id: id });
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/se");
  return { error: null, ok: true, message: data === "donated" ? "บันทึกเป็นเงินบริจาคเข้าโครงการ" : "บันทึกการโอนให้ผู้พบแล้ว" };
}

export async function cancelRewardAdminAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireAdmin();
  const id = String(formData.get("reward_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID_RE.test(id)) return bad("ข้อมูลไม่ถูกต้อง");
  if (reason.length < 3 || reason.length > 500) return bad("กรุณาระบุเหตุผล");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_reward_admin", { p_reward_id: id, p_reason: reason });
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/se");
  return { error: null, ok: true, message: "ยกเลิกแล้ว" };
}

export async function redeemVoucherAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireStaffOrAdmin();
  const code = String(formData.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z2-9]{8}$/.test(code)) return bad("รหัสคูปองมี 8 ตัวอักษร");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_perk_voucher", { p_code: code });
  if (error) return bad(seError(error.message));
  const r = VOUCHER_REDEEM_TH[(data as VoucherRedeemResult) ?? "not_found"] ?? VOUCHER_REDEEM_TH.not_found;
  revalidatePath("/admin/partners");
  return r.ok ? { error: null, ok: true, message: r.message } : bad(r.message);
}

export async function revokeVoucherAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireAdmin();
  const id = String(formData.get("voucher_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID_RE.test(id)) return bad("ข้อมูลไม่ถูกต้อง");
  if (reason.length < 3) return bad("กรุณาระบุเหตุผล");
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_perk_voucher", { p_voucher_id: id, p_reason: reason });
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/partners");
  return { error: null, ok: true, message: "ยกเลิกคูปองแล้ว" };
}

// ---------- Admin: funding, settings, partners ----------
const KINDS: FundingKind[] = ["institution_subscription", "partner_sponsorship", "donation"];

export async function recordFundingAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireAdmin();
  const kind = String(formData.get("kind") ?? "") as FundingKind;
  const source = String(formData.get("source_name") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const receivedOn = String(formData.get("received_on") ?? "");
  const ps = String(formData.get("period_start") ?? "");
  const pe = String(formData.get("period_end") ?? "");
  const partnerId = String(formData.get("partner_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!KINDS.includes(kind)) return bad("กรุณาเลือกประเภทรายได้");
  if (source.length < 2 || source.length > 200) return bad("กรุณาระบุแหล่งที่มา");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return bad("จำนวนเงินไม่ถูกต้อง");
  if (!DATE_RE.test(receivedOn)) return bad("กรุณาระบุวันที่รับเงิน");
  if ((ps && !DATE_RE.test(ps)) || (pe && !DATE_RE.test(pe))) return bad("ช่วงเวลาไม่ถูกต้อง");
  if (note.length > 500) return bad("หมายเหตุยาวเกินไป");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_funding", {
    p_kind: kind,
    p_source_name: source,
    p_amount: Math.round(amount * 100) / 100,
    p_received_on: receivedOn,
    p_period_start: ps || null,
    p_period_end: pe || null,
    p_partner_id: UUID_RE.test(partnerId) ? partnerId : null,
    p_note: note || null,
  });
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/se");
  return { error: null, ok: true, message: "บันทึกรายได้แล้ว" };
}

export async function voidFundingAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID_RE.test(id)) return bad("ข้อมูลไม่ถูกต้อง");
  if (reason.length < 3) return bad("กรุณาระบุเหตุผล");
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_funding", { p_id: id, p_reason: reason });
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/se");
  return { error: null, ok: true, message: "ยกเลิกรายการแล้ว" };
}

export async function saveSettingsAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireAdmin();
  const num = (k: string) => Number(String(formData.get(k) ?? "").trim());
  const v = {
    p_fee_percent: num("fee_percent"),
    p_fee_min: num("fee_min"),
    p_reward_min: num("reward_min"),
    p_reward_max: num("reward_max"),
    p_offer_days: num("offer_days"),
    p_vouchers_per_finder: num("vouchers_per_finder"),
  };
  if (Object.values(v).some((x) => !Number.isFinite(x) || x < 0)) return bad("ตัวเลขไม่ถูกต้อง");
  if (v.p_fee_percent > 20) return bad("ค่าดำเนินการต้องไม่เกิน 20%");
  if (![v.p_reward_min, v.p_reward_max, v.p_offer_days, v.p_vouchers_per_finder].every(Number.isInteger)) return bad("ช่องจำนวนต้องเป็นจำนวนเต็ม");
  if (v.p_reward_min < 1 || v.p_reward_min > v.p_reward_max) return bad("ช่วงจำนวนสินน้ำใจไม่ถูกต้อง");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_platform_settings", v);
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/se");
  return { error: null, ok: true, message: "บันทึกการตั้งค่าแล้ว" };
}

export async function savePartnerAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();
  const internalNote = String(formData.get("internal_note") ?? "").trim();
  const isActive = formData.get("is_active") !== "false";
  if (name.length < 2 || name.length > 120) return bad("ชื่อพันธมิตร 2–120 ตัวอักษร");
  if (description.length > 500 || internalNote.length > 1000) return bad("ข้อความยาวเกินไป");
  if (website && !/^https:\/\/\S{4,}$/.test(website)) return bad("เว็บไซต์ต้องขึ้นต้นด้วย https://");
  const row = { name, description: description || null, website: website || null, internal_note: internalNote || null, is_active: isActive };
  const supabase = await createClient();
  const { error } = UUID_RE.test(id)
    ? await supabase.from("partners").update(row).eq("id", id)
    : await supabase.from("partners").insert(row);
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/partners");
  return { error: null, ok: true, message: "บันทึกแล้ว" };
}

export async function savePerkAction(_prev: SeState, formData: FormData): Promise<SeState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const partnerId = String(formData.get("partner_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const quotaRaw = String(formData.get("quota") ?? "").trim();
  const validDays = Number(String(formData.get("valid_days") ?? "60"));
  const isActive = formData.get("is_active") !== "false";
  if (!UUID_RE.test(partnerId) && !UUID_RE.test(id)) return bad("ข้อมูลไม่ถูกต้อง");
  if (name.length < 2 || name.length > 120) return bad("ชื่อสิทธิประโยชน์ 2–120 ตัวอักษร");
  if (quotaRaw && !/^\d{1,6}$/.test(quotaRaw)) return bad("จำนวนสิทธิ์ต้องเป็นจำนวนเต็ม");
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 365) return bad("อายุคูปอง 1–365 วัน");
  const row = { name, description: description || null, quota: quotaRaw ? Number(quotaRaw) : null, valid_days: validDays, is_active: isActive };
  const supabase = await createClient();
  const { error } = UUID_RE.test(id)
    ? await supabase.from("partner_perks").update(row).eq("id", id)
    : await supabase.from("partner_perks").insert({ ...row, partner_id: partnerId });
  if (error) return bad(seError(error.message));
  revalidatePath("/admin/partners");
  return { error: null, ok: true, message: "บันทึกแล้ว" };
}
