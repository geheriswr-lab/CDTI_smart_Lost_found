"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  cancelPledgeAction,
  cancelRewardAdminAction,
  offerRewardAction,
  payRewardDemoAction,
  pledgeRewardAction,
  recordFundingAction,
  redeemVoucherAction,
  revokeVoucherAction,
  savePartnerAction,
  savePerkAction,
  saveSettingsAction,
  setRewardChoiceAction,
  settleRewardAction,
  voidFundingAction,
  type SeState,
} from "@/lib/actions/se";
import { FUNDING_KIND_TH, REWARD_PRESETS, feeFor, formatBaht, type FundingKind, type PlatformSettings } from "@/lib/se/labels";
import type { Partner, PartnerPerk } from "@/types/database.types";

const initial: SeState = { error: null, ok: false };
const input = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";

function Submit({ label, tone = "primary", small }: { label: string; tone?: "primary" | "plain" | "danger"; small?: boolean }) {
  const { pending } = useFormStatus();
  const cls =
    tone === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : tone === "plain"
        ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        : "bg-cdti-600 text-white hover:bg-cdti-700";
  return (
    <button type="submit" disabled={pending} className={`rounded-md ${small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"} disabled:opacity-60 ${cls}`}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

function Result({ state }: { state: SeState }) {
  if (state.error) return <p className="text-xs text-red-600">{state.error}</p>;
  if (state.ok && state.message) return <p className="text-xs text-green-700">{state.message}</p>;
  return null;
}

/** Amount picker (presets + custom) with a live fee preview. */
function AmountPicker({ settings, defaultAmount }: { settings: PlatformSettings; defaultAmount?: number }) {
  const preset = defaultAmount && (REWARD_PRESETS as readonly number[]).includes(defaultAmount) ? String(defaultAmount) : defaultAmount ? "custom" : "300";
  const [choice, setChoice] = useState(preset);
  const [custom, setCustom] = useState(defaultAmount && preset === "custom" ? String(defaultAmount) : "");
  const amount = choice === "custom" ? Number(custom) : Number(choice);
  const valid = Number.isInteger(amount) && amount >= settings.reward_min && amount <= settings.reward_max;
  const split = valid ? feeFor(amount, Number(settings.reward_fee_percent), Number(settings.reward_fee_min)) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="จำนวนสินน้ำใจ">
        {REWARD_PRESETS.map((p) => (
          <label key={p} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${choice === String(p) ? "border-cdti-600 bg-cdti-50 text-cdti-700" : "border-gray-300"}`}>
            <input type="radio" name="amount" value={p} checked={choice === String(p)} onChange={() => setChoice(String(p))} className="sr-only" />
            {p} บาท
          </label>
        ))}
        <label className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${choice === "custom" ? "border-cdti-600 bg-cdti-50 text-cdti-700" : "border-gray-300"}`}>
          <input type="radio" name="amount" value="custom" checked={choice === "custom"} onChange={() => setChoice("custom")} className="sr-only" />
          ระบุเอง
        </label>
        {choice === "custom" && (
          <input
            name="custom_amount"
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
            placeholder={`${settings.reward_min}–${settings.reward_max}`}
            aria-label="จำนวนเงิน (บาท)"
            className={`${input} w-28`}
          />
        )}
      </div>
      <p className="text-xs text-gray-500">
        {split
          ? `ผู้พบได้รับ ${formatBaht(split.finder)} · ค่าดำเนินการระบบ ${formatBaht(split.fee)} (${Number(settings.reward_fee_percent)}%) ใช้ดูแลและพัฒนาระบบ`
          : `จำนวนเต็ม ${settings.reward_min}–${settings.reward_max} บาท`}
      </p>
    </div>
  );
}

// ---------- Owner ----------
export function PledgeForm({ lostItemId, settings, pledge }: { lostItemId: string; settings: PlatformSettings; pledge?: { id: string; amount: number } | null }) {
  const [state, action] = useFormState(pledgeRewardAction, initial);
  const [cState, cancel] = useFormState(cancelPledgeAction, initial);
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-2">
        <input type="hidden" name="lost_item_id" value={lostItemId} />
        <AmountPicker settings={settings} defaultAmount={pledge?.amount} />
        <div className="flex items-center gap-2">
          <Submit label={pledge ? "เปลี่ยนจำนวน" : "ตั้งสินน้ำใจ"} />
          <Result state={state} />
        </div>
      </form>
      {pledge && (
        <form action={cancel} className="flex items-center gap-2">
          <input type="hidden" name="reward_id" value={pledge.id} />
          <input type="hidden" name="lost_item_id" value={lostItemId} />
          <Submit label="ยกเลิกสินน้ำใจ" tone="plain" small />
          <Result state={cState} />
        </form>
      )}
    </div>
  );
}

export function OfferRewardForm({ claimId, settings }: { claimId: string; settings: PlatformSettings }) {
  const [state, action] = useFormState(offerRewardAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="claim_id" value={claimId} />
      <AmountPicker settings={settings} />
      <div className="flex items-center gap-2">
        <Submit label="มอบสินน้ำใจ" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function PayDemoForm({ rewardId, returnTo }: { rewardId: string; returnTo: string }) {
  const [state, action] = useFormState(payRewardDemoAction, initial);
  if (state.ok) return <p className="rounded-md bg-green-50 p-2 text-sm text-green-800">{state.message}</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reward_id" value={rewardId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <Submit label="ยืนยันการมอบ (โหมดสาธิต)" />
      <span className="text-xs text-amber-700">ระบบยังไม่เชื่อมการชำระเงินจริง — ไม่มีการตัดเงิน</span>
      <Result state={state} />
    </form>
  );
}

// ---------- Finder ----------
export function FinderChoiceForm({ rewardId, current }: { rewardId: string; current: "receive" | "donate" | null }) {
  const [state, action] = useFormState(setRewardChoiceAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reward_id" value={rewardId} />
      <button name="choice" value="receive" className={`rounded-md px-2.5 py-1 text-xs ${current === "receive" ? "bg-cdti-600 text-white" : "border border-gray-300"}`}>
        รับสินน้ำใจ
      </button>
      <button name="choice" value="donate" className={`rounded-md px-2.5 py-1 text-xs ${current === "donate" ? "bg-green-700 text-white" : "border border-gray-300"}`}>
        มอบให้โครงการ
      </button>
      <Result state={state} />
    </form>
  );
}

// ---------- Staff / admin ----------
export function SettleForm({ rewardId, choice }: { rewardId: string; choice: "receive" | "donate" | null }) {
  const [state, action] = useFormState(settleRewardAction, initial);
  if (state.ok) return <Result state={state} />;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="reward_id" value={rewardId} />
      <Submit label={choice === "donate" ? "บันทึกเป็นเงินบริจาค" : "บันทึกว่าโอนให้ผู้พบแล้ว"} small />
      <Result state={state} />
    </form>
  );
}

export function CancelRewardForm({ rewardId }: { rewardId: string }) {
  const [state, action] = useFormState(cancelRewardAdminAction, initial);
  if (state.ok) return <Result state={state} />;
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="reward_id" value={rewardId} />
      <input name="reason" required minLength={3} maxLength={500} placeholder="เหตุผลที่ยกเลิก" className="w-36 rounded-md border border-gray-300 px-2 py-1 text-xs" />
      <Submit label="ยกเลิก" tone="plain" small />
      <Result state={state} />
    </form>
  );
}

export function RedeemVoucherForm() {
  const [state, action] = useFormState(redeemVoucherAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" key={state.ok ? state.message : "f"}>
      <label htmlFor="voucher-code" className="text-sm text-gray-700">รหัสคูปอง</label>
      <input id="voucher-code" name="code" required maxLength={12} autoComplete="off" placeholder="เช่น K7Q2M9XA" className={`${input} w-40 font-mono uppercase tracking-widest`} />
      <Submit label="ยืนยันการใช้คูปอง" />
      <Result state={state} />
    </form>
  );
}

export function RevokeVoucherForm({ voucherId }: { voucherId: string }) {
  const [state, action] = useFormState(revokeVoucherAction, initial);
  if (state.ok) return <Result state={state} />;
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="voucher_id" value={voucherId} />
      <input name="reason" required minLength={3} placeholder="เหตุผล" className="w-28 rounded-md border border-gray-300 px-2 py-1 text-xs" />
      <Submit label="ยกเลิกคูปอง" tone="plain" small />
      <Result state={state} />
    </form>
  );
}

