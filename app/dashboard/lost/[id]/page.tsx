import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { privateImageUrl, publicImageUrl } from "@/lib/reports/queries";
import { LOST_STATUS_TH, formatThaiDate, formatThaiDateTime } from "@/lib/reports/labels";
import { getMatchesForLostItem } from "@/lib/matching/queries";
import { LIKELIHOOD_TH } from "@/lib/matching/score";
import { DetailImage, DetailRow, PrivateCard, PublicCard } from "@/components/report/detail-parts";
import { PledgeForm } from "@/components/se/se-forms";
import { getPlatformSettings } from "@/lib/se/queries";
import { REWARD_NAME, REWARD_STATUS_OWNER, formatBaht } from "@/lib/se/labels";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Owner-only view of a lost report, including private fields. RLS already
// limits the row to owner/staff; the explicit reporter_id filter keeps this
// page strictly "my report" even for staff accounts.
export default async function MyLostItemPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("lost_items")
    .select("*")
    .eq("id", params.id)
    .eq("reporter_id", profile.id)
    .maybeSingle();
  if (!item) notFound();

  const [{ data: cat }, { data: loc }, pubUrl, privUrl, matches] = await Promise.all([
    item.category_id
      ? supabase.from("categories").select("name_th").eq("id", item.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
    item.location_id
      ? supabase.from("locations").select("name").eq("id", item.location_id).maybeSingle()
      : Promise.resolve({ data: null }),
    publicImageUrl(item.public_image_url),
    privateImageUrl(item.private_image_url),
    getMatchesForLostItem(item.id),
  ]);
  const [settings, { data: myRewards }] = await Promise.all([getPlatformSettings(), supabase.rpc("my_rewards")]);
  const rewardsHere = (myRewards ?? []).filter((r) => r.my_role === "owner" && r.lost_item_id === item.id && r.status !== "cancelled");
  const pledge = rewardsHere.find((r) => r.status === "pledged") ?? null;
  const settled = rewardsHere.find((r) => r.status !== "pledged") ?? null;
  const canPledge = ["reported", "matched", "claim_pending"].includes(item.status);

  return (
    <div className="space-y-4">
      <Link href="/dashboard" className="text-sm text-cdti-600 hover:underline">
        ← กลับแดชบอร์ด
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-cdti-700">{item.item_name}</h1>
        <span className="rounded-full bg-cdti-50 px-3 py-1 text-sm text-cdti-700">{LOST_STATUS_TH[item.status]}</span>
      </div>
      <p className="text-xs text-gray-500">แจ้งเมื่อ {formatThaiDateTime(item.created_at)}</p>

      <PublicCard>
        <DetailRow label="ประเภท" value={cat?.name_th} />
        <DetailRow label="สี" value={item.color} />
        <DetailRow label="วันที่ทำหาย" value={formatThaiDate(item.lost_date)} />
        <DetailRow label="สถานที่" value={loc?.name} />
        <DetailRow label="คำอธิบาย" value={item.description} />
        <DetailRow label="รูป" value={<DetailImage src={pubUrl} alt={item.item_name} />} />
      </PublicCard>

      <PrivateCard>
        <DetailRow label="ยี่ห้อ (ใช้จับคู่ ไม่แสดงในประกาศ)" value={item.brand} />
        <DetailRow label="รายละเอียดยืนยันความเป็นเจ้าของ" value={item.private_ownership_details} />
        <DetailRow label="รูปสำหรับตรวจสอบ" value={<DetailImage src={privUrl} alt="รูปสำหรับตรวจสอบ" />} />
      </PrivateCard>

      <section id="reward" className="rounded-lg border border-green-100 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-cdti-700">{REWARD_NAME} (ไม่บังคับ)</h2>
        <p className="mt-1 text-xs text-gray-500">
          ขอบคุณผู้ที่ช่วยส่งคืนได้ตามความสมัครใจ · <strong>ไม่ใช่เงื่อนไขในการได้ของคืน</strong> — ไม่ว่าจะตั้งหรือไม่ การตรวจสอบและการส่งมอบเหมือนกันทุกกรณี ·
          ไม่แสดงในประกาศสาธารณะ ผู้พบจะรู้เมื่อคืนของสำเร็จแล้วเท่านั้น · จะมอบก็ต่อเมื่อคุณได้รับของคืนแล้ว
        </p>
        {settled ? (
          <p className="mt-3 text-sm">
            {formatBaht(settled.amount)} — {REWARD_STATUS_OWNER[settled.status]}
          </p>
        ) : canPledge ? (
          <div className="mt-3">
            {pledge && <p className="mb-2 text-sm">ตั้งไว้ {formatBaht(pledge.amount)} — {REWARD_STATUS_OWNER.pledged}</p>}
            <PledgeForm lostItemId={item.id} settings={settings} pledge={pledge ? { id: pledge.id, amount: Number(pledge.amount) } : null} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-400">รายการนี้ปิดแล้ว</p>
        )}
      </section>

      <section id="matches" className="scroll-mt-6 rounded-lg bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-cdti-700">ประกาศพบของที่อาจตรงกัน</h2>
        <p className="mt-1 text-xs text-gray-500">
          ระบบเปรียบเทียบจากประเภท สี ยี่ห้อ สถานที่ วันที่ และคำสำคัญ — เป็นเพียง<strong>ความเป็นไปได้</strong>
          ไม่ได้ยืนยันว่าเป็นของคุณ การยืนยันความเป็นเจ้าของต้องผ่านการตรวจสอบของเจ้าหน้าที่
        </p>
        {matches.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">
            ยังไม่พบรายการที่อาจตรงกัน ระบบจะแจ้งเตือนคุณเมื่อมีผู้แจ้งพบของที่ใกล้เคียง
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {matches.map((m) => (
              <li key={m.found.id}>
                <Link
                  href={`/found/${m.found.id}`}
                  className="flex gap-3 rounded-md border border-gray-200 p-3 hover:border-cdti-200 hover:bg-cdti-50/40"
                >
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded bg-gray-100">
                    {m.found.image_src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- public Supabase storage URL
                      <img src={m.found.image_src} alt={m.found.general_name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-[10px] text-gray-400">ไม่มีรูป</span>
                    )}
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-gray-900">{m.found.general_name}</p>
                    <p className="text-xs text-gray-500">
                      {[m.found.category_name_th, m.found.color, m.found.location_name].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-gray-500">พบวันที่ {formatThaiDate(m.found.found_date)}</p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
                        m.likelihood === "high"
                          ? "bg-green-100 text-green-800"
                          : m.likelihood === "medium"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {LIKELIHOOD_TH[m.likelihood]}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
