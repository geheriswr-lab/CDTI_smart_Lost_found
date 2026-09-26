import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicLost } from "@/lib/listing/queries";
import { LOST_STATUS_TH, formatThaiDate } from "@/lib/reports/labels";
import { PublicDetail } from "@/components/listing/public-detail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public detail — from public_lost_items only (no reporter identity,
// no private ownership details).
export default async function PublicLostItemPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const item = await getPublicLost(params.id);
  if (!item) notFound();

  return (
    <PublicDetail
      backHref="/lost"
      backLabel="ประกาศของหายทั้งหมด"
      title={item.item_name}
      imageSrc={item.image_src}
      description={item.description}
      rows={[
        { label: "ประเภท", value: item.category_name_th },
        { label: "สี", value: item.color },
        { label: "วันที่หาย", value: formatThaiDate(item.lost_date) },
        { label: "บริเวณ", value: item.location_name },
        { label: "สถานะ", value: LOST_STATUS_TH[item.status] },
      ]}
    >
      <section className="rounded-lg border border-cdti-100 bg-white p-5 text-sm">
        <h2 className="font-semibold text-cdti-700">เก็บของชิ้นนี้ได้?</h2>
        <p className="mt-1 text-gray-600">
          กรุณา{" "}
          <Link href="/report/found" className="text-cdti-600 hover:underline">
            แจ้งพบของ
          </Link>{" "}
          ผ่านระบบ หรือนำส่งจุดรับของกลาง — ไม่ควรติดต่อนัดส่งคืนเองกับผู้ที่อ้างว่าเป็นเจ้าของ
          ระบบจะให้เจ้าหน้าที่ตรวจสอบความเป็นเจ้าของก่อนส่งคืน
        </p>
      </section>
    </PublicDetail>
  );
}
