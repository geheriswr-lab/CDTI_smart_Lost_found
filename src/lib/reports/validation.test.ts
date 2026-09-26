// Run with: npm test   (uses Node's built-in test runner via tsx — no extra deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bangkokLocalToIso,
  bangkokToday,
  checkImage,
  mapReportDbError,
  sniffImageType,
  validateFoundReport,
  validateLostReport,
  MAX_IMAGE_BYTES,
} from "./validation";

const CAT = "0b6d7c1e-3f55-4d2a-9c1b-1a2b3c4d5e6f";
const LOC = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
// 2026-09-26 10:00 in Bangkok
const NOW = new Date("2026-09-26T03:00:00Z");

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const validLost = {
  item_name: "  กระเป๋าสตางค์ ",
  category_id: CAT,
  brand: "Coach",
  color: "",
  lost_date: "2026-09-25",
  location_id: LOC,
  description: "สีน้ำตาล",
  private_ownership_details: "มีรูปครอบครัวในช่องใส",
};

const validFound = {
  general_name: "โทรศัพท์มือถือ",
  category_id: CAT,
  color: "ดำ",
  found_date: "2026-09-26",
  location_id: "",
  description: "",
  custody_status: "with_finder",
  exact_location: "โต๊ะ 3 โรงอาหาร",
  exact_time: "2026-09-26T08:15",
  serial_number: "",
  secret_details: "สติกเกอร์แมวด้านหลัง",
};

test("bangkokToday rolls over at Bangkok midnight, not UTC", () => {
  assert.equal(bangkokToday(new Date("2026-09-25T16:59:00Z")), "2026-09-25");
  assert.equal(bangkokToday(new Date("2026-09-25T17:00:00Z")), "2026-09-26");
});

test("bangkokLocalToIso attaches +07:00", () => {
  assert.equal(bangkokLocalToIso("2026-09-26T08:15"), "2026-09-26T08:15:00+07:00");
  assert.equal(bangkokLocalToIso("garbage"), null);
});

test("valid lost report is trimmed and blanks become null", () => {
  const r = validateLostReport(fd(validLost), NOW);
  assert.ok(r.ok);
  assert.equal(r.data.item_name, "กระเป๋าสตางค์");
  assert.equal(r.data.color, null);
  assert.equal(r.data.location_id, LOC);
});

test("lost report requires private ownership details", () => {
  const r = validateLostReport(fd({ ...validLost, private_ownership_details: "  " }), NOW);
  assert.ok(!r.ok);
  assert.ok(r.errors.private_ownership_details);
});

test("lost report rejects future date, bad uuid and overlong text", () => {
  const r = validateLostReport(
    fd({ ...validLost, lost_date: "2026-09-27", category_id: "x' or 1=1", description: "a".repeat(2001) }),
    NOW
  );
  assert.ok(!r.ok);
  assert.ok(r.errors.lost_date);
  assert.ok(r.errors.category_id);
  assert.ok(r.errors.description);
});

test("valid found report converts exact_time to Bangkok ISO", () => {
  const r = validateFoundReport(fd(validFound), NOW);
  assert.ok(r.ok);
  assert.equal(r.data.exact_time, "2026-09-26T08:15:00+07:00");
  assert.equal(r.data.custody_status, "with_finder");
  assert.equal(r.data.serial_number, null);
});

test("found report requires a custody answer", () => {
  const r = validateFoundReport(fd({ ...validFound, custody_status: "" }), NOW);
  assert.ok(!r.ok);
  assert.ok(r.errors.custody_status);
});

test("finder cannot self-declare staff-only custody states", () => {
  for (const s of ["in_storage", "released_to_owner"]) {
    const r = validateFoundReport(fd({ ...validFound, custody_status: s }), NOW);
    assert.ok(!r.ok, s);
    assert.ok(r.errors.custody_status);
  }
});

test("found report requires secret details", () => {
  const r = validateFoundReport(fd({ ...validFound, secret_details: "" }), NOW);
  assert.ok(!r.ok);
  assert.ok(r.errors.secret_details);
});

test("found exact_time cannot be in the future or on a different day", () => {
  const future = validateFoundReport(fd({ ...validFound, exact_time: "2026-09-26T23:00" }), NOW);
  assert.ok(!future.ok);
  assert.ok(future.errors.exact_time);

  const mismatch = validateFoundReport(fd({ ...validFound, exact_time: "2026-09-25T08:00" }), NOW);
  assert.ok(!mismatch.ok);
  assert.ok(mismatch.errors.exact_time);
});

test("exact_time is optional", () => {
  const r = validateFoundReport(fd({ ...validFound, exact_time: "" }), NOW);
  assert.ok(r.ok);
  assert.equal(r.data.exact_time, null);
});

// --- images ---------------------------------------------------------------

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test("sniffImageType detects by magic bytes", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(JPG), "image/jpeg");
  assert.equal(sniffImageType(WEBP), "image/webp");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});

test("checkImage: empty input means no image", async () => {
  assert.deepEqual(await checkImage(null), { ok: true, file: null });
  assert.deepEqual(await checkImage(new File([], "")), { ok: true, file: null });
});

test("checkImage rejects a disguised non-image even with image mime/extension", async () => {
  const fake = new File(["<html><script>alert(1)</script>"], "cat.jpg", { type: "image/jpeg" });
  const r = await checkImage(fake);
  assert.equal(r.ok, false);
});

test("checkImage rejects files over 5 MB", async () => {
  const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "big.png", { type: "image/png" });
  const r = await checkImage(big);
  assert.equal(r.ok, false);
});

test("checkImage accepts a real PNG and reports its extension", async () => {
  const r = await checkImage(new File([PNG], "x.bin", { type: "application/octet-stream" }));
  assert.ok(r.ok && r.file);
  if (r.ok && r.file) {
    assert.equal(r.mime, "image/png");
    assert.equal(r.ext, "png");
  }
});

test("mapReportDbError never echoes raw DB messages", () => {
  assert.match(mapReportDbError("REPORT_RATE_LIMIT: too many reports"), /บ่อยเกินไป/);
  assert.match(mapReportDbError("REPORT_FORBIDDEN: account is restricted"), /ไม่มีสิทธิ์/);
  const generic = mapReportDbError('duplicate key value violates unique constraint "secret"');
  assert.ok(!generic.includes("secret"));
});
