import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feeFor, formatBaht, validRewardAmount, REWARD_STATUS_OWNER, REWARD_STATUS_FINDER, REWARD_STATUS_STAFF } from "./labels";

test("fee formula matches the database (2%, optional floor)", () => {
  assert.deepEqual(feeFor(500, 2, 0), { fee: 10, finder: 490 });
  assert.deepEqual(feeFor(100, 2, 0), { fee: 2, finder: 98 });
  assert.deepEqual(feeFor(100, 2, 5), { fee: 5, finder: 95 });
  assert.deepEqual(feeFor(333, 2, 0), { fee: 6.66, finder: 326.34 });
  assert.deepEqual(feeFor(3, 2, 5), { fee: 3, finder: 0 }); // never above the amount
});

test("reward amounts are whole baht within limits", () => {
  assert.equal(validRewardAmount("300", 20, 5000), 300);
  for (const bad of ["10", "12.5", "-5", "abc", "99999", "", "1e3"]) assert.equal(validRewardAmount(bad, 20, 5000), null, bad);
});

test("formatBaht", () => {
  assert.equal(formatBaht(490), "490 บาท");
  assert.equal(formatBaht("6.66"), "6.66 บาท");
});

test("every reward status has owner / finder / staff wording", () => {
  const sql = readFileSync("supabase/migrations/0028_phase13_social_enterprise.sql", "utf8");
  const m = sql.match(/status in \('pledged'[^)]*\)/);
  assert.ok(m);
  const statuses = [...m[0].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  for (const s of statuses) {
    assert.ok(s in REWARD_STATUS_OWNER && s in REWARD_STATUS_FINDER && s in REWARD_STATUS_STAFF, s);
  }
});

test("wording never frames the reward as a price for the item", () => {
  const text = readFileSync("src/lib/se/labels.ts", "utf8") + readFileSync("supabase/migrations/0028_phase13_social_enterprise.sql", "utf8");
  for (const bad of ["ค่าไถ่", "ค่าตอบแทนการคืน", "ต้องจ่าย"]) assert.ok(!text.includes(bad), bad);
});
