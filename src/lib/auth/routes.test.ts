import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRoute, hasAdminAccess, hasStaffAccess, isAlwaysAllowed, isPublicRoute, type RouteProfile } from "./routes";

const user: RouteProfile = { role: "user", must_change_password: false, is_restricted: false };
const staff: RouteProfile = { role: "staff", must_change_password: false, is_restricted: false };
const admin: RouteProfile = { role: "admin", must_change_password: false, is_restricted: false };
const pendingAdmin: RouteProfile = { ...admin, must_change_password: true };
const restrictedStaff: RouteProfile = { ...staff, is_restricted: true };

test("public routes are exact: listings and detail pages only", () => {
  for (const p of ["/", "/lost", "/found", "/lost/abc", "/found/0b8c1f9e-1111-4222-8333-444455556666", "/found/"]) {
    assert.equal(isPublicRoute(p), true, p);
  }
  for (const p of ["/found/x/claim", "/lost/x/edit", "/lostfound", "/foundx", "/admin", "/dashboard", "/claims/1", "/found//claim"]) {
    assert.equal(isPublicRoute(p), false, p);
  }
});

test("always-allowed prefixes match on a segment boundary", () => {
  for (const p of ["/login", "/signup", "/forgot-password", "/auth/callback", "/change-password", "/api/health"]) assert.equal(isAlwaysAllowed(p), true, p);
  for (const p of ["/login-admin", "/authx", "/auth-admin", "/change-password-x", "/_nextadmin", "/favicon.icoadmin", "/api/healthx", "/api/other"]) {
    assert.equal(isAlwaysAllowed(p), false, p);
  }
});

test("guests: public pages pass, everything else goes to login with next", () => {
  assert.deepEqual(decideRoute("/found/abc", false), { action: "next" });
  assert.deepEqual(decideRoute("/found/abc/claim", false), { action: "redirect", to: "/login?next=%2Ffound%2Fabc%2Fclaim" });
  assert.deepEqual(decideRoute("/admin", false), { action: "redirect", to: "/login?next=%2Fadmin" });
  assert.deepEqual(decideRoute("/login", false), { action: "next" });
});

test("logged in: fail closed without profile, forced password change first", () => {
  assert.deepEqual(decideRoute("/dashboard", true, null), { action: "redirect", to: "/login" });
  assert.deepEqual(decideRoute("/admin", true, pendingAdmin), { action: "redirect", to: "/change-password" });
  assert.deepEqual(decideRoute("/", true, pendingAdmin), { action: "redirect", to: "/change-password" });
  assert.deepEqual(decideRoute("/change-password", true, pendingAdmin), { action: "next" });
});

test("/admin only for active staff/admin", () => {
  assert.deepEqual(decideRoute("/admin", true, user), { action: "redirect", to: "/dashboard" });
  assert.deepEqual(decideRoute("/admin/claims/1", true, user), { action: "redirect", to: "/dashboard" });
  assert.deepEqual(decideRoute("/admin", true, restrictedStaff), { action: "redirect", to: "/dashboard" });
  assert.deepEqual(decideRoute("/admin", true, staff), { action: "next" });
  assert.deepEqual(decideRoute("/admin/stats", true, admin), { action: "next" });
  assert.deepEqual(decideRoute("/administrator", true, user), { action: "next" }); // not the admin area (404 page)
});

test("access helpers mirror the database role helpers", () => {
  assert.equal(hasStaffAccess(staff), true);
  assert.equal(hasStaffAccess(admin), true);
  assert.equal(hasStaffAccess(user), false);
  assert.equal(hasStaffAccess(restrictedStaff), false);
  assert.equal(hasStaffAccess(pendingAdmin), false);
  assert.equal(hasAdminAccess(admin), true);
  assert.equal(hasAdminAccess(staff), false);
  assert.equal(hasAdminAccess(pendingAdmin), false);
  assert.equal(hasAdminAccess(null), false);
});
