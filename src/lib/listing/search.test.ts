import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_PUBLIC_FIELDS,
  PAGE_SIZE,
  PUBLIC_FOUND_FIELDS,
  PUBLIC_FOUND_SELECT,
  PUBLIC_LOST_FIELDS,
  PUBLIC_LOST_SELECT,
  buildSearchHref,
  hasActiveFilters,
  pageRange,
  parsePublicSearch,
  sanitizeText,
  toPublicFoundCard,
  toPublicLostCard,
} from "./search";

const CAT = "0b6d7c1e-3f55-4d2a-9c1b-1a2b3c4d5e6f";

test("public select lists never include forbidden columns", () => {
  for (const f of FORBIDDEN_PUBLIC_FIELDS) {
    assert.ok(!(PUBLIC_FOUND_FIELDS as readonly string[]).includes(f), `found: ${f}`);
    assert.ok(!(PUBLIC_LOST_FIELDS as readonly string[]).includes(f), `lost: ${f}`);
    assert.ok(!PUBLIC_FOUND_SELECT.split(", ").includes(f));
    assert.ok(!PUBLIC_LOST_SELECT.split(", ").includes(f));
  }
  assert.ok(!PUBLIC_FOUND_SELECT.includes("*"));
});

test("card mappers drop every non-whitelisted key, even if the source leaks", () => {
  const leaky = {
    id: "i1",
    general_name: "โทรศัพท์",
    item_name: "กระเป๋า",
    secret_details: "สติกเกอร์แมว",
    serial_number: "SN-1",
    exact_location: "โต๊ะ 3",
    exact_time: "2026-09-26T08:00:00+07:00",
    finder_id: "u1",
    reporter_id: "u1",
    private_image_url: "u1/found/p.jpg",
    private_ownership_details: "x",
    custody_status: "with_finder",
    brand: "Apple",
  };
  const found = toPublicFoundCard(leaky);
  const lost = toPublicLostCard(leaky);
  for (const f of FORBIDDEN_PUBLIC_FIELDS) {
    assert.ok(!(f in found), `found card has ${f}`);
    assert.ok(!(f in lost), `lost card has ${f}`);
  }
  const serialized = JSON.stringify([found, lost]);
  for (const secret of ["สติกเกอร์แมว", "SN-1", "โต๊ะ 3", "u1/found/p.jpg", "Apple"]) {
    assert.ok(!serialized.includes(secret), secret);
  }
  assert.equal(found.general_name, "โทรศัพท์");
  assert.equal(found.color, null);
});

test("sanitizeText keeps Thai (incl. vowels/tone marks) and strips filter syntax", () => {
  assert.equal(sanitizeText("  กระเป๋าสตางค์  "), "กระเป๋าสตางค์");
  assert.equal(sanitizeText("iPhone 15-Pro"), "iPhone 15-Pro");
  assert.equal(sanitizeText("a,b).or(secret_details.ilike.*x*"), "a b or secret details ilike x");
  assert.equal(sanitizeText("100%_"), "100");
  assert.equal(sanitizeText('"quoted"'), "quoted");
  assert.equal(sanitizeText("%%%"), null);
  assert.equal(sanitizeText("a".repeat(200))?.length, 60);
});

test("parsePublicSearch validates every param", () => {
  const s = parsePublicSearch({
    q: "โทรศัพท์",
    category: CAT,
    color: "ดำ",
    location: "not-a-uuid",
    from: "2026-09-01",
    to: "2026-13-45",
    page: "3",
  });
  assert.deepEqual(s, {
    q: "โทรศัพท์",
    category: CAT,
    color: "ดำ",
    location: null,
    from: "2026-09-01",
    to: null,
    page: 3,
  });
});

test("parsePublicSearch swaps reversed date range and clamps page", () => {
  const s = parsePublicSearch({ from: "2026-09-20", to: "2026-09-01", page: "-4" });
  assert.equal(s.from, "2026-09-01");
  assert.equal(s.to, "2026-09-20");
  assert.equal(s.page, 1);
  assert.equal(parsePublicSearch({ page: "999999" }).page, 500);
  assert.equal(parsePublicSearch({ page: "abc" }).page, 1);
});

test("parsePublicSearch takes the first value of repeated params", () => {
  assert.equal(parsePublicSearch({ q: ["กุญแจ", "อื่น"] }).q, "กุญแจ");
});

test("hasActiveFilters ignores page", () => {
  assert.equal(hasActiveFilters(parsePublicSearch({ page: "2" })), false);
  assert.equal(hasActiveFilters(parsePublicSearch({ color: "แดง" })), true);
});

test("buildSearchHref drops empty params and page 1", () => {
  assert.equal(buildSearchHref("/found", { q: null, page: 1 }), "/found");
  assert.equal(buildSearchHref("/found", { q: "กุญแจ", page: 2 }), "/found?q=%E0%B8%81%E0%B8%B8%E0%B8%8D%E0%B9%81%E0%B8%88&page=2");
});

test("pageRange is inclusive and page-sized", () => {
  assert.deepEqual(pageRange(1), { from: 0, to: PAGE_SIZE - 1 });
  assert.deepEqual(pageRange(2), { from: PAGE_SIZE, to: 2 * PAGE_SIZE - 1 });
});
