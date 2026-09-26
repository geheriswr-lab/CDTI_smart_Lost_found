import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getCurrentProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "CDTI Smart Lost & Found",
  description: "ระบบบริหารจัดการทรัพย์สินสูญหายและทรัพย์สินที่มีผู้เก็บได้ — สถาบันเทคโนโลยีจิตรลดา",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guests get `profile === null` here — this is what makes the layout
  // itself safe to render on public routes without forcing a login.
  const profile = await getCurrentProfile();

  let unreadCount = 0;
  if (profile) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("is_read", false);
    unreadCount = count ?? 0;
  }

  return (
    <html lang="th">
      <body className="min-h-screen bg-cdti-50 text-gray-900 antialiased">
        <Nav profile={profile} unreadCount={unreadCount} />
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 pb-8 text-xs text-gray-500">
          <span>CDTI Smart Lost &amp; Found — บริการคืนของฟรีเสมอ</span>
          <Link href="/impact" className="hover:text-cdti-600">ผลลัพธ์ทางสังคม</Link>
          <Link href="/sponsors" className="hover:text-cdti-600">ผู้สนับสนุนโครงการ</Link>
        </footer>
      </body>
    </html>
  );
}
