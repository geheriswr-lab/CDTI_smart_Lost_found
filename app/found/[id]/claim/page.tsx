import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPublicFound } from "@/lib/listing/queries";
import { QUESTIONNAIRES, asClaimFormType } from "@/lib/claims/questionnaire";
import { CLAIMANT_STATUS } from "@/lib/claims/labels";
import { formatThaiDate, formatThaiDateTime } from "@/lib/reports/labels";
import { ClaimForm } from "./claim-form";

export const metadata = { title: "ขอรับของ — CDTI Smart Lost & Found" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClaimPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=${encodeURIComponent(`/found/${params.id}/claim`)}`);

  const item = await getPublicFound(params.id);
  if (!item) notFound();

  const supabase = await createClient();
  const [{ data: cat }, { data: ownFinder }, { data: existing }, { data: matches }] = await Promise.all([
    item.category_id
      ? supabase.from("categories").select("claim_form").eq("id", item.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // RLS: a user can only select a found_items row if they are its finder (or staff).
    supabase.from("found_items").select("id").eq("id", item.id).eq("finder_id", profile.id).maybeSingle(),
    supabase
      .from("claims")
      .select("id, status, claim_attempt_count, last_attempt_at")
      .eq("found_item_id", item.id)
      .eq("claimant_id", profile.id)
      .maybeSingle(),
    supabase.from("matches").select("id, lost_item_id").eq("found_item_id", item.id),
  ]);

  const formType = asClaimFormType(cat?.claim_form);

  let matchOptions: { id: string; label: string }[] = [];
  if (matches && matches.length > 0) {
    const { data: lost } = await supabase
      .from("lost_items")
      .select("id, item_name, lost_date")
      .eq("reporter_id", profile.id)
      .in("id", matches.map((m) => m.lost_item_id));
    const byId = new Map((lost ?? []).map((l) => [l.id, l]));
    matchOptions = matches
      .filter((m) => byId.has(m.lost_item_id))
      .map((m) => {
        const l = byId.get(m.lost_item_id)!;
        return { id: m.id, label: `${l.item_name} (หายวันที่ ${formatThaiDate(l.lost_date)})` };
      });
  }

  // Decide what the user can do right now (the DB enforces the same rules).
  let blocker: React.ReactNode = null;
  if (profile.is_restricted) {
    blocker = "บัญชีของคุณถูกจำกัดสิทธิ์ชั่วคราว กรุณาติดต่อเจ้าหน้าที่";
  } else if (ownFinder) {
    blocker = "คุณเป็นผู้แจ้งพบของชิ้นนี้ จึงไม่สามารถขอรับได้";
  } else if (existing) {
    const retryable = existing.status === "insufficient" || existing.status === "cancelled";
    const cooldownUntil = existing.last_attempt_at ? new Date(Date.parse(existing.last_attempt_at) + 24 * 3600 * 1000) : null;
    if (!retryable) {
      blocker = (
        <>
          คุณส่งคำขอรับของรายการนี้แล้ว — สถานะ: <strong>{CLAIMANT_STATUS[existing.status].label}</strong>{" "}
          <Link href={`/claims/${existing.id}`} className="text-cdti-600 hover:underline">
            ดูคำขอ
          </Link>
        </>
      );
    } else if (existing.claim_attempt_count >= 3) {
      blocker = "คุณส่งข้อมูลสำหรับรายการนี้ครบจำนวนครั้งที่กำหนดแล้ว หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่";
    } else if (cooldownUntil && cooldownUntil.getTime() > Date.now()) {
      blocker = `คุณสามารถส่งข้อมูลใหม่ได้ตั้งแต่ ${formatThaiDateTime(cooldownUntil.toISOString())}`;
    }
  }

  return (
    <div className="space-y-4">
      <Link href={`/found/${item.id}`} className="text-sm text-cdti-600 hover:underline">
        ← กลับไปที่ประกาศ
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-cdti-700">ขอรับของ: {item.general_name}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {[item.category_name_th, item.color, item.location_name].filter(Boolean).join(" · ")} · พบวันที่{" "}
          {formatThaiDate(item.found_date)}
        </p>
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <p className="font-semibold">ขั้นตอน</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>ตอบคำถามเกี่ยวกับสิ่งของ (ไม่ต้องดูจากประกาศ — ตอบจากสิ่งที่คุณรู้)</li>
          <li>เจ้าหน้าที่เปรียบเทียบคำตอบกับข้อมูลที่ผู้พบให้ไว้ (ผู้พบไม่เห็นคำตอบของคุณ)</li>
          <li>ถ้าผ่าน เจ้าหน้าที่จะแจ้งขั้นตอนรับของ ของมูลค่าสูงต้องแสดงบัตรประจำตัวตอนรับ</li>
        </ol>
        <p className="mt-2 text-xs">ส่งข้อมูลได้สูงสุด 3 ครั้งต่อรายการ และต้องเว้น 24 ชั่วโมงระหว่างครั้ง</p>
      </div>

      {blocker ? (
        <p className="rounded-lg bg-white p-5 text-sm text-gray-700 shadow-sm">{blocker}</p>
      ) : (
        <ClaimForm
          foundItemId={item.id}
          questions={QUESTIONNAIRES[formType]}
          matchOptions={matchOptions}
          isResubmission={!!existing}
        />
      )}
    </div>
  );
}
