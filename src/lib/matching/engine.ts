import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchFoundItem, matchLostItem, type MatchRunResult } from "./persist";

/**
 * Runs matching for a newly reported item. Never throws: a matching failure
 * (e.g. SUPABASE_SERVICE_ROLE_KEY not configured) must not make the user's
 * report fail — the report is already saved, and matches can be rebuilt
 * later with `npm run rematch`.
 */
export async function runMatchingSafely(kind: "lost" | "found", id: string): Promise<MatchRunResult | null> {
  try {
    const admin = createAdminClient();
    return kind === "lost" ? await matchLostItem(admin, id) : await matchFoundItem(admin, id);
  } catch (err) {
    // Log the message only — never the row data.
    console.error(`[matching] ${kind} ${id} failed:`, err instanceof Error ? err.message : "unknown error");
    return null;
  }
}
