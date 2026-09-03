import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * The `server-only` import above makes any accidental import of this file
 * from a Client Component fail the build instead of silently shipping the
 * service role key to the browser.
 *
 * Per README ground rules, this is reserved for the specific server-side
 * jobs that Phase 1's RLS design deliberately has no client policy for:
 * admin bootstrap (scripts/create-admin.ts), the matching job (Phase 5),
 * notification writer (Phase 9), risk detection (Phase 7), audit logging
 * (Phase 9), and custody/handover transitions (Phase 8).
 *
 * Do NOT use this to "make an RLS error go away" in normal app code — if a
 * query is denied by RLS, that's the policy working as designed; fix the
 * policy or the query, don't reach for this client instead.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "The admin client must never be constructed without both."
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
