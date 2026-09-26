import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-sm rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-cdti-700">ลืมรหัสผ่าน</h1>
      <p className="mt-2 text-sm text-gray-500">กรอกอีเมลที่ใช้สมัคร ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้</p>
      <ForgotPasswordForm />
      <p className="mt-4 text-sm text-gray-500">
        <Link href="/login" className="text-cdti-600 hover:underline">
          ← กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}
