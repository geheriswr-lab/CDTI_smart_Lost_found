import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicFound } from "@/lib/listing/queries";
import { FOUND_STATUS_TH, formatThaiDate } from "@/lib/reports/labels";
import { PublicDetail } from "@/components/listing/public-detail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public detail — from public_found_items only. Items that are returned /
// closed drop out of the view, so they 404 here automatically.
export default async function PublicFoundItemPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const item = await getPublicFound(params.id);
  if (!item) notFound();

  return (
    <PublicDetail
      backHref="/found"
      backLabel="ประกาศพบของทั้งหมด"
      title={item.general_name}
      imageSrc={item.image_src}
      description={item.description}
      rows={[
        { label: "ประเภท", value: item.category_name_th },
        { label: "สีคร่าว ๆ", value: item.color },
        { label: "วันที่พบ", value: formatThaiDate(item.found_date) },
        { label: "บริเวณที่พบ", value: item.location_name },
        { label: "สถานะ", value: FOUND_STATUS_TH[item.status] },
      ]}
    >
      <section className="rounded-lg border border-cdti-100 bg-white p-5 text-sm">
        <h2 className="font-semibold text-cdti-700">คิดว่านี่อาจเป็นของคุณ?</h2>
        <p className="mt-1 text-gray-600">
          เพื่อป้องกันการแอบอ้าง คุณจะต้องตอบคำถามเกี่ยวกับรายละเอียดเฉพาะที่ไม่ได้แสดงในประกาศนี้
          (เช่น จุดสังเกตหรือของที่อยู่ข้างใน) แล้วเจ้าหน้าที่จะตรวจสอบก่อนส่งคืน
        </p>
        <Link
          href={`/found/${item.id}/claim`}
          className="mt-3 inline-block rounded-md bg-cdti-600 px-4 py-2 text-white hover:bg-cdti-700"
        >
          ฉันคิดว่านี่อาจเป็นของฉัน
        </Link>
        <p className="mt-2 text-xs text-gray-500">ต้องเข้าสู่ระบบก่อน · ส่งข้อมูลได้สูงสุด 3 ครั้งต่อรายการ</p>
      </section>
    </PublicDetail>
  );
}
