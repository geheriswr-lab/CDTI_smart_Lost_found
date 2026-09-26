import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import pkg from "../../../package.json";

// Phase 12: uptime / post-deploy check. Public, read-only, reveals nothing
// secret: uses the anon key and only asks whether the public category list
// is reachable (proves URL + anon key + RLS-readable reference data).
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let db: "ok" | "error" | "not_configured" = "not_configured";
  if (url && anon) {
    try {
      const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await supabase.from("categories").select("id", { head: true, count: "exact" }).limit(1);
      db = error ? "error" : "ok";
    } catch {
      db = "error";
    }
  }
  const ok = db === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", db, version: pkg.version, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
