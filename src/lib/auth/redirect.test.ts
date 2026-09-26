import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeRedirect, safeRedirectPath } from "./redirect";

test("same-site paths are allowed", () => {
  for (const p of ["/", "/dashboard", "/found/abc/claim", "/lost?q=ร่ม"]) assert.equal(isSafeRedirect(p), true, p);
});

test("anything that can change the host is rejected", () => {
  for (const p of ["//evil.com", "/\\evil.com", "/\\/evil.com", "@evil.com", "evil.com", "https://evil.com", "/ /x", "/a\\b", "", null, undefined]) {
    assert.equal(isSafeRedirect(p as string), false, String(p));
  }
  assert.equal(safeRedirectPath("@evil.com"), "/dashboard");
  assert.equal(safeRedirectPath("/claims/1"), "/claims/1");
});
