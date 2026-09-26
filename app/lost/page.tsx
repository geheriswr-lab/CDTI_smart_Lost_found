import Link from "next/link";
import { getReferenceData } from "@/lib/reports/queries";
import { searchPublicLost } from "@/lib/listing/queries";
import { hasActiveFilters, parsePublicSearch } from "@/lib/listing/search";
import { EmptyState, ItemCard, Pagination, ResultSummary, SearchFilters } from "@/components/listing/listing-parts";

export const metadata = { title: "ประกาศของหาย — CDTI Smart Lost & Found" };

// Public (guest-accessible) listing backed by the public_lost_items view —
// no reporter identity and no private ownership details.
export default async function PublicLostItemsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const search = parsePublicSearch(searchParams);
  const [refs, result] = await Promise.all([getReferenceData(), searchPublicLost(search)]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cdti-700">ประกาศของหาย</h1>
          <p className="mt-1 text-sm text-gray-600">
            ถ้าคุณเก็บของที่ตรงกับประกาศได้ กรุณาแจ้งพบของผ่านระบบ — ไม่ควรนัดส่งคืนเองกับผู้ที่อ้างว่าเป็นเจ้าของ
          </p>
        </div>
        <Link href="/report/found" className="rounded-md border border-cdti-200 bg-white px-4 py-2 text-sm text-cdti-700 hover:bg-cdti-50">
          เก็บของได้? แจ้งพบของ
        </Link>
      </div>

      <SearchFilters basePath="/lost" search={search} refs={refs} dateLabel="วันที่หาย" />

      {result.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ไม่สามารถโหลดรายการได้ในขณะนี้ กรุณาลองใหม่
        </p>
      ) : result.items.length === 0 ? (
        <EmptyState filtered={hasActiveFilters(search)} basePath="/lost" />
      ) : (
        <>
          <ResultSummary total={result.total} search={search} />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {result.items.map((i) => (
              <ItemCard
                key={i.id}
                href={`/lost/${i.id}`}
                title={i.item_name}
                imageSrc={i.image_src}
                category={i.category_name_th}
                color={i.color}
                date={i.lost_date}
                dateLabel="หายวันที่"
                location={i.location_name}
              />
            ))}
          </ul>
          <Pagination basePath="/lost" search={search} total={result.total} />
        </>
      )}
    </div>
  );
}
