#!/usr/bin/env node
// Phase 11: make sure nothing secret ended up in the browser bundle.
// Run after `npm run build`:  npm run security:bundle
//
// Fails if any file the browser can download (.next/static/**) contains:
//   * the value of SUPABASE_SERVICE_ROLE_KEY (from the env / .env.local)
//   * any JWT whose payload has role = "service_role"
//   * server-only identifiers (SUPABASE_SERVICE_ROLE_KEY, createAdminClient)
//   * names of private columns being selected (secret_details, serial_number,
//     exact_location, private_ownership_details, code_hash)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const root = process.cwd();
const staticDir = join(root, ".next", "static");
if (!existsSync(staticDir)) {
  console.error("No .next/static — run `npm run build` first.");
  process.exit(2);
}
const env = { ...loadEnvFile(join(root, ".env.local")), ...process.env };
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const IDENTIFIERS = ["SUPABASE_SERVICE_ROLE_KEY", "createAdminClient"];
const PRIVATE_COLUMNS = ["secret_details", "serial_number", "exact_location", "private_ownership_details", "code_hash"];
// Forms where a user types their OWN private details legitimately carry these
// field names (input name="secret_details"); nowhere else should.
const PRIVATE_FIELD_FORMS = [/chunks\/app\/report\//, /chunks\/app\/dashboard\//];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

const problems = [];
let files = 0;
for (const file of walk(staticDir)) {
  if (!/\.(js|css|html|json|txt|map)$/.test(file)) continue;
  files++;
  const text = readFileSync(file, "utf8");
  const rel = file.slice(root.length + 1);
  if (serviceKey && serviceKey.length > 20 && text.includes(serviceKey)) problems.push(`${rel}: contains the service role key value`);
  for (const id of IDENTIFIERS) if (text.includes(id)) problems.push(`${rel}: contains "${id}"`);
  const isForm = PRIVATE_FIELD_FORMS.some((re) => re.test(rel.replace(/\\/g, "/")));
  if (!isForm) for (const col of PRIVATE_COLUMNS) if (text.includes(col)) problems.push(`${rel}: mentions private column "${col}"`);
  for (const jwt of text.match(JWT) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") problems.push(`${rel}: contains a service_role JWT`);
    } catch {
      /* not a JWT */
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in the browser bundle:`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`✓ browser bundle clean (${files} files checked${serviceKey ? ", service key value included in scan" : ""})`);
