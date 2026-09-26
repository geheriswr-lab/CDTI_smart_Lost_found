import Link from "next/link";
import { getReferenceData } from "@/lib/reports/queries";
import { searchPublicFound } from "@/lib/listing/queries";
import { hasActiveFilters, parsePublicSearch } from "@/lib/listing/search";
import { EmptyState, ItemCard, Pagination, ResultSummary, SearchFilters } from "@/components/listing/listing-parts";

export const metadata = { title: "ประกาศพบของ — CDTI Smart Lost & Found" };

// Public (guest-accessible) listing. Reads ONLY from the public_found_items
// view — no finder identity, secret details, serial, or exact location/time.
export default async function PublicFoundItemsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const search = parsePublicSearch(searchParams);
  const [refs, result] = await Promise.all([getReferenceData(), searchPublicFound(search)]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cdti-700">ประกาศพบของ</h1>
          <p className="mt-1 text-sm text-gray-600">
            รายการที่มีผู้เก็บได้ — ประกาศแสดงเพียงข้อมูลคร่าว ๆ รายละเอียดเฉพาะจะใช้ยืนยันความเป็นเจ้าของ
          </p>
        </div>
        <Link href="/report/lost" className="rounded-md border border-cdti-200 bg-white px-4 py-2 text-sm text-cdti-700 hover:bg-cdti-50">
          ทำของหาย? แจ้งที่นี่
        </Link>
      </div>

      <SearchFilters basePath="/found" search={search} refs={refs} dateLabel="วันที่พบ" />

      {result.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ไม่สามารถโหลดรายการได้ในขณะนี้ กรุณาลองใหม่
        </p>
      ) : result.items.length === 0 ? (
        <EmptyState filtered={hasActiveFilters(search)} basePath="/found" />
      ) : (
        <>
          <ResultSummary total={result.total} search={search} />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {result.items.map((i) => (
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
          <Pagination basePath="/found" search={search} total={result.total} />
        </>
      )}
    </div>
  );
}
