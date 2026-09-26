import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatThaiDateTime } from "@/lib/reports/labels";
import { VOUCHER_STATUS_TH } from "@/lib/se/labels";
import { PartnerForm, PerkForm, RedeemVoucherForm, RevokeVoucherForm } from "@/components/se/se-forms";

export const metadata = { title: "ผู้สนับสนุน — Admin" };

// Phase 13 — partners & perks (admin), voucher redemption (staff).
// Partners never receive user data: redemption happens here by code only.
export default async function PartnersPage() {
  const me = await requireStaffOrAdmin();
  const isAdmin = me.role === "admin";
  const supabase = await createClient();
  const [{ data: partners }, { data: perks }, { data: vouchers }] = await Promise.all([
    supabase.from("partners").select("*").order("created_at"),
    supabase.from("partner_perks").select("*").order("created_at"),
    supabase.from("perk_vouchers").select("id, perk_id, status, issued_at, expires_at, redeemed_at").order("issued_at", { ascending: false }).limit(50),
  ]);
  const perkName = new Map((perks ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">ผู้สนับสนุนและสิทธิประโยชน์</h1>
        <p className="text-sm text-gray-600">
          ร้านค้า/หน่วยงานที่สถาบันอนุมัติ สนับสนุนสิทธิประโยชน์ให้ผู้ที่ช่วยส่งคืนของ · ผู้พบได้คูปอง 1 ใบต่อการคืนสำเร็จ (มีจำกัดต่อ 30 วัน) ·
          การคืนของไม่ขึ้นกับผู้สนับสนุน · ไม่มีการส่งข้อมูลผู้ใช้ให้พันธมิตร
        </p>
      </div>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">ใช้คูปอง</h2>
        <p className="text-xs text-gray-500">ผู้พบแสดงรหัสจากหน้า &quot;สินน้ำใจและสิทธิประโยชน์&quot; → กรอกรหัสที่นี่ → แจ้งร้านว่าใช้สิทธิ์ได้</p>
        <div className="mt-3">
          <RedeemVoucherForm />
        </div>
      </section>

      <section className="space-y-4 rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">พันธมิตร</h2>
        {(partners ?? []).map((p) => {
          const own = (perks ?? []).filter((k) => k.partner_id === p.id);
          return (
            <div key={p.id} className={`rounded-md border p-3 ${p.is_active ? "border-gray-200" : "border-dashed border-gray-300 opacity-70"}`}>
              {isAdmin ? (
                <PartnerForm partner={p} />
              ) : (
                <p className="font-medium">
                  {p.name} {!p.is_active && <span className="text-xs text-gray-500">(ปิดใช้งาน)</span>}
                </p>
              )}
              <ul className="mt-3 space-y-2 border-t pt-2 text-sm">
                {own.map((k) => (
                  <li key={k.id}>
                    {isAdmin ? (
                      <PerkForm partnerId={p.id} perk={k} />
                    ) : (
                      <span>{k.name}</span>
                    )}
                    <span className="block text-xs text-gray-500">
                      ออกแล้ว {k.issued_count}
                      {k.quota !== null ? ` / ${k.quota}` : " (ไม่จำกัด)"} · อายุคูปอง {k.valid_days} วัน
                    </span>
                  </li>
                ))}
                {isAdmin && (
                  <li className="pt-1">
                    <PerkForm partnerId={p.id} />
                  </li>
                )}
              </ul>
            </div>
          );
        })}
        {(partners ?? []).length === 0 && <p className="text-sm text-gray-400">ยังไม่มีพันธมิตร</p>}
        {isAdmin && (
          <div className="rounded-md bg-gray-50 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">เพิ่มพันธมิตรใหม่ (เฉพาะที่สถาบันอนุมัติแล้ว)</p>
            <PartnerForm />
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">คูปองล่าสุด</h2>
        <ul className="mt-2 divide-y text-sm">
          {(vouchers ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {perkName.get(v.perk_id) ?? "-"}
                <span className="block text-xs text-gray-500">
                  ออก {formatThaiDateTime(v.issued_at)} · {VOUCHER_STATUS_TH[v.status === "issued" && v.expires_at <= new Date().toISOString() ? "expired" : v.status]}
                  {v.redeemed_at && ` · ใช้ ${formatThaiDateTime(v.redeemed_at)}`}
                </span>
              </span>
              {isAdmin && v.status === "issued" && <RevokeVoucherForm voucherId={v.id} />}
            </li>
          ))}
          {(vouchers ?? []).length === 0 && <li className="py-3 text-center text-gray-400">ยังไม่มีคูปอง</li>}
        </ul>
      </section>
    </div>
  );
}
