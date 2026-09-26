import Link from "next/link";
import { requireProfile } from "@/lib/auth/session";
import { getReferenceData } from "@/lib/reports/queries";
import { LostReportForm } from "./lost-report-form";

export const metadata = { title: "แจ้งของหาย — CDTI Smart Lost & Found" };

export default async function ReportLostPage() {
  // Server-side session check (middleware is only the first line of defense).
  const profile = await requireProfile();
  const { categories, locations } = await getReferenceData();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard" className="text-sm text-cdti-600 hover:underline">
          ← กลับแดชบอร์ด
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-cdti-700">แจ้งของหาย</h1>
        <p className="mt-1 text-sm text-gray-600">
          กรอกข้อมูลให้ละเอียดที่สุด ระบบจะใช้ข้อมูลสาธารณะเพื่อช่วยค้นหา และใช้ข้อมูลลับเพื่อยืนยันว่าคุณเป็นเจ้าของตัวจริง
        </p>
      </div>

      {profile.is_restricted ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          บัญชีของคุณถูกจำกัดสิทธิ์การแจ้งรายการชั่วคราว กรุณาติดต่อเจ้าหน้าที่
        </p>
      ) : (
        <LostReportForm categories={categories} locations={locations} />
      )}
    </div>
  );
}
