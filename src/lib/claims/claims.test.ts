import { test } from "node:test";
import assert from "node:assert/strict";
import { QUESTIONNAIRES, CLAIM_FORM_TYPES, findSensitive, labelledAnswers, validateClaimAnswers } from "./questionnaire";
import { buildClaimHints, serialHint } from "./hints";
import { CLAIMANT_STATUS } from "./labels";
import { checkEvidenceFile } from "../reports/validation";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test("no questionnaire ever asks for a password / PIN / OTP / unlock code", () => {
  const banned = /(รหัสผ่าน|password|\bpin\b|otp|passcode)/i;
  for (const t of CLAIM_FORM_TYPES) {
    for (const q of QUESTIONNAIRES[t]) {
      assert.ok(!banned.test(q.label), `${t}.${q.key} label asks for a credential`);
    }
  }
});

test("every questionnaire has identifying marks + where/when", () => {
  for (const t of CLAIM_FORM_TYPES) {
    const keys = QUESTIONNAIRES[t].map((q) => q.key);
    assert.ok(keys.includes("identifying_marks"), t);
    assert.ok(keys.includes("where_when"), t);
  }
});

test("findSensitive flags credentials and full ID/card numbers", () => {
  assert.equal(findSensitive("รหัสผ่าน 123456"), "credential");
  assert.equal(findSensitive("PIN: 4821"), "credential");
  assert.equal(findSensitive("passcode is 0000"), "credential");
  assert.equal(findSensitive("บัตรประชาชน 1-2345-67890-12-3"), "long_number");
  assert.equal(findSensitive("บัตร 4111 1111 1111 1111"), "long_number");
  assert.equal(findSensitive("IMEI 356938035643809", true), null, "IMEI allowed in serial field");
  assert.equal(findSensitive("มีกุญแจ 3 ดอก พวงกุญแจรูปปลา"), null);
  assert.equal(findSensitive("ไม่มี PIN"), null);
});

test("validateClaimAnswers: required fields, credential refusal, confirmation", () => {
  const bad = validateClaimAnswers("electronics", fd({ q_brand_model: "iPhone 15", q_lockscreen: "รหัสปลดล็อก 1234", q_where_when: "โรงอาหาร" }));
  assert.ok(!bad.ok);
  if (!bad.ok) {
    assert.ok(bad.errors.lockscreen?.includes("ห้ามใส่รหัส"));
    assert.ok(bad.errors.identifying_marks);
    assert.ok(bad.errors.confirm_truthful);
  }

  const good = validateClaimAnswers(
    "key",
    fd({ q_key_count: "3", q_keychain: "ปลาสีฟ้า", q_identifying_marks: "ปลอกสีแดง", q_where_when: "ห้องสมุด", confirm_truthful: "yes", q_unknown: "x" })
  );
  assert.ok(good.ok);
  if (good.ok) {
    assert.equal(good.answers._form, "key");
    assert.equal(good.answers.keychain, "ปลาสีฟ้า");
    assert.ok(!("unknown" in good.answers), "only known question keys are stored");
    assert.ok(!("key_details" in good.answers), "blank optional answers are not stored");
  }
});

test("labelledAnswers pairs answers with question labels in form order", () => {
  const rows = labelledAnswers({ _form: "key", where_when: "ห้องสมุด", key_count: "3" });
  assert.deepEqual(rows.map((r) => r.value), ["3", "ห้องสมุด"]);
});

test("staff hints: serial normalisation and secret-word overlap", () => {
  assert.equal(serialHint("sn-123 abc", "SN123ABC"), "match");
  assert.equal(serialHint("SN999", "SN123"), "mismatch");
  assert.equal(serialHint("", "SN123"), "not_provided");
  assert.equal(serialHint("SN1", null), "no_record");

  const h = buildClaimHints(
    { _form: "electronics", identifying_marks: "มีสติกเกอร์แมวสีดำ", where_when: "โรงอาหาร ตอนเที่ยง", serial: "sn-1" },
    { secret_details: "สติกเกอร์แมวสีดำด้านหลัง", serial_number: "SN1", exact_location: "โต๊ะ 3 โรงอาหาร" }
  );
  assert.equal(h.serial, "match");
  assert.ok(h.secretOverlap.length >= 3, h.secretOverlap.join("|")); // ICU splits loanwords like สติกเกอร์ into pieces — both sides split the same way
  assert.ok(h.secretOverlap.includes("แมว"));
  assert.ok(h.secretOverlap.includes("ดำ"), "colours count for secret overlap");
  assert.ok(h.locationOverlap.includes("อาหาร")); // ICU: โรง|อาหาร
});

test("claimant never sees intermediate review states", () => {
  const inProgress = new Set(
    (["pending", "needs_review", "likely_owner", "verified", "disputed"] as const).map((s) => CLAIMANT_STATUS[s].label)
  );
  assert.equal(inProgress.size, 1);
});

test("evidence accepts images and PDF by magic bytes only", async () => {
  const pdf = new File([new TextEncoder().encode("%PDF-1.7 ...")], "x.jpg");
  const r = await checkEvidenceFile(pdf);
  assert.ok(r.ok && r.ext === "pdf");
  const html = new File(["<html>"], "evidence.pdf", { type: "application/pdf" });
  assert.equal((await checkEvidenceFile(html)).ok, false);
});
