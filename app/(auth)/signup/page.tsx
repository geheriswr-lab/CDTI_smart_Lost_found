import Link from "next/link";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-cdti-700">สมัครสมาชิก</h1>
      <SignupForm />
      <p className="mt-4 text-sm text-gray-500">
        มีบัญชีอยู่แล้ว?{" "}
        <Link href="/login" className="text-cdti-600 hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </div>
  );
}
