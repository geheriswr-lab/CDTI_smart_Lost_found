/**
 * scripts/rematch-all.ts
 *
 * Re-runs Phase 5 matching for every open lost item. Use it:
 *   - once after deploying Phase 5 (reports made before it have no matches yet)
 *   - after changing scoring weights in src/lib/matching/score.ts
 *
 * Run with: npm run rematch
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (same as create-admin).
 * Safe to run repeatedly: existing pairs are re-scored in place and only
 * NEW pairs create notifications.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";
import { MATCHABLE_LOST_STATUSES, matchLostItem } from "../src/lib/matching/persist";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const admin = createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: lost, error } = await admin
    .from("lost_items")
    .select("id")
    .in("status", [...MATCHABLE_LOST_STATUSES])
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to list lost items:", error.message);
    process.exit(1);
  }

  const totals = { items: 0, created: 0, updated: 0, notified: 0 };
  for (const { id } of lost ?? []) {
    const r = await matchLostItem(admin, id);
    totals.items++;
    totals.created += r.created;
    totals.updated += r.updated;
    totals.notified += r.notified;
  }
  console.log(
    `Checked ${totals.items} lost item(s): ${totals.created} new match(es), ` +
      `${totals.updated} re-scored, ${totals.notified} notification(s) sent.`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
