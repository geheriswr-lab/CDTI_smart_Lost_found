import Link from "next/link";
import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { bangkokToday } from "@/lib/reports/validation";
import { formatThaiDate, formatThaiDateTime } from "@/lib/reports/labels";
import { getPlatformSettings } from "@/lib/se/queries";
import { FUNDING_KIND_TH, REWARD_STATUS_STAFF, FINDER_CHOICE_TH, formatBaht, type FundingKind } from "@/lib/se/labels";
import { CancelRewardForm, FundingForm, SettingsForm, SettleForm, VoidFundingForm } from "@/components/se/se-forms";

export const metadata = { title: "Social Enterprise — Admin" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

// Phase 13 — Social Enterprise dashboard: thank-you fees, institution
// subscription, partner sponsorship. Staff view + settle; admin records income
// and changes settings. Aggregates and item names only — no identities.
export default async function SePage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const me = await requireStaffOrAdmin();
  const isAdmin = me.role === "admin";
  const today = bangkokToday();
  const to = DATE_RE.test(searchParams.to ?? "") ? searchParams.to! : today;
  let from = DATE_RE.test(searchParams.from ?? "") ? searchParams.from! : `${today.slice(0, 4)}-01-01`;
  if (from > to) from = to;

  const supabase = await createClient();
  const [{ data: summary }, { data: rewards }, { data: funding }, { data: partners }, settings] = await Promise.all([
    supabase.rpc("se_summary", { p_from: from, p_to: to }),
    supabase
      .from("rewards")
      .select("id, lost_item_id, claim_id, amount, fee_amount, finder_amount, status, finder_choice, payment_ref, created_at, paid_at")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("funding_records").select("*").order("received_on", { ascending: false }).limit(100),
    supabase.from("partners").select("id, name").order("name"),
    getPlatformSettings(),
  ]);
  const s = (summary ?? {}) as Record<string, number | Record<string, number>>;
  const num = (k: string) => Number(s[k] ?? 0);
  const fundingBy = (s.funding ?? {}) as Record<string, number>;
  const totalIncome = num("fee_income") + num("donated_to_project") + Object.values(fundingBy).reduce((a, b) => a + Number(b), 0);

  // item names for the rewards table (staff can read items through RLS)
  const lostIds = [...new Set((rewards ?? []).map((r) => r.lost_item_id).filter((x): x is string => !!x))];
  const claimIds = [...new Set((rewards ?? []).map((r) => r.claim_id).filter((x): x is string => !!x))];
  const [{ data: lostNames }, { data: claimRows }] = await Promise.all([
    lostIds.length ? supabase.from("lost_items").select("id, item_name").in("id", lostIds) : Promise.resolve({ data: [] }),
    claimIds.length ? supabase.from("claims").select("id, found_item_id").in("id", claimIds) : Promise.resolve({ data: [] }),
  ]);
  const foundIds = [...new Set((claimRows ?? []).map((c) => c.found_item_id))];
  const { data: foundNames } = foundIds.length
    ? await supabase.from("found_items").select("id, general_name").in("id", foundIds)
    : { data: [] as { id: string; general_name: string }[] };
  const lostName = new Map((lostNames ?? []).map((l) => [l.id, l.item_name]));
  const foundName = new Map((foundNames ?? []).map((f) => [f.id, f.general_name]));
  const claimFound = new Map((claimRows ?? []).map((c) => [c.id, c.found_item_id]));
  const itemName = (r: { lost_item_id: string | null; claim_id: string | null }) =>
    (r.claim_id ? foundName.get(claimFound.get(r.claim_id) ?? "") : null) ?? lostName.get(r.lost_item_id ?? "") ?? "-";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cdti-700">Social Enterprise — รายได้และผลลัพธ์</h1>
          <p className="text-sm text-gray-600">
            บริการคืนของฟรีเสมอ · รายได้มาจากค่าดำเนินการสินน้ำใจ (สมัครใจ), ค่าบำรุงระบบจากสถาบัน และพันธมิตร ·{" "}
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">การชำระเงิน: โหมดสาธิต</span>
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-xs">
          <label>ตั้งแต่<input type="date" name="from" defaultValue={from} className="ml-1 rounded-md border border-gray-300 px-2 py-1" /></label>
          <label>ถึง<input type="date" name="to" defaultValue={to} className="ml-1 rounded-md border border-gray-300 px-2 py-1" /></label>
          <button className="rounded-md bg-white px-3 py-1.5 shadow-sm hover:bg-cdti-50">แสดง</button>
        </form>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="รายได้รวมของโครงการ" value={formatBaht(totalIncome)} hint={`${formatThaiDate(from)} – ${formatThaiDate(to)}`} />
        <Tile label="ค่าดำเนินการจากสินน้ำใจ" value={formatBaht(num("fee_income"))} hint={`${Number(settings.reward_fee_percent)}% ของสินน้ำใจที่ยืนยันแล้ว`} />
        <Tile label="ค่าบำรุงระบบจากสถาบัน" value={formatBaht(fundingBy.institution_subscription ?? 0)} />
        <Tile label="ค่าสนับสนุนจากพันธมิตร" value={formatBaht(fundingBy.partner_sponsorship ?? 0)} hint={`พันธมิตรที่ใช้งาน ${num("active_partners")} ราย`} />
        <Tile label="ของที่คืนสำเร็จ" value={String(num("returns"))} hint={`มีสินน้ำใจ ${num("returns_with_reward")} รายการ`} />
        <Tile label="สินน้ำใจถึงมือผู้พบ" value={formatBaht(num("to_finders"))} />
        <Tile label="ผู้พบมอบให้โครงการ" value={formatBaht(num("donated_to_project"))} />
        <Tile label="คูปองพันธมิตร (ออก / ใช้)" value={`${num("vouchers_issued")} / ${num("vouchers_redeemed")}`} />
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-cdti-700">สินน้ำใจ</h2>
          <p className="text-xs text-gray-500">
            ตั้งไว้ยังไม่คืน {num("pledges_open")} รายการ ({formatBaht(num("pledged_amount_open"))}) · รอเจ้าของยืนยัน {num("rewards_payable")} · รอโอน{" "}
            {num("awaiting_settlement")}
          </p>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          ไม่แสดงชื่อเจ้าของ/ผู้พบ · การตรวจคำขอและการส่งมอบไม่ดูข้อมูลส่วนนี้ · &quot;รอโอน&quot; = เจ้าของยืนยันแล้ว เจ้าหน้าที่โอนให้ผู้พบ (หรือบันทึกเป็นเงินบริจาคถ้าผู้พบเลือก)
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="py-2 pr-3">รายการ</th>
                <th className="py-2 pr-3">จำนวน</th>
                <th className="py-2 pr-3">ค่าดำเนินการ / ผู้พบ</th>
                <th className="py-2 pr-3">สถานะ</th>
                <th className="py-2">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(rewards ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">
                    {itemName(r)}
                    <span className="block text-xs text-gray-400">{formatThaiDateTime(r.created_at)}</span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatBaht(r.amount)}</td>
                  <td className="py-2 pr-3 text-xs tabular-nums">
                    {r.fee_amount !== null ? `${formatBaht(r.fee_amount)} / ${formatBaht(r.finder_amount)}` : "-"}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {REWARD_STATUS_STAFF[r.status]}
                    {r.finder_choice && <span className="block text-gray-500">ผู้พบเลือก: {FINDER_CHOICE_TH[r.finder_choice]}</span>}
                    {r.payment_ref && <span className="block font-mono text-gray-400">{r.payment_ref}</span>}
                  </td>
                  <td className="space-y-1 py-2">
                    {r.status === "paid" && <SettleForm rewardId={r.id} choice={r.finder_choice} />}
                    {isAdmin && ["pledged", "payable", "paid"].includes(r.status) && <CancelRewardForm rewardId={r.id} />}
                  </td>
                </tr>
              ))}
              {(rewards ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-400">ยังไม่มีสินน้ำใจ</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">รายได้อื่น (ค่าบำรุงระบบ / พันธมิตร / บริจาค)</h2>
        <p className="text-xs text-gray-500">บันทึกเพิ่มได้อย่างเดียว แก้ไขไม่ได้ — ถ้าบันทึกผิดให้ &quot;ยกเลิกรายการ&quot; พร้อมเหตุผล (มีใน Audit log)</p>
        {isAdmin && (
          <div className="mt-3 rounded-md bg-gray-50 p-3">
            <FundingForm partners={partners ?? []} today={today} />
          </div>
        )}
        <ul className="mt-3 divide-y text-sm">
          {(funding ?? []).map((f) => (
            <li key={f.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${f.is_void ? "opacity-50" : ""}`}>
              <span>
                <span className="font-medium">{f.source_name}</span> · {FUNDING_KIND_TH[f.kind as FundingKind]}
                <span className="block text-xs text-gray-500">
                  รับ {formatThaiDate(f.received_on)}
                  {f.period_start && ` · ช่วง ${formatThaiDate(f.period_start)} – ${formatThaiDate(f.period_end)}`}
                  {f.note && ` · ${f.note}`}
                  {f.is_void && ` · ยกเลิก: ${f.void_reason}`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className={`tabular-nums ${f.is_void ? "line-through" : ""}`}>{formatBaht(f.amount)}</span>
                {isAdmin && !f.is_void && <VoidFundingForm id={f.id} />}
              </span>
            </li>
          ))}
          {(funding ?? []).length === 0 && <li className="py-3 text-center text-gray-400">ยังไม่มีรายการ</li>}
        </ul>
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-cdti-700">การตั้งค่า</h2>
        <p className="text-xs text-gray-500">
          ค่าดำเนินการ = max(สินน้ำใจ × %, ขั้นต่ำ) ใช้กับสินน้ำใจที่เกิดหลังจากแก้เท่านั้น · ปรับเพื่อทดสอบสมมติฐานทางธุรกิจได้ ·{" "}
          <Link href="/impact" className="text-cdti-600 hover:underline">ดูหน้าสาธารณะ</Link>
        </p>
        <div className="mt-3">
          {isAdmin ? (
            <SettingsForm settings={settings} />
          ) : (
            <p className="text-sm">
              ค่าดำเนินการ {Number(settings.reward_fee_percent)}% (ขั้นต่ำ {formatBaht(settings.reward_fee_min)}) · สินน้ำใจ {settings.reward_min}–
              {settings.reward_max} บาท · คูปอง {settings.vouchers_per_finder_30d} ใบ/ผู้พบ/30 วัน
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
