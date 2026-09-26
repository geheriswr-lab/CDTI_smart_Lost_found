import Link from "next/link";
import type { Profile } from "@/types/database.types";
import { signOutAction } from "@/lib/actions/auth";
import { hasStaffAccess } from "@/lib/auth/routes";

export function Nav({ profile, unreadCount = 0 }: { profile: Profile | null; unreadCount?: number }) {
  const isStaffOrAdmin = hasStaffAccess(profile);

  return (
    <header className="border-b border-cdti-100 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold text-cdti-700">
          CDTI Smart Lost &amp; Found
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
          <Link href="/lost" className="text-gray-700 hover:text-cdti-600">
            ของหาย
          </Link>
          <Link href="/found" className="text-gray-700 hover:text-cdti-600">
            พบของ
          </Link>

          {profile ? (
            <>
              <Link href="/report/lost" className="text-gray-700 hover:text-cdti-600">
                แจ้งของหาย
              </Link>
              <Link href="/report/found" className="text-gray-700 hover:text-cdti-600">
                แจ้งพบของ
              </Link>
              <Link href="/dashboard" className="text-gray-700 hover:text-cdti-600">
                แดชบอร์ดของฉัน
              </Link>
              <Link
                href="/notifications"
                className="relative text-gray-700 hover:text-cdti-600"
                aria-label={unreadCount > 0 ? `การแจ้งเตือน (${unreadCount} รายการใหม่)` : "การแจ้งเตือน"}
              >
                แจ้งเตือน
                {unreadCount > 0 && (
                  <span className="ml-1 rounded-full bg-cdti-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
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
