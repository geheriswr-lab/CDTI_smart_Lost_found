import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOUND_MATCH_COLUMNS,
  MATCH_THRESHOLD,
  WEIGHTS,
  colorGroups,
  likelihood,
  rankCandidates,
  scoreMatch,
  tokens,
  type FoundForMatch,
  type LostForMatch,
} from "./score";

const CAT_PHONE = "c0000000-0000-4000-8000-000000000001";
const CAT_KEYS = "c0000000-0000-4000-8000-000000000002";
const LOC_CANTEEN = "10000000-0000-4000-8000-000000000001";
const LOC_LIB = "10000000-0000-4000-8000-000000000002";

const lost: LostForMatch = {
  id: "lost-1",
  reporter_id: "owner",
  category_id: CAT_PHONE,
  item_name: "โทรศัพท์มือถือ iPhone",
  brand: "Apple",
  color: "ดำ",
  lost_date: "2026-09-20",
  location_id: LOC_CANTEEN,
  description: "เคสหนังสีดำ",
};

const found: FoundForMatch = {
  id: "found-1",
  finder_id: "finder",
  category_id: CAT_PHONE,
  general_name: "โทรศัพท์มือถือ",
  color: "สีดำ",
  found_date: "2026-09-20",
  location_id: LOC_CANTEEN,
  description: "มีเคสหนัง",
};

test("weights add up to 100", () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test("strong match scores high on every public criterion", () => {
  const { total, breakdown } = scoreMatch(lost, found);
  assert.equal(breakdown.category, 30);
  assert.equal(breakdown.color, 15);
  assert.equal(breakdown.location, 20);
  assert.equal(breakdown.date, 10);
  assert.ok(breakdown.keyword > 0);
  assert.equal(breakdown.brand, 0, "brand not in finder's public text");
  assert.ok(total >= 80, `total ${total}`);
  assert.equal(likelihood(total), "high");
});

test("brand scores when it appears in the finder's public text (incl. Thai/English aliases)", () => {
  assert.equal(scoreMatch(lost, { ...found, description: "ไอโฟน เคสดำ" }).breakdown.brand, 15);
  assert.equal(scoreMatch({ ...lost, brand: "ซัมซุง" }, { ...found, general_name: "Samsung Galaxy" }).breakdown.brand, 15);
  // whole-word only for latin brands: "hp" must not match inside "headphone"
  assert.equal(scoreMatch({ ...lost, brand: "HP" }, { ...found, general_name: "headphone" }).breakdown.brand, 0);
});

test("matching never reads found-item secrets (only public columns are selected)", () => {
  for (const f of ["secret_details", "serial_number", "exact_location", "exact_time", "private_image_url", "custody_status"]) {
    assert.ok(!FOUND_MATCH_COLUMNS.includes(f), f);
  }
  // Even if a caller passed a row with secrets, they don't affect the score.
  const withSecrets = { ...found, secret_details: "Apple iPhone สติกเกอร์", serial_number: "APPLE123" } as FoundForMatch;
  assert.deepEqual(scoreMatch(lost, withSecrets), scoreMatch(lost, found));
});

test("colour synonyms, related colours and น้ำเงิน vs เงิน", () => {
  assert.deepEqual([...colorGroups("น้ำเงิน")], ["blue"]);
  assert.deepEqual([...colorGroups("เงิน")], ["silver"]);
  assert.equal(scoreMatch({ ...lost, color: "black" }, found).breakdown.color, 15);
  assert.equal(scoreMatch({ ...lost, color: "ฟ้า" }, { ...found, color: "น้ำเงิน" }).breakdown.color, 8);
  assert.equal(scoreMatch({ ...lost, color: "แดง" }, { ...found, color: "เขียว" }).breakdown.color, 0);
  assert.equal(scoreMatch({ ...lost, color: null }, found).breakdown.color, 0);
});

test("date score decays with gap; found clearly before loss is excluded", () => {
  const d = (fd: string) => scoreMatch(lost, { ...found, found_date: fd }).breakdown.date;
  assert.equal(d("2026-09-21"), 10);
  assert.equal(d("2026-09-19"), 10); // 1-day slack for date-entry mistakes
  assert.equal(d("2026-09-23"), 7);
  assert.equal(d("2026-09-27"), 4);
  assert.equal(d("2026-10-03"), 2);
  assert.equal(d("2026-10-30"), 0);
  assert.equal(rankCandidates([lost], [{ ...found, found_date: "2026-09-10" }]).length, 0);
});

test("different category / location lose their points", () => {
  const { breakdown } = scoreMatch(lost, { ...found, category_id: CAT_KEYS, location_id: LOC_LIB });
  assert.equal(breakdown.category, 0);
  assert.equal(breakdown.location, 0);
  assert.equal(scoreMatch({ ...lost, category_id: null }, found).breakdown.category, 0, "null never equals null");
});

test("Thai tokenizer drops stopwords and colour words", () => {
  const t = tokens("กระเป๋าสตางค์สีน้ำตาล มีบัตรนักศึกษา");
  assert.ok(t.has("กระเป๋า"));
  assert.ok(t.has("บัตร"));
  assert.ok(!t.has("สี"));
  assert.ok(!t.has("น้ำตาล"));
});

test("rankCandidates skips self-matches, applies threshold, sorts by score", () => {
  const weak: FoundForMatch = { ...found, id: "found-weak", category_id: CAT_KEYS, location_id: LOC_LIB, color: "แดง", general_name: "กุญแจ", description: null, found_date: "2026-10-15" };
  const mine: FoundForMatch = { ...found, id: "found-mine", finder_id: "owner" };
  const ok2: FoundForMatch = { ...found, id: "found-2", location_id: LOC_LIB };
  const ranked = rankCandidates([lost], [weak, mine, found, ok2]);
  assert.deepEqual(ranked.map((r) => r.found_item_id), ["found-1", "found-2"]);
  assert.ok(ranked.every((r) => r.score >= MATCH_THRESHOLD));
  assert.ok(!("finder_id" in ranked[0]));
});

test("likelihood bands", () => {
  assert.equal(likelihood(85), "high");
  assert.equal(likelihood(55), "medium");
  assert.equal(likelihood(42), "low");
});
