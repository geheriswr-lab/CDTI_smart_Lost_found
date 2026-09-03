import Link from "next/link";
import type { Profile } from "@/types/database.types";
import { signOutAction } from "@/lib/actions/auth";

export function Nav({ profile }: { profile: Profile | null }) {
  const isStaffOrAdmin = profile?.role === "staff" || profile?.role === "admin";

  return (
    <header className="border-b border-cdti-100 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold text-cdti-700">
          CDTI Smart Lost &amp; Found
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <Link href="/lost" className="text-gray-700 hover:text-cdti-600">
            ของหาย
          </Link>
          <Link href="/found" className="text-gray-700 hover:text-cdti-600">
            พบของ
          </Link>

          {profile ? (
            <>
              <Link href="/dashboard" className="text-gray-700 hover:text-cdti-600">
                แดชบอร์ดของฉัน
              </Link>
              {isStaffOrAdmin && (
                <Link href="/admin" className="text-gray-700 hover:text-cdti-600">
                  Admin
                </Link>
              )}
              <span className="text-gray-400">{profile.full_name}</span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="rounded-md border border-cdti-200 px-3 py-1.5 text-cdti-700 hover:bg-cdti-50"
                >
                  ออกจากระบบ
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md border border-cdti-200 px-3 py-1.5 text-cdti-700 hover:bg-cdti-50"
              >
                เข้าสู่ระบบ
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-cdti-600 px-3 py-1.5 text-white hover:bg-cdti-700"
              >
                สมัครสมาชิก
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
