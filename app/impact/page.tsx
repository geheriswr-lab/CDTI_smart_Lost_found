import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { REWARD_NAME, formatBaht } from "@/lib/se/labels";

export const metadata = { title: "ผลลัพธ์ทางสังคม — CDTI Smart Lost & Found" };
export const dynamic = "force-dynamic";

// Public, aggregates only (public_impact view, 0028).
export default async function ImpactPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("public_impact").select("*").maybeSingle();
  const n = (v: number | string | null | undefined) => Number(v ?? 0);

  const tiles = [
    { label: "ของที่ได้คืนเจ้าของ", value: n(data?.items_returned).toLocaleString("th-TH"), hint: `30 วันล่าสุด ${n(data?.items_returned_30d)} ชิ้น` },
    { label: `${REWARD_NAME}ที่มอบแล้ว`, value: `${n(data?.thank_yous)} ครั้ง`, hint: `ถึงมือผู้พบ ${formatBaht(n(data?.thank_you_to_finders))}` },
    { label: "ผู้พบมอบให้โครงการ", value: formatBaht(n(data?.donated_by_finders)) },
    { label: "สิทธิประโยชน์จากผู้สนับสนุน", value: `${n(data?.perks_given)} สิทธิ์`, hint: `ผู้สนับสนุน ${n(data?.active_partners)} ราย` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">ผลลัพธ์ทางสังคม</h1>
        <p className="mt-1 text-sm text-gray-600">CDTI Smart Lost & Found ดำเนินงานแบบวิสาหกิจเพื่อสังคม (Social Enterprise)</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">{t.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-cdti-700">{t.value}</p>
            {t.hint && <p className="text-xs text-gray-400">{t.hint}</p>}
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-lg bg-white p-6 text-sm leading-relaxed shadow-sm">
        <h2 className="font-semibold text-cdti-700">หลักการของเรา</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>บริการพื้นฐานฟรีเสมอ</strong> — ค้นหา แจ้งของหาย แจ้งพบของ ขอรับของ และการส่งมอบ ไม่มีค่าใช้จ่าย</li>
          <li>
            <strong>{REWARD_NAME}เป็นความสมัครใจ</strong> ไม่ใช่เงื่อนไขในการคืนทรัพย์สิน ผู้ที่ไม่ตั้งสินน้ำใจได้รับการช่วยเหลือแบบเดียวกันทุกขั้นตอน
            และผู้พบเรียกร้องเงินเพื่อแลกกับการคืนของไม่ได้
          </li>
          <li>สินน้ำใจจะมอบ<strong>หลังคืนของและยืนยันการส่งมอบแล้วเท่านั้น</strong> ระบบหักค่าดำเนินการ {n(data?.reward_fee_percent)}% เพื่อดูแลระบบ ผู้พบเลือกรับเองหรือมอบให้โครงการได้</li>
          <li>รายได้หลักมาจาก<strong>ค่าบำรุงระบบจากสถาบัน/หน่วยงาน</strong> และ<strong>ผู้สนับสนุนที่สถาบันอนุมัติ</strong> — ผู้ได้รับประโยชน์ไม่จำเป็นต้องเป็นผู้จ่าย</li>
          <li>เราไม่ขายหรือส่งต่อข้อมูลส่วนบุคคลให้ผู้สนับสนุน และไม่ใช้ข้อมูลเพื่อโฆษณา</li>
          <li>รายได้นำกลับมาพัฒนาและดูแลระบบ เพื่อให้โครงการดำเนินต่อได้อย่างยั่งยืน</li>
        </ul>
        <p className="text-xs text-gray-500">
          หมายเหตุ: ขณะนี้การชำระเงินอยู่ใน<strong>โหมดสาธิต</strong> ยังไม่มีการรับ–จ่ายเงินจริงผ่านระบบ
        </p>
        <p>
          <Link href="/sponsors" className="text-cdti-600 hover:underline">ดูผู้สนับสนุนโครงการ →</Link>
        </p>
      </section>
    </div>
  );
}
