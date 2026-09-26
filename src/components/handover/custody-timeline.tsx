import { CUSTODY_STATUS_TH, formatThaiDateTime } from "@/lib/reports/labels";
import type { CustodyStatus } from "@/types/database.types";

export type TimelineRow = {
  id: string;
  from_status: CustodyStatus | null;
  to_status: CustodyStatus;
  created_at: string;
  location_name?: string | null;
  handler_name?: string | null;
  notes?: string | null;
};

// Notes written by DB triggers (0018) are stored in English; show them in Thai.
const SYSTEM_NOTES: Record<string, string> = {
  "Initial custody status declared by finder at report time (not yet confirmed by staff)":
    "ผู้พบระบุสถานะตอนแจ้งพบของ (ยังไม่ได้ยืนยันโดยเจ้าหน้าที่)",
};

/** Chain of custody. `showPeople` = staff view (names + notes); finder view hides them. */
export function CustodyTimeline({ rows, showPeople }: { rows: TimelineRow[]; showPeople: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400">ยังไม่มีประวัติ</p>;
  return (
    <ol className="relative space-y-4 border-l border-cdti-100 pl-5">
      {rows.map((r) => (
        <li key={r.id} className="relative">
          <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-white bg-cdti-600" aria-hidden />
          <p className="text-sm font-medium text-gray-900">
            {r.from_status ? `${CUSTODY_STATUS_TH[r.from_status]} → ` : ""}
            {CUSTODY_STATUS_TH[r.to_status]}
          </p>
          <p className="text-xs text-gray-500">
            {formatThaiDateTime(r.created_at)}
            {r.location_name && ` · ${r.location_name}`}
            {showPeople && r.handler_name && ` · โดย ${r.handler_name}`}
          </p>
          {showPeople && r.notes && <p className="mt-0.5 text-xs text-gray-600">{SYSTEM_NOTES[r.notes] ?? r.notes}</p>}
        </li>
      ))}
    </ol>
  );
}
