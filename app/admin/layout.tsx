import { requireStaffOrAdmin } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/admin-nav";

// This is the server-side authorization check for everything under /admin.
// middleware.ts already redirects non-staff away as a UX shortcut, but that
// alone would just be "hiding the menu" — this re-checks profile.role from
// the database on every request to this layout, and every query the admin
// pages make is still independently constrained by RLS / SECURITY DEFINER
// role checks (see supabase/migrations). Belt and suspenders, per README Phase 10.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireStaffOrAdmin();
  return (
    <div>
      <AdminNav role={profile.role} />
      {children}
    </div>
  );
}
