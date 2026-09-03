import { requireStaffOrAdmin } from "@/lib/auth/session";

// This is the server-side authorization check for everything under /admin.
// middleware.ts already redirects non-staff away as a UX shortcut, but that
// alone would just be "hiding the menu" — this re-checks profile.role from
// the database on every request to this layout, and every query the admin
// pages make is still independently constrained by RLS policies like
// `risk_events_select_staff` / `internal_notes_select_staff` / etc.
// (see setup_all.sql). Belt and suspenders, per README Phase 10 note.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireStaffOrAdmin();

  return <div>{children}</div>;
}
