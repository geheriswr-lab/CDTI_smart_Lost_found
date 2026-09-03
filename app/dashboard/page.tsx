import { requireProfile } from "@/lib/auth/session";

const USER_TYPE_LABEL_TH: Record<string, string> = {
  vocational_student: "นักเรียนอาชีวศึกษา",
  university_student: "นักศึกษาระดับอุดมศึกษา",
  teacher_staff: "ครู/บุคลากร",
  royal_household_staff: "บุคลากรสำนักพระราชวัง",
  external_visitor: "บุคคลภายนอก",
};

export default async function DashboardPage() {
  const profile = await requireProfile();

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-cdti-700">
        สวัสดีคุณ {profile.full_name}
      </h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-500">อีเมล</dt>
        <dd>{profile.email}</dd>
        <dt className="text-gray-500">ประเภทผู้ใช้งาน</dt>
        <dd>{USER_TYPE_LABEL_TH[profile.user_type] ?? profile.user_type}</dd>
        <dt className="text-gray-500">สิทธิ์การใช้งาน</dt>
        <dd>{profile.role}</dd>
      </dl>
      <p className="mt-6 text-gray-400">
        รายการแจ้งของหาย/พบของของคุณจะแสดงที่นี่ (Phase 3)
      </p>
    </div>
  );
}
