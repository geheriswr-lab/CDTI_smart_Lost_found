import { requireProfile } from "@/lib/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const profile = await requireProfile();

  return (
    <div className="mx-auto max-w-sm rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-cdti-700">เปลี่ยนรหัสผ่าน</h1>
      {profile.must_change_password ? (
        <p className="mt-2 text-sm text-amber-700">
          บัญชีนี้ต้องเปลี่ยนรหัสผ่านก่อนใช้งานส่วนอื่นของระบบ
        </p>
      ) : (
        <p className="mt-2 text-sm text-gray-500">ตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ</p>
      )}
      <ChangePasswordForm />
    </div>
  );
}