export function FundingForm({ partners, today }: { partners: Pick<Partner, "id" | "name">[]; today: string }) {
  const [state, action] = useFormState(recordFundingAction, initial);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2" key={state.ok ? state.message : "f"}>
      <label className="text-xs text-gray-600">
        ประเภท
        <select name="kind" required defaultValue="" className={`${input} mt-1 w-full`}>
          <option value="" disabled>เลือก</option>
          {(Object.keys(FUNDING_KIND_TH) as FundingKind[]).map((k) => (
            <option key={k} value={k}>{FUNDING_KIND_TH[k]}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-600">
        จาก (ชื่อหน่วยงาน/ร้าน/ผู้บริจาค)
        <input name="source_name" required minLength={2} maxLength={200} className={`${input} mt-1 w-full`} />
      </label>
      <label className="text-xs text-gray-600">
        จำนวนเงิน (บาท)
        <input name="amount" required inputMode="decimal" className={`${input} mt-1 w-full`} />
      </label>
      <label className="text-xs text-gray-600">
        วันที่รับเงิน
        <input name="received_on" type="date" required defaultValue={today} className={`${input} mt-1 w-full`} />
      </label>
      <label className="text-xs text-gray-600">
        ครอบคลุมช่วง (ถ้ามี) ตั้งแต่
        <input name="period_start" type="date" className={`${input} mt-1 w-full`} />
      </label>
      <label className="text-xs text-gray-600">
        ถึง
        <input name="period_end" type="date" className={`${input} mt-1 w-full`} />
      </label>
      <label className="text-xs text-gray-600">
        พันธมิตร (ถ้าเป็นค่าสนับสนุน)
        <select name="partner_id" defaultValue="" className={`${input} mt-1 w-full`}>
          <option value="">-</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-600">
        หมายเหตุ (เช่น เลขที่ใบเสร็จ)
        <input name="note" maxLength={500} className={`${input} mt-1 w-full`} />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Submit label="บันทึกรายได้" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function VoidFundingForm({ id }: { id: string }) {
  const [state, action] = useFormState(voidFundingAction, initial);
  if (state.ok) return <Result state={state} />;
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input name="reason" required minLength={3} placeholder="เหตุผล" className="w-28 rounded-md border border-gray-300 px-2 py-1 text-xs" />
      <Submit label="ยกเลิกรายการ" tone="plain" small />
      <Result state={state} />
    </form>
  );
}

export function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const [state, action] = useFormState(saveSettingsAction, initial);
  const field = (name: string, label: string, value: number, step = "1") => (
    <label className="text-xs text-gray-600">
      {label}
      <input name={name} type="number" min="0" step={step} required defaultValue={value} className={`${input} mt-1 w-full`} />
    </label>
  );
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-3">
      {field("fee_percent", "ค่าดำเนินการ (%)", Number(settings.reward_fee_percent), "0.01")}
      {field("fee_min", "ค่าดำเนินการขั้นต่ำ (บาท)", Number(settings.reward_fee_min), "0.01")}
      {field("offer_days", "ให้สินน้ำใจหลังรับของได้ภายใน (วัน)", settings.reward_offer_days)}
      {field("reward_min", "สินน้ำใจต่ำสุด (บาท)", settings.reward_min)}
      {field("reward_max", "สินน้ำใจสูงสุด (บาท)", settings.reward_max)}
      {field("vouchers_per_finder", "คูปองต่อผู้พบ / 30 วัน", settings.vouchers_per_finder_30d)}
      <div className="flex items-center gap-2 sm:col-span-3">
        <Submit label="บันทึกการตั้งค่า" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function PartnerForm({ partner }: { partner?: Partner }) {
  const [state, action] = useFormState(savePartnerAction, initial);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2" key={state.ok && !partner ? state.message : "f"}>
      {partner && <input type="hidden" name="id" value={partner.id} />}
      <input name="name" required minLength={2} maxLength={120} defaultValue={partner?.name} placeholder="ชื่อร้าน/หน่วยงาน" className={input} />
      <input name="website" defaultValue={partner?.website ?? ""} placeholder="https://… (ถ้ามี)" className={input} />
      <input name="description" maxLength={500} defaultValue={partner?.description ?? ""} placeholder="คำอธิบายที่แสดงต่อสาธารณะ" className={`${input} sm:col-span-2`} />
      <input name="internal_note" maxLength={1000} defaultValue={partner?.internal_note ?? ""} placeholder="บันทึกภายใน เช่น ผู้ติดต่อ/เงื่อนไข (ไม่แสดงสาธารณะ)" className={`${input} sm:col-span-2`} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <label className="text-xs text-gray-600">
          <select name="is_active" defaultValue={partner?.is_active === false ? "false" : "true"} className={`${input} mr-1`}>
            <option value="true">แสดง/ใช้งาน</option>
            <option value="false">ปิดใช้งาน</option>
          </select>
        </label>
        <Submit label={partner ? "บันทึก" : "เพิ่มพันธมิตร"} small={!!partner} />
        <Result state={state} />
      </div>
    </form>
  );
}

export function PerkForm({ partnerId, perk }: { partnerId: string; perk?: PartnerPerk }) {
  const [state, action] = useFormState(savePerkAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" key={state.ok && !perk ? state.message : "f"}>
      {perk ? <input type="hidden" name="id" value={perk.id} /> : <input type="hidden" name="partner_id" value={partnerId} />}
      <input name="name" required minLength={2} maxLength={120} defaultValue={perk?.name} placeholder="เช่น คูปองส่วนลด 20 บาท" className={`${input} w-52`} />
      <input name="description" maxLength={500} defaultValue={perk?.description ?? ""} placeholder="เงื่อนไข" className={`${input} w-52`} />
      <input name="quota" inputMode="numeric" defaultValue={perk?.quota ?? ""} placeholder="จำนวนสิทธิ์ (ว่าง = ไม่จำกัด)" className={`${input} w-44`} />
      <input name="valid_days" type="number" min={1} max={365} defaultValue={perk?.valid_days ?? 60} aria-label="อายุคูปอง (วัน)" className={`${input} w-20`} />
      <select name="is_active" defaultValue={perk?.is_active === false ? "false" : "true"} className={input}>
        <option value="true">ใช้งาน</option>
        <option value="false">ปิด</option>
      </select>
      <Submit label={perk ? "บันทึก" : "เพิ่มสิทธิประโยชน์"} small />
      <Result state={state} />
    </form>
  );
}
