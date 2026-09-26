import Link from "next/link";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { countMatchesByLostItem } from "@/lib/matching/queries";
import { CLAIMANT_STATUS } from "@/lib/claims/labels";
import { CUSTODY_STATUS_TH, FOUND_STATUS_TH, LOST_STATUS_TH, formatThaiDate } from "@/lib/reports/labels";

const USER_TYPE_LABEL_TH: Record<string, string> = {
  vocational_student: "นักเรียนอาชีวศึกษา",
  university_student: "นักศึกษาระดับอุดมศึกษา",
  teacher_staff: "ครู/บุคลากร",
  royal_household_staff: "บุคลากรสำนักพระราชวัง",
  external_visitor: "บุคคลภายนอก",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { reported?: string };
}) {
  const profile = await requireProfile();
  const supabase = await createClient();

  // Explicit reporter_id / finder_id filters: staff/admin can see every row
  // through RLS, but "my reports" must only ever list the user's own.
  const [{ data: lost }, { data: found }, { data: cats }] = await Promise.all([
    supabase
      .from("lost_items")
      .select("id, item_name, category_id, lost_date, status, created_at")
      .eq("reporter_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("found_items")
      .select("id, general_name, category_id, found_date, status, custody_status, created_at")
      .eq("finder_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase.from("categories").select("id, name_th"),
  ]);
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name_th]));
  const matchCounts = await countMatchesByLostItem((lost ?? []).map((i) => i.id));

  const { data: myClaims } = await supabase
    .from("claims")
    .select("id, found_item_id, status, created_at")
    .eq("claimant_id", profile.id)
    .order("created_at", { ascending: false });
  const claimItemIds = (myClaims ?? []).map((c) => c.found_item_id);
  const { data: claimItems } = claimItemIds.length
    ? await supabase.from("public_found_items").select("id, general_name").in("id", claimItemIds)
    : { data: [] as { id: string; general_name: string }[] };
  const claimItemName = new Map((claimItems ?? []).map((i) => [i.id, i.general_name]));

  const justReported = searchParams.reported === "lost" || searchParams.reported === "found" ? searchParams.reported : null;

  return (
    <div className="space-y-6">
      {justReported && (
        <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {justReported === "lost"
            ? "บันทึกการแจ้งของหายเรียบร้อยแล้ว"
            : "บันทึกการแจ้งพบของเรียบร้อยแล้ว ขอบคุณที่ช่วยเหลือ"}
        </p>
      )}

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-cdti-700">สวัสดีคุณ {profile.full_name}</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">อีเมล</dt>
          <dd>{profile.email}</dd>
          <dt className="text-gray-500">ประเภทผู้ใช้งาน</dt>
          <dd>{USER_TYPE_LABEL_TH[profile.user_type] ?? profile.user_type}</dd>
          <dt className="text-gray-500">สิทธิ์การใช้งาน</dt>
          <dd>{profile.role}</dd>
        </dl>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/report/lost" className="rounded-md bg-cdti-600 px-4 py-2 text-sm text-white hover:bg-cdti-700">
            + แจ้งของหาย
          </Link>
          <Link href="/report/found" className="rounded-md border border-cdti-200 px-4 py-2 text-sm text-cdti-700 hover:bg-cdti-50">
            + แจ้งพบของ
          </Link>
          <Link href="/dashboard/rewards" className="rounded-md border border-green-200 px-4 py-2 text-sm text-green-800 hover:bg-green-50">
            สินน้ำใจและสิทธิประโยชน์
          </Link>
        </div>
      </section>

      {myClaims && myClaims.length > 0 && (
        <section className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-cdti-700">คำขอรับของของฉัน</h2>
          <ul className="mt-3 divide-y text-sm">
            {myClaims.map((c) => (
              <li key={c.id}>
                <Link href={`/claims/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-gray-50">
                  <span className="font-medium">{claimItemName.get(c.found_item_id) ?? "สิ่งของที่ขอรับ"}</span>
                  <StatusBadge>{CLAIMANT_STATUS[c.status].label}</StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-cdti-700">ของหายที่ฉันแจ้ง</h2>
        {lost && lost.length > 0 ? (
          <ul className="mt-3 divide-y text-sm">
            {lost.map((i) => (
              <li key={i.id}>
                <Link href={`/dashboard/lost/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-gray-50">
                  <span>
                    <span className="font-medium">{i.item_name}</span>
                    <span className="ml-2 text-gray-500">
                      {catName.get(i.category_id ?? "") ?? "-"} · หายวันที่ {formatThaiDate(i.lost_date)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {(matchCounts.get(i.id) ?? 0) > 0 && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                        อาจตรงกัน {matchCounts.get(i.id)} รายการ
                      </span>
                    )}
                    <StatusBadge>{LOST_STATUS_TH[i.status]}</StatusBadge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-400">ยังไม่มีรายการ</p>
        )}
      </section>

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-cdti-700">ของที่ฉันแจ้งพบ</h2>
        {found && found.length > 0 ? (
          <ul className="mt-3 divide-y text-sm">
            {found.map((i) => (
              <li key={i.id}>
                <Link href={`/dashboard/found/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-gray-50">
                  <span>
                    <span className="font-medium">{i.general_name}</span>
                    <span className="ml-2 text-gray-500">
                      {catName.get(i.category_id ?? "") ?? "-"} · พบวันที่ {formatThaiDate(i.found_date)}
                    </span>
                    <span className="block text-xs text-gray-500">{CUSTODY_STATUS_TH[i.custody_status]}</span>
                  </span>
                  <StatusBadge>{FOUND_STATUS_TH[i.status]}</StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-400">ยังไม่มีรายการ</p>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-cdti-50 px-2.5 py-0.5 text-xs text-cdti-700">{children}</span>;
}
