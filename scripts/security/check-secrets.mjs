#!/usr/bin/env node
// Phase 12: make sure no password / key is committed to Git.
//   npm run security:secrets            → tracked files + the whole Git history
//   npm run security:secrets -- --no-history
// Without Git it scans the working tree (excluding node_modules, .next, .env*.local).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const noHistory = process.argv.includes("--no-history");

const RULES = [
  { name: "Supabase secret key (sb_secret_…)", re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: "database URL with password", re: /postgres(?:ql)?:\/\/[^:\s/'"]+:[^@\s'"]{6,}@[^\s'"]+/g },
  { name: "Vercel / GitHub token", re: /\b(?:vercel_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/g },
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function scanText(text, where, problems) {
  for (const r of RULES) for (const m of text.match(r.re) ?? []) {
    if (/postgres:\/\/authenticator@|:password@|:postgres@localhost|YOUR|your-/.test(m)) continue; // docs/local examples
    problems.push(`${where}: ${r.name}: ${m.slice(0, 24)}…`);
  }
  for (const jwt of text.match(JWT) ?? []) {
    try {
      const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
      if (p.role === "service_role") problems.push(`${where}: service_role JWT ${jwt.slice(0, 16)}…`);
      else if (p.iss === "supabase" && p.role === "anon") warnings.push(`${where}: anon key committed (public, but better kept in env)`);
    } catch {
      /* not a JWT */
    }
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 512, stdio: ["ignore", "pipe", "ignore"] });
}

const problems = [];
const warnings = [];
let hasGit = false;
try {
  git(["rev-parse", "--is-inside-work-tree"]);
  hasGit = true;
} catch {
  hasGit = false;
}

const SKIP = /(^|\/)(node_modules|\.next|\.git)(\/|$)|\.(png|jpe?g|gif|webp|ico|woff2?|lock)$|package-lock\.json$/;
let files = [];
if (hasGit) {
  files = git(["ls-files"]).split("\n").filter(Boolean);
  for (const f of files) {
    if (/(^|\/)\.env(\..*)?$/.test(f) && !f.endsWith(".env.example")) problems.push(`${f}: environment file is tracked by Git — git rm --cached ${f}`);
  }
} else {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const rel = p.slice(root.length + 1).replace(/\\/g, "/");
      if (SKIP.test(rel) || /(^|\/)\.env.*\.local$|(^|\/)\.env$/.test(rel)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else files.push(rel);
    }
  };
  walk(root);
  warnings.push("not a Git checkout — scanned the working tree only");
}

for (const f of files) {
  if (SKIP.test(f) || !existsSync(join(root, f))) continue;
  const text = readFileSync(join(root, f), "utf8");
  scanText(text, f, problems);
  if (/admin12345/.test(text) && !/\.(md)$|\.env\.example$|scripts\/(create-admin\.ts|check-env\.mjs|security\/)|supabase\//.test(f)) {
    warnings.push(`${f}: mentions admin12345`);
  }
}

if (existsSync(join(root, ".gitignore"))) {
  const gi = readFileSync(join(root, ".gitignore"), "utf8");
  if (!/^\.env\*?\.local$/m.test(gi) && !/^\.env\*$/m.test(gi)) problems.push(".gitignore does not ignore .env*.local");
} else problems.push(".gitignore is missing");

let commits = 0;
if (hasGit && !noHistory) {
  // Every version of every file ever committed (catches secrets that were "deleted" later).
  const log = git(["log", "--all", "-p", "--no-color", "--format=__COMMIT__ %h"]);
  let current = "?";
  const chunks = log.split(/^__COMMIT__ /m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    current = chunk.slice(0, chunk.indexOf("\n")).trim();
    commits++;
    const added = chunk.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    const before = problems.length;
    scanText(added, `history ${current}`, problems);
    if (problems.length === before && /^\+\+\+ b\/(\.env(\.local)?|.*\/\.env\.local)$/m.test(chunk)) {
      problems.push(`history ${current}: an .env file was committed at some point`);
    }
  }
}

for (const w of warnings) console.warn(`⚠ ${w}`);
if (problems.length) {
  console.error(`✗ ${problems.length} secret(s) found:`);
  for (const p of [...new Set(problems)]) console.error("  - " + p);
  console.error("\nRotate every leaked key in Supabase (Settings → API) — deleting the file is not enough once it was pushed.");
  process.exit(1);
}
console.log(`✓ no secrets found (${files.length} files${hasGit && !noHistory ? `, ${commits} commits of history` : ""})`);
