import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { privateImageUrl, publicImageUrl } from "@/lib/reports/queries";
import { CUSTODY_STATUS_TH, FOUND_STATUS_TH, formatThaiDate, formatThaiDateTime } from "@/lib/reports/labels";
import { CustodyTimeline } from "@/components/handover/custody-timeline";
import { DetailImage, DetailRow, PrivateCard, PublicCard } from "@/components/report/detail-parts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Finder-only view, including secret fields. See lost/[id]/page.tsx.
export default async function MyFoundItemPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("found_items")
    .select("*")
    .eq("id", params.id)
    .eq("finder_id", profile.id)
    .maybeSingle();
  if (!item) notFound();

  const [{ data: cat }, { data: loc }, pubUrl, privUrl, { data: custody }] = await Promise.all([
    item.category_id
      ? supabase.from("categories").select("name_th").eq("id", item.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
    item.location_id
      ? supabase.from("locations").select("name").eq("id", item.location_id).maybeSingle()
      : Promise.resolve({ data: null }),
    publicImageUrl(item.public_image_url),
    privateImageUrl(item.private_image_url),
    // RLS custody_history_select_finder: the finder sees the trail of their own item.
    supabase
      .from("custody_history")
      .select("id, from_status, to_status, created_at, location_id")
      .eq("found_item_id", item.id)
      .order("created_at"),
  ]);
  const locIds = [...new Set((custody ?? []).map((c) => c.location_id).filter((x): x is string => !!x))];
  const { data: hls } = locIds.length
    ? await supabase.from("handover_locations").select("id, name").in("id", locIds)
    : { data: [] as { id: string; name: string }[] };
  const hlName = new Map((hls ?? []).map((h) => [h.id, h.name]));

  return (
    <div className="space-y-4">
      <Link href="/dashboard" className="text-sm text-cdti-600 hover:underline">
        ← กลับแดชบอร์ด
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-cdti-700">{item.general_name}</h1>
        <span className="rounded-full bg-cdti-50 px-3 py-1 text-sm text-cdti-700">{FOUND_STATUS_TH[item.status]}</span>
      </div>
      <p className="text-xs text-gray-500">
        แจ้งเมื่อ {formatThaiDateTime(item.created_at)} · สถานะการครอบครอง: {CUSTODY_STATUS_TH[item.custody_status]}
      </p>

      <PublicCard>
        <DetailRow label="ประเภท" value={cat?.name_th} />
        <DetailRow label="สี" value={item.color} />
        <DetailRow label="วันที่พบ" value={formatThaiDate(item.found_date)} />
        <DetailRow label="บริเวณที่พบ" value={loc?.name} />
        <DetailRow label="คำอธิบาย" value={item.description} />
        <DetailRow label="รูป" value={<DetailImage src={pubUrl} alt={item.general_name} />} />
      </PublicCard>

      <PrivateCard>
        <DetailRow label="จุดสังเกตลับ" value={item.secret_details} />
        <DetailRow label="ตำแหน่งที่พบ" value={item.exact_location} />
        <DetailRow label="เวลาที่พบ" value={formatThaiDateTime(item.exact_time)} />
        <DetailRow label="Serial" value={item.serial_number} />
        <DetailRow label="รูปสำหรับตรวจสอบ" value={<DetailImage src={privUrl} alt="รูปสำหรับตรวจสอบ" />} />
      </PrivateCard>

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-cdti-700">ประวัติการครอบครอง</h2>
        <CustodyTimeline
          showPeople={false}
          rows={(custody ?? []).map((c) => ({ ...c, location_name: c.location_id ? hlName.get(c.location_id) : null }))}
        />
        {item.custody_status === "with_finder" && (
          <p className="mt-3 text-xs text-gray-500">
            ของยังอยู่กับคุณ — แนะนำให้นำส่งจุดรับของกลาง เจ้าหน้าที่จะบันทึกการรับของในระบบ
          </p>
        )}
      </section>
    </div>
  );
}
