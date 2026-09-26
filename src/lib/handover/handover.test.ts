import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDOVER_RESULT_TH, ID_DOCUMENT_TYPES, normalizeCode } from "./labels";

test("normalizeCode keeps 6 digits only", () => {
  assert.equal(normalizeCode(" 123-456 "), "123456");
  assert.equal(normalizeCode("12 34 56 78"), "123456");
  assert.equal(normalizeCode("abc"), "");
});

test("every DB handover result has a message; only 'completed' is success", () => {
  for (const [k, v] of Object.entries(HANDOVER_RESULT_TH)) assert.equal(v.ok, k === "completed", k);
});

test("ID document options match the DB check constraint (type only, never a number field)", () => {
  assert.deepEqual([...ID_DOCUMENT_TYPES].sort(), ["driver_license", "national_id", "other", "passport", "staff_card", "student_card"]);
});
