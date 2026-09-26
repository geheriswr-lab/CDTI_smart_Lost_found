import { requireStaffOrAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { bangkokToday } from "@/lib/reports/validation";
import type { AdminStats } from "@/types/database.types";
import { MonthlyChart } from "./monthly-chart";

export const metadata = { title: "สถิติ — Admin" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysAgo(n: number) {
  return bangkokToday(new Date(Date.now() - n * 86400e3));
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function formatDuration(hours: number | null) {
  if (hours === null || hours === undefined) return "-";
  if (hours < 48) return `${Math.round(hours)} ชม.`;
  return `${(hours / 24).toFixed(1)} วัน`;
}

// Aggregates only (admin_stats() returns no per-person data). README Phase 10:
// risk statistics per individual are never shown publicly.
export default async function StatsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requireStaffOrAdmin();
  const to = DATE_RE.test(searchParams.to ?? "") ? searchParams.to! : bangkokToday();
  let from = DATE_RE.test(searchParams.from ?? "") ? searchParams.from! : daysAgo(180);
  if (from > to) from = to;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stats", { p_from: from, p_to: to });
  const s = (data ?? null) as AdminStats | null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cdti-700">สถิติ</h1>
          <p className="text-sm text-gray-600">ข้อมูลรวมเท่านั้น ไม่มีข้อมูลรายบุคคล</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <label>
            <span className="block text-xs text-gray-500">ตั้งแต่</span>
            <input type="date" name="from" defaultValue={from} className="rounded-md border border-gray-300 px-2 py-1.5" />
          </label>
          <label>
            <span className="block text-xs text-gray-500">ถึง</span>
            <input type="date" name="to" defaultValue={to} max={bangkokToday()} className="rounded-md border border-gray-300 px-2 py-1.5" />
          </label>
          <button type="submit" className="rounded-md bg-cdti-600 px-3 py-1.5 text-white hover:bg-cdti-700">
            ดู
          </button>
        </form>
      </div>

      {error || !s ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">ไม่สามารถคำนวณสถิติได้ (ช่วงเวลาต้องไม่เกิน 2 ปี)</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="อัตราส่งคืนสำเร็จ" value={s.return_success_rate === null ? "-" : `${s.return_success_rate}%`} hint={`ของที่แจ้งพบในช่วงนี้ ${s.found_returned}/${s.found_in_range} ชิ้นคืนเจ้าของแล้ว`} />
            <Tile label="เวลาเฉลี่ยจนคืนของ" value={formatDuration(s.avg_return_hours)} hint="จากวันที่แจ้งพบถึงวันส่งมอบ" />
            <Tile label="ส่งคืนสำเร็จ" value={String(s.returns)} />
            <Tile label="จับคู่ได้ (potential match)" value={String(s.matches)} />
            <Tile label="แจ้งของหาย" value={String(s.lost_reports)} />
            <Tile label="แจ้งพบของ" value={String(s.found_reports)} />
            <Tile label="คำขอรับของ" value={String(s.claims)} hint={`อนุมัติ ${s.claims_approved}`} />
            <Tile label="คำขอที่ถูกปฏิเสธ" value={String(s.claims_rejected)} />
          </div>

          <section className="rounded-lg bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">รายเดือน</h2>
            <MonthlyChart data={s.monthly} />
          </section>
        </>
      )}
    </div>
  );
}
