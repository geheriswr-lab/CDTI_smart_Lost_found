import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

// Routes anyone (including guests) may browse without logging in.
// This is what implements "Guest browsing (ไม่ login) เข้าดู Public Listing ได้".
const PUBLIC_ROUTES = ["/", "/lost", "/found"];

// Auth-flow routes that must stay reachable even while must_change_password
// is true, or while logged out.
const ALWAYS_ALLOWED_PREFIXES = ["/login", "/signup", "/auth", "/change-password", "/_next", "/favicon.ico"];

function isAlwaysAllowed(pathname: string) {
  return ALWAYS_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

function isPublicRoute(pathname: string) {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  // /lost/[id] and /found/[id] public detail pages (Phase 4).
  if (pathname.startsWith("/lost/") || pathname.startsWith("/found/")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  const { pathname } = request.nextUrl;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isAlwaysAllowed(pathname)) {
    return response;
  }

  // Guest browsing: public routes never require a session.
  if (!user && isPublicRoute(pathname)) {
    return response;
  }

  // Everything else requires a session.
  if (!user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // We have a session — load the profile for role / must_change_password.
  // Allowed by RLS policy `profiles_select_own_or_staff` (id = auth.uid()).
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password, is_restricted")
    .eq("id", user.id)
    .single();

  // Fail closed: if we can't load the profile for a logged-in user, don't
  // guess at their permissions.
  if (!profile) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Forced password change for the initial admin account (and anyone else
  // flagged) takes priority over every other route rule.
  if (profile.must_change_password && pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  // Role-based routing for /admin. This is a UX redirect, NOT the security
  // boundary — the /admin layout re-checks role server-side (see
  // app/admin/layout.tsx) and every table admin pages touch is still
  // protected by RLS regardless of what middleware does.
  if (pathname.startsWith("/admin") && profile.role !== "staff" && profile.role !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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
