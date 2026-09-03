import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database.types";

/**
 * Returns the current user's profile, or null if logged out.
 * Uses the RLS-bound server client — a user can only ever read their own
 * profile row through this call (see `profiles_select_own_or_staff` policy),
 * so there's no risk of this accidentally returning someone else's data.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile ?? null;
}

/**
 * Use at the top of any Server Component / Server Action that must be
 * logged in. This is the server-side check middleware.ts's redirect is
 * backing up — never rely on the client alone to hide a page.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  return profile;
}

/**
 * Use at the top of any staff/admin-only Server Component. Checks the role
 * from the DB (never from email, never from client-supplied state), and
 * redirects non-staff users away. The underlying tables are still protected
 * by RLS independently — this is a UX guard, not the only guard.
 */
export async function requireStaffOrAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "staff" && profile.role !== "admin") {
    redirect("/dashboard");
  }
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") {
    redirect("/dashboard");
  }
  return profile;
}
