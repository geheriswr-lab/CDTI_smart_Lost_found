import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ACTION_TH, AUDIT_GROUPS, NOTIFICATION_TYPE_TH, summarizeMetadata } from "./labels";

const root = join(__dirname, "..", "..", "..");
const migrations = readdirSync(join(root, "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(root, "supabase", "migrations", f), "utf8"))
  .join("\n");
const persist = readFileSync(join(root, "src", "lib", "matching", "persist.ts"), "utf8");

/** SQL text of every `insert into public.<table> ... ;` statement (comments stripped). */
function insertsInto(table: string): string {
  const sql = migrations.replace(/--[^\n]*/g, "");
  const out: string[] = [];
  const re = new RegExp(`insert into public\\.${table}\\b[\\s\\S]*?;`, "g");
  for (const m of sql.matchAll(re)) out.push(m[0]);
  return out.join("\n");
}

test("every audit action written by the DB / matching job has a label and a group", () => {
  const actions = new Set<string>();
  for (const m of insertsInto("audit_logs").matchAll(/'([a-z_]+\.[a-z_]+)'/g)) actions.add(m[1]);
  for (const m of persist.matchAll(/action: "([a-z_.]+)"/g)) actions.add(m[1]);
  // reference.* is built as 'reference.' || created/updated/deleted
  ["reference.created", "reference.updated", "reference.deleted"].forEach((a) => actions.add(a));
  assert.ok(actions.size >= 20, `found ${actions.size}`);
  for (const a of actions) {
    assert.ok(AUDIT_ACTION_TH[a], `missing label for ${a}`);
    assert.ok(AUDIT_GROUPS.some((g) => g.prefixes.some((p) => a.startsWith(p))), `no group for ${a}`);
  }
});

test("every notification type written has a label", () => {
  const types = new Set<string>();
  const notifSql = insertsInto("notifications");
  for (const m of notifSql.matchAll(/'((?:potential|claim|dispute|handover|item|account|case)_[a-z_]+)'/g)) if (!m[1].endsWith("_id")) types.add(m[1]); // skip payload keys like claim_id
  assert.ok(types.size >= 10, `found ${types.size}`);
  for (const m of persist.matchAll(/(?<![a-z_])type: "([a-z_]+)"/g)) types.add(m[1]); // not entity_type
  for (const t of types) assert.ok(NOTIFICATION_TYPE_TH[t], `missing notification label for ${t}`);
});

test("summarizeMetadata shows whitelisted keys only", () => {
  const s = summarizeMetadata({
    outcome: "approved",
    changed_fields: ["secret_details"],
    secret_details: "สติกเกอร์แมว",
    found_item_id: "f0000000-0000-4000-8000-000000000001",
    note: "x",
  });
  assert.equal(s, "outcome: approved · changed_fields: secret_details");
});
