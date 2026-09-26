import Link from "next/link";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { FinderChoiceForm, PayDemoForm } from "@/components/se/se-forms";
import { formatThaiDate, formatThaiDateTime } from "@/lib/reports/labels";
import { FINDER_CHOICE_TH, REWARD_NAME, REWARD_STATUS_FINDER, REWARD_STATUS_OWNER, VOUCHER_STATUS_TH, formatBaht } from "@/lib/se/labels";

export const metadata = { title: "สินน้ำใจและสิทธิประโยชน์ — CDTI Smart Lost & Found" };

// Phase 13: a user's thank-yous (as owner or finder) and partner vouchers.
// Data comes from my_rewards() / my_vouchers(): no names or ids of the other party.
export default async function MyRewardsPage() {
  await requireProfile();
  const supabase = await createClient();
  const [{ data: rewards }, { data: vouchers }] = await Promise.all([supabase.rpc("my_rewards"), supabase.rpc("my_vouchers")]);
  const received = (rewards ?? []).filter((r) => r.my_role === "finder");
  const given = (rewards ?? []).filter((r) => r.my_role === "owner" && r.status !== "cancelled");

  return (
    <div className="space-y-5">
      <Link href="/dashboard" className="text-sm text-cdti-600 hover:underline">
        ← กลับแดชบอร์ด
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">สินน้ำใจและสิทธิประโยชน์</h1>
        <p className="text-sm text-gray-600">
          ระบบคืนของใช้ฟรีเสมอ · {REWARD_NAME}เป็นความสมัครใจของเจ้าของ และจะเกิดขึ้นหลังคืนของสำเร็จเท่านั้น ·{" "}
          <Link href="/impact" className="text-cdti-600 hover:underline">
            โครงการนำรายได้ไปใช้อย่างไร
          </Link>
        </p>
      </div>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">สิทธิประโยชน์จากผู้สนับสนุน</h2>
        <p className="text-xs text-gray-500">ได้รับเมื่อของที่คุณแจ้งพบถูกส่งคืนเจ้าของสำเร็จ แสดงรหัสนี้เพื่อใช้สิทธิ์</p>
        {(vouchers ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">ยังไม่มีสิทธิประโยชน์</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {(vouchers ?? []).map((v) => (
              <li key={v.id} className={`rounded-md border p-3 ${v.status === "issued" ? "border-green-200 bg-green-50/50" : "border-gray-200 opacity-70"}`}>
                <p className="font-medium">{v.perk_name}</p>
                <p className="text-xs text-gray-600">{v.partner_name}{v.perk_description ? ` · ${v.perk_description}` : ""}</p>
                <p className="mt-2 font-mono text-xl tracking-[0.3em] text-cdti-700">{v.code}</p>
                <p className="text-xs text-gray-500">
                  {VOUCHER_STATUS_TH[v.status]} · ใช้ได้ถึง {formatThaiDate(v.expires_at.slice(0, 10))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">{REWARD_NAME}ที่ได้รับ</h2>
        <p className="text-xs text-gray-500">เลือกได้ว่าจะรับเอง หรือมอบให้โครงการเพื่อดูแลระบบต่อ</p>
        {received.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">ยังไม่มี</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {received.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="font-medium">{r.item_name}</span>
                  <span className="block text-xs text-gray-500">
                    {formatBaht(r.finder_amount)} (จาก {formatBaht(r.amount)} หักค่าดำเนินการ {formatBaht(r.fee_amount)}) ·{" "}
                    {REWARD_STATUS_FINDER[r.status]}
                    {r.finder_choice && ` · เลือก: ${FINDER_CHOICE_TH[r.finder_choice]}`}
                  </span>
                </span>
                {(r.status === "payable" || r.status === "paid") && <FinderChoiceForm rewardId={r.id} current={r.finder_choice} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">{REWARD_NAME}ที่ฉันตั้งไว้</h2>
        {given.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">ยังไม่มี — ตั้งได้ที่หน้ารายการของหายของคุณ (ไม่บังคับ)</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {given.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <p>
                  <span className="font-medium">{r.item_name}</span> · {formatBaht(r.amount)}
                </p>
                <p className="text-xs text-gray-500">
                  {REWARD_STATUS_OWNER[r.status]} · {formatThaiDateTime(r.created_at)}
                  {r.payment_ref && ` · เลขอ้างอิง ${r.payment_ref}`}
                </p>
                {r.status === "payable" && <PayDemoForm rewardId={r.id} returnTo="/dashboard/rewards" />}
                {r.status === "pledged" && r.lost_item_id && (
                  <Link href={`/dashboard/lost/${r.lost_item_id}#reward`} className="text-xs text-cdti-600 hover:underline">
                    เปลี่ยน / ยกเลิก
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
