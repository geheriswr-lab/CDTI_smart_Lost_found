import Link from "next/link";
import { searchPublicFound } from "@/lib/listing/queries";
import { parsePublicSearch } from "@/lib/listing/search";
import { ItemCard } from "@/components/listing/listing-parts";

export default async function HomePage() {
  const latest = await searchPublicFound(parsePublicSearch({}));
  const items = latest.items.slice(0, 4);

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-cdti-700">
          ระบบแจ้งของหาย / แจ้งพบของ
        </h1>
        <p className="mt-2 text-gray-600">
          สถาบันเทคโนโลยีจิตรลดา — ค้นหาประกาศได้โดยไม่ต้องเข้าสู่ระบบ
          หากต้องการแจ้งของหายหรือแจ้งพบของ กรุณาเข้าสู่ระบบก่อน
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/lost"
            className="rounded-md bg-cdti-600 px-4 py-2 text-white hover:bg-cdti-700"
          >
            ดูประกาศของหาย
          </Link>
          <Link
            href="/found"
            className="rounded-md border border-cdti-200 px-4 py-2 text-cdti-700 hover:bg-cdti-50"
          >
            ดูประกาศพบของ
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <Link href="/report/lost" className="rounded-lg bg-white p-5 shadow-sm hover:ring-1 hover:ring-cdti-200">
          <h2 className="font-semibold text-cdti-700">ทำของหาย?</h2>
          <p className="mt-1 text-sm text-gray-600">แจ้งรายละเอียด ระบบจะช่วยจับคู่กับของที่มีผู้พบ</p>
        </Link>
        <Link href="/report/found" className="rounded-lg bg-white p-5 shadow-sm hover:ring-1 hover:ring-cdti-200">
          <h2 className="font-semibold text-cdti-700">พบของตกหล่น?</h2>
          <p className="mt-1 text-sm text-gray-600">แจ้งพบของเพื่อช่วยส่งคืนเจ้าของอย่างปลอดภัย</p>
        </Link>
      </section>
      {items.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-cdti-700">ประกาศพบของล่าสุด</h2>
            <Link href="/found" className="text-sm text-cdti-600 hover:underline">
              ดูทั้งหมด →
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map((i) => (
              <ItemCard
                key={i.id}
                href={`/found/${i.id}`}
                title={i.general_name}
                imageSrc={i.image_src}
                category={i.category_name_th}
                color={i.color}
                date={i.found_date}
                dateLabel="พบวันที่"
                location={i.location_name}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
