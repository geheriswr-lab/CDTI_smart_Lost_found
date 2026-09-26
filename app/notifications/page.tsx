import Link from "next/link";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";
import { formatThaiDateTime } from "@/lib/reports/labels";
import { NOTIFICATION_TYPE_TH } from "@/lib/audit/labels";

export const metadata = { title: "การแจ้งเตือน — CDTI Smart Lost & Found" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a notification should take the user. Payload ids are validated, never trusted as paths. */
function targetHref(type: string, payload: Record<string, unknown>): string | null {
  if (type === "potential_match") {
    const id = payload.lost_item_id;
    return typeof id === "string" && UUID_RE.test(id) ? `/dashboard/lost/${id}#matches` : null;
  }
  if (type === "dispute_review_required") return "/admin/claims?tab=disputed";
  if (type === "case_escalated") return "/admin/escalations";
  if (type === "reward_offered" || type === "reward_settled" || type === "perk_voucher") return "/dashboard/rewards";
  if (type === "item_returned") {
    const fid = payload.found_item_id;
    return typeof fid === "string" && UUID_RE.test(fid) ? `/dashboard/found/${fid}` : null;
  }
  const claimId = payload.claim_id;
  if (typeof claimId !== "string" || !UUID_RE.test(claimId)) return null;
  if (type === "claim_review_required") return `/admin/claims/${claimId}`;
  if (type === "reward_payable") return `/claims/${claimId}#thanks`;
  if (type.startsWith("claim_") || type.startsWith("handover_")) return `/claims/${claimId}`;
  return null;
}

export default async function NotificationsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, message, payload, is_read, created_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const items = data ?? [];
  const unread = items.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-cdti-700">การแจ้งเตือน</h1>
        {unread > 0 && (
          <form action={markAllNotificationsReadAction}>
            <button type="submit" className="rounded-md border border-cdti-200 bg-white px-3 py-1.5 text-sm text-cdti-700 hover:bg-cdti-50">
              ทำเครื่องหมายว่าอ่านทั้งหมด
            </button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg bg-white p-8 text-center text-sm text-gray-500 shadow-sm">ยังไม่มีการแจ้งเตือน</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg bg-white shadow-sm">
          {items.map((n) => {
            const href = targetHref(n.type, n.payload ?? {});
            return (
              <li key={n.id} className={`flex flex-wrap items-start gap-3 p-4 ${n.is_read ? "" : "bg-cdti-50/60"}`}>
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? "bg-transparent" : "bg-cdti-600"}`}
                />
                <div className="min-w-0 flex-1">
                  {NOTIFICATION_TYPE_TH[n.type] && (
                    <span className="mb-0.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                      {NOTIFICATION_TYPE_TH[n.type]}
                    </span>
                  )}
                  <p className={`text-sm ${n.is_read ? "text-gray-700" : "font-semibold text-gray-900"}`}>{n.title}</p>
                  <p className="mt-0.5 text-sm text-gray-600">{n.message}</p>
                  <p className="mt-1 text-xs text-gray-400">{formatThaiDateTime(n.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {href && (
                    <Link href={href} className="rounded-md bg-cdti-600 px-3 py-1.5 text-white hover:bg-cdti-700">
                      ดูรายการ
                    </Link>
                  )}
                  {!n.is_read && (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button type="submit" className="px-2 py-1.5 text-gray-500 hover:text-gray-700">
                        อ่านแล้ว
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
