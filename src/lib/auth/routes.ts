// Route access rules used by middleware.ts (Phase 11: extracted so they can be
// unit-tested). Middleware is a UX layer — every page re-checks on the server
// and the database enforces the real rules (RLS + 0026 role helpers) — but
// the rules should still be exact rather than loose prefix matches.

/** Auth-flow routes reachable while logged out or while a password change is pending. */
const ALWAYS_ALLOWED = ["/login", "/signup", "/forgot-password", "/auth", "/change-password", "/api/health"];

/** Guest browsing: home, public listings/detail pages, SE impact + sponsors. */
const PUBLIC_ROUTE = /^\/(?:(?:lost|found)(?:\/[^/]+)?|impact|sponsors)?\/?$/;

function underPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOWED.some((p) => underPrefix(pathname, p));
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE.test(pathname);
}

export type RouteProfile = {
  role: "user" | "staff" | "admin";
  must_change_password: boolean;
  is_restricted: boolean;
};

/** Mirrors public.is_staff_or_admin() (0026): no staff power while a password
 *  change is pending or the account is restricted. */
export function hasStaffAccess(p: RouteProfile | null | undefined): boolean {
  return !!p && (p.role === "staff" || p.role === "admin") && !p.must_change_password && !p.is_restricted;
}

/** Mirrors public.is_admin() (0026). */
export function hasAdminAccess(p: RouteProfile | null | undefined): boolean {
  return !!p && p.role === "admin" && !p.must_change_password && !p.is_restricted;
}

export type RouteDecision = { action: "next" } | { action: "redirect"; to: string };

/**
 * Decide what middleware does for a request.
 * `profile` is only consulted when `loggedIn` is true; pass `undefined` if it
 * could not be loaded (fails closed).
 */
export function decideRoute(pathname: string, loggedIn: boolean, profile?: RouteProfile | null): RouteDecision {
  if (isAlwaysAllowed(pathname)) return { action: "next" };

  if (!loggedIn) {
    if (isPublicRoute(pathname)) return { action: "next" };
    return { action: "redirect", to: `/login?next=${encodeURIComponent(pathname)}` };
  }

  if (!profile) return { action: "redirect", to: "/login" };

  if (profile.must_change_password) return { action: "redirect", to: "/change-password" };

  if (underPrefix(pathname, "/admin") && !hasStaffAccess(profile)) {
    return { action: "redirect", to: "/dashboard" };
  }
  return { action: "next" };
}
