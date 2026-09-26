import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "ผู้สนับสนุนโครงการ — CDTI Smart Lost & Found" };
export const dynamic = "force-dynamic";

// Public sponsor list (public_partners view, 0028): names, descriptions, perk names only.
export default async function SponsorsPage() {
  const supabase = await createClient();
  const { data: partners } = await supabase.from("public_partners").select("*").order("name");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">ผู้สนับสนุนโครงการ</h1>
        <p className="mt-1 text-sm text-gray-600">
          ร้านค้าและหน่วยงานที่สถาบันอนุมัติ ร่วมมอบสิทธิประโยชน์ให้ผู้ที่ช่วยส่งคืนทรัพย์สิน — ผู้พบได้รับสิทธิ์อัตโนมัติเมื่อคืนของสำเร็จ
          ผู้สนับสนุนไม่ได้รับข้อมูลส่วนบุคคลของผู้ใช้ และไม่มีผลต่อการตรวจสอบหรือการคืนของ
        </p>
      </div>
      {(partners ?? []).length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">ยังไม่มีผู้สนับสนุน — สนใจร่วมสนับสนุน ติดต่อเจ้าหน้าที่ของสถาบัน</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {(partners ?? []).map((p) => (
            <li key={p.id} className="rounded-lg bg-white p-5 shadow-sm">
              <p className="font-semibold text-gray-900">{p.name}</p>
              {p.description && <p className="mt-1 text-sm text-gray-600">{p.description}</p>}
              {p.perks.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {p.perks.map((k) => (
                    <li key={k} className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs text-green-800">{k}</li>
                  ))}
                </ul>
              )}
              {p.website && (
                <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-block text-xs text-cdti-600 hover:underline">
                  เว็บไซต์
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link href="/impact" className="text-sm text-cdti-600 hover:underline">ผลลัพธ์ทางสังคมของโครงการ →</Link>
    </div>
  );
}
