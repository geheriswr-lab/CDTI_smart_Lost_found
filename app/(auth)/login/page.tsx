import Link from "next/link";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; registered?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-sm rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-cdti-700">เข้าสู่ระบบ</h1>

      {params.registered && (
        <p className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-700">
          สมัครสมาชิกสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชี (ถ้าเปิดใช้งาน) แล้วเข้าสู่ระบบ
        </p>
      )}
      {params.error === "confirmation_failed" && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          ยืนยันอีเมลไม่สำเร็จ ลิงก์อาจหมดอายุ กรุณาลองเข้าสู่ระบบโดยตรง
        </p>
      )}

      <LoginForm next={params.next} />

      <p className="mt-4 text-sm text-gray-500">
        ยังไม่มีบัญชี?{" "}
        <Link href="/signup" className="text-cdti-600 hover:underline">
          สมัครสมาชิก
        </Link>
      </p>
    </div>
  );
}
