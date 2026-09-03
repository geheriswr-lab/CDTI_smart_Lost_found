import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { getCurrentProfile } from "@/lib/auth/session";
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

  return (
    <html lang="th">
      <body className="min-h-screen bg-cdti-50 text-gray-900 antialiased">
        <Nav profile={profile} />
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
