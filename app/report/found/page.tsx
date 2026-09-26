import Link from "next/link";
import { requireProfile } from "@/lib/auth/session";
import { getReferenceData } from "@/lib/reports/queries";
import { FoundReportForm } from "./found-report-form";

export const metadata = { title: "แจ้งพบของ — CDTI Smart Lost & Found" };

export default async function ReportFoundPage() {
  const profile = await requireProfile();
  const refs = await getReferenceData();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard" className="text-sm text-cdti-600 hover:underline">
          ← กลับแดชบอร์ด
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-cdti-700">แจ้งพบของ</h1>
        <p className="mt-1 text-sm text-gray-600">
          ขอบคุณที่ช่วยส่งคืนของให้เจ้าของ ประกาศจะแสดงเพียงข้อมูลคร่าว ๆ ส่วนรายละเอียดเฉพาะจะเก็บเป็นความลับไว้ใช้ตรวจสอบผู้มาขอรับ
        </p>
      </div>

      {profile.is_restricted ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          บัญชีของคุณถูกจำกัดสิทธิ์การแจ้งรายการชั่วคราว กรุณาติดต่อเจ้าหน้าที่
        </p>
      ) : (
        <FoundReportForm {...refs} />
      )}
    </div>
  );
}
