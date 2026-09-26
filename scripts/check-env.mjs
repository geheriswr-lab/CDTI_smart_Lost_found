#!/usr/bin/env node
// Phase 12: validate environment variables before `next build`.
// On Vercel production builds (VERCEL_ENV=production) problems FAIL the
// build; elsewhere they are printed as warnings.
import { readFileSync, existsSync } from "node:fs";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...loadEnvFile(".env.local"), ...process.env };
const strict = env.VERCEL_ENV === "production" || process.argv.includes("--strict");

function jwtPayload(token) {
  try {
    const part = token.split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const errors = [];
const warns = [];
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const service = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const site = env.NEXT_PUBLIC_SITE_URL ?? "";

let ref = null;
if (!url) errors.push("NEXT_PUBLIC_SUPABASE_URL is missing");
else {
  const m = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  if (m) ref = m[1];
  else if (strict && !url.startsWith("https://")) errors.push(`NEXT_PUBLIC_SUPABASE_URL must use https (got ${url})`);
  else warns.push(`NEXT_PUBLIC_SUPABASE_URL is not https://<project-ref>.supabase.co (${url}) — OK only for a custom domain or local dev`);
}

// Keys: legacy JWT keys (anon / service_role) or new-style sb_publishable_ / sb_secret_.
if (!anon) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing");
else if (anon.startsWith("sb_secret_")) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is a SECRET key — it would be shipped to every browser");
else if (!anon.startsWith("sb_publishable_")) {
  const p = jwtPayload(anon);
  if (!p) warns.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is not a JWT or sb_publishable_ key");
  else {
    if (p.role !== "anon") errors.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY has role "${p.role}" — must be "anon" (it is public)`);
    if (ref && p.ref && p.ref !== ref) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to a different project than the URL");
  }
}

if (!service) (strict ? errors : warns).push("SUPABASE_SERVICE_ROLE_KEY is missing (matching / notifications need it)");
else if (service === anon) errors.push("SUPABASE_SERVICE_ROLE_KEY equals the anon key");
else if (!service.startsWith("sb_secret_")) {
  const p = jwtPayload(service);
  if (!p) warns.push("SUPABASE_SERVICE_ROLE_KEY is not a JWT or sb_secret_ key");
  else {
    if (p.role !== "service_role") errors.push(`SUPABASE_SERVICE_ROLE_KEY has role "${p.role}" — expected service_role`);
    if (ref && p.ref && p.ref !== ref) errors.push("SUPABASE_SERVICE_ROLE_KEY belongs to a different project than the URL");
  }
}

for (const [k, v] of Object.entries(env)) {
  if (k.startsWith("NEXT_PUBLIC_") && typeof v === "string" && (v.startsWith("sb_secret_") || jwtPayload(v)?.role === "service_role")) {
    errors.push(`${k} contains a service/secret key — NEXT_PUBLIC_ variables are sent to the browser`);
  }
}

if (!site) (strict ? errors : warns).push("NEXT_PUBLIC_SITE_URL is missing (email confirmation links need it)");
else if (strict && !/^https:\/\/[^/]+\/?$/.test(site)) errors.push(`NEXT_PUBLIC_SITE_URL must be the https origin of the site (got ${site})`);

if (env.INITIAL_ADMIN_PASSWORD && env.INITIAL_ADMIN_PASSWORD.toLowerCase() === "admin12345") {
  warns.push("INITIAL_ADMIN_PASSWORD is still admin12345 — create-admin will refuse it; leave it empty");
}

for (const w of warns) console.warn(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  if (strict) {
    console.error(`Environment check failed (${errors.length}). Fix the variables in Vercel → Settings → Environment Variables.`);
    process.exit(1);
  }
  console.warn("(not a production build — continuing)");
} else {
  console.log(`✓ environment OK${strict ? " (production)" : ""}`);
}
