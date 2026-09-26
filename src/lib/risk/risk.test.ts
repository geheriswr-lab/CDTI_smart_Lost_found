import { test } from "node:test";
import assert from "node:assert/strict";
import { RISK_LEVEL_TH, RISK_RESOLUTION_TH, RISK_TYPE_TH, describeRiskDetails } from "./labels";
import { CLAIMANT_STATUS } from "../claims/labels";

// Words that label a person as an offender. README: use neutral states only.
const ACCUSATORY = /(โจร|ขโมย|มิจฉาชีพ|ทุจริต|คนโกง|หลอกลวง|แอบอ้าง|thief|steal|scam|fraud|criminal|liar)/i;

test("risk labels and resolutions use neutral language only", () => {
  const all = [
    ...Object.values(RISK_TYPE_TH).flatMap((t) => [t.label, t.explain]),
    ...Object.values(RISK_LEVEL_TH).map((l) => l.label),
    ...Object.values(RISK_RESOLUTION_TH),
  ];
  for (const text of all) assert.ok(!ACCUSATORY.test(text), text);
});

test("README's neutral states are offered", () => {
  assert.match(RISK_RESOLUTION_TH.needs_review, /Needs Review/);
  assert.match(RISK_RESOLUTION_TH.suspicious_activity, /Suspicious Activity/);
});

test("claimants never learn that a claim is disputed", () => {
  assert.equal(CLAIMANT_STATUS.disputed.label, CLAIMANT_STATUS.pending.label);
});

test("details summary exposes numbers / counts only", () => {
  assert.equal(describeRiskDetails("answer_changed", { changed_fields: ["keychain", "identifying_marks"] }), "2 ข้อ");
  assert.equal(describeRiskDetails("frequent_claims", { claims_7d: 6 }), "6 คำขอใน 7 วัน");
  assert.equal(describeRiskDetails("frequent_claims", {}), "");
});
