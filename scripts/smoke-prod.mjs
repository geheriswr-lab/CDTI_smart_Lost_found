#!/usr/bin/env node
// Phase 12: read-only smoke test of a deployed site. Safe on production:
// it only sends GET requests as a guest and never logs in or writes data.
//
//   npm run smoke:prod -- https://your-app.vercel.app
//
// Uses NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (env or
// .env.local) to confirm what a guest can reach through the Supabase API.
import { readFileSync, existsSync } from "node:fs";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("usage: npm run smoke:prod -- https://your-app.vercel.app");
  process.exit(2);
}
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
const sbUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let failed = 0;
const ok = (label) => console.log(`✅ ${label}`);
const bad = (label, info) => { failed++; console.log(`❌ ${label}${info ? `  → ${info}` : ""}`); };
const skip = (label, info) => console.log(`⏭  ${label}${info ? `  (${info})` : ""}`);
const check = (label, cond, info) => (cond ? ok(label) : bad(label, info));

async function get(path, opts = {}) {
  return fetch(base + path, { redirect: "manual", ...opts });
}

// 1. Health + public pages
{
  const r = await get("/api/health");
  const body = await r.json().catch(() => ({}));
  check("/api/health ตอบ ok (เชื่อมฐานข้อมูลได้)", r.status === 200 && body.status === "ok", `${r.status} ${JSON.stringify(body)}`);
}
for (const p of ["/", "/lost", "/found", "/login", "/signup"]) {
  const r = await get(p);
  check(`${p} เปิดได้ (200)`, r.status === 200, String(r.status));
}

// 2. Protected pages redirect guests to /login
for (const p of ["/dashboard", "/admin", "/admin/claims", "/notifications", "/report/lost", "/found/00000000-0000-4000-8000-000000000000/claim"]) {
  const r = await get(p);
  const loc = r.headers.get("location") ?? "";
  check(`${p} → ต้อง login`, r.status >= 300 && r.status < 400 && /\/login/.test(loc), `${r.status} ${loc}`);
}

// 3. Auth callback cannot be used as an open redirect
{
  const r = await get("/auth/callback?code=invalid&next=@evil.example");
  const loc = r.headers.get("location") ?? "";
  check("/auth/callback ไม่พาออกไปเว็บอื่น", !/evil\.example/.test(new URL(loc || "/", base).host), loc);
}

// 4. Security headers
{
  const r = await get("/");
  const h = (k) => r.headers.get(k) ?? "";
  check("Content-Security-Policy", /frame-ancestors 'none'/.test(h("content-security-policy")), h("content-security-policy") || "missing");
  check("X-Frame-Options: DENY", h("x-frame-options") === "DENY", h("x-frame-options") || "missing");
  check("X-Content-Type-Options: nosniff", h("x-content-type-options") === "nosniff");
  check("Strict-Transport-Security", /max-age=\d{7,}/.test(h("strict-transport-security")), h("strict-transport-security") || "missing");
  check("ไม่มี X-Powered-By", !h("x-powered-by"), h("x-powered-by"));
  check("หน้าไม่ถูก cache สาธารณะ", /no-store/.test(h("cache-control")), h("cache-control"));
  if (base.startsWith("https://")) {
    const http = await fetch(base.replace("https://", "http://") + "/", { redirect: "manual" }).catch(() => null);
    if (http) check("http:// ถูกบังคับไป https://", http.status >= 300 && http.status < 400, String(http.status));
  }
}

// 5. Browser bundle has no server secrets
{
  const html = await (await get("/")).text();
  const scripts = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
  let leaks = [];
  for (const s of scripts) {
    const js = await (await get(s)).text();
    if (/sb_secret_[A-Za-z0-9_-]{20,}|SUPABASE_SERVICE_ROLE_KEY|createAdminClient/.test(js)) leaks.push(s);
    for (const jwt of js.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
      try {
        if (JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).role === "service_role") leaks.push(s);
      } catch { /* ignore */ }
    }
  }
  check(`JavaScript ที่ส่งให้ browser ไม่มี service role key (${scripts.length} ไฟล์)`, scripts.length > 0 && leaks.length === 0, leaks.join(", ") || "no scripts found");
}

// 6. What a guest can reach through the Supabase API directly
if (!sbUrl || !anon) {
  skip("ตรวจ Supabase API แบบ guest", "ไม่มี NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
} else {
  const H = { apikey: anon, Authorization: `Bearer ${anon}` };
  const rest = (p, init = {}) => fetch(`${sbUrl}/rest/v1${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  for (const t of ["profiles", "claims", "claim_evidence", "found_items", "lost_items", "handover_codes", "audit_logs", "risk_events", "notifications", "matches"]) {
    const r = await rest(`/${t}?select=*&limit=1`);
    const body = await r.text();
    check(`guest อ่าน ${t} ไม่ได้`, r.status === 401 || r.status === 403 || (r.status === 200 && body === "[]") || r.status === 404, `${r.status} ${body.slice(0, 80)}`);
  }
  {
    const r = await rest("/public_found_items?select=*&limit=5");
    const rows = r.status === 200 ? await r.json() : [];
    const cols = new Set(rows.flatMap((x) => Object.keys(x)));
    const leaked = ["secret_details", "serial_number", "exact_location", "private_image_url", "finder_id"].filter((c) => cols.has(c));
    check("public_found_items เปิดได้และไม่มีคอลัมน์ลับ", r.status === 200 && leaked.length === 0, `${r.status} ${leaked.join(",")}`);
  }
  {
    const r = await rest("/rpc/current_user_role", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    check("guest เรียกฟังก์ชันภายในไม่ได้", r.status >= 400, String(r.status));
  }
  {
    const r = await fetch(`${sbUrl}/storage/v1/object/list/verification-private`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 5 }),
    }).catch(() => null);
    if (!r || r.status === 404) skip("guest list ไฟล์หลักฐาน", "ไม่พบ Storage API");
    else {
      const body = await r.text();
      check("guest list ไฟล์หลักฐานไม่ได้", r.status >= 400 || body === "[]", `${r.status} ${body.slice(0, 80)}`);
    }
  }
}

console.log(failed ? `\n${failed} รายการไม่ผ่าน` : "\nผ่านทั้งหมด");
process.exit(failed ? 1 : 0);
