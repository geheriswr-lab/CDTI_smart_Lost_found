import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
import { decideRoute, isAlwaysAllowed, isPublicRoute } from "@/lib/auth/routes";

// Route rules live in src/lib/auth/routes.ts (unit-tested, Phase 11).
// This is a UX layer: pages re-check on the server (src/lib/auth/session.ts,
// app/admin/layout.tsx) and the database enforces the real rules (RLS,
// is_staff_or_admin() refuses staff power while must_change_password is set).
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  const { pathname } = request.nextUrl;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only load the profile when a rule depends on it.
  let profile = null;
  if (user && !isAlwaysAllowed(pathname)) {
    const { data } = await supabase
      .from("profiles")
      .select("role, must_change_password, is_restricted")
      .eq("id", user.id)
      .single();
    profile = data;
  } else if (!user && isPublicRoute(pathname)) {
    return response;
  }

  const decision = decideRoute(pathname, !!user, profile);
  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.to, request.url));
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and Next internals.
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
