/**
 * scripts/create-admin.ts
 *
 * Creates (or repairs) the initial CDTI admin account per README Phase 2:
 *   - admin@cdti.ac.th (configurable via INITIAL_ADMIN_EMAIL)
 *   - must_change_password = true
 *   - role = 'admin' set directly in the DB — never inferred from email
 *
 * Run with: npm run create-admin
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local).
 * This is a one-off ops script, not something the running app ever calls —
 * it's the only place in this codebase that's meant to grant the 'admin'
 * role, and it does so with the service role key, outside of any user
 * session, precisely so app code never needs a path that can do this.
 *
 * SECURITY NOTE: change INITIAL_ADMIN_PASSWORD before running this against
 * a real environment, and change it again in the Supabase dashboard (or via
 * the app's forced change-password flow) immediately after first login.
 * Phase 12: the old 'admin12345' default is refused; an empty
 * INITIAL_ADMIN_PASSWORD generates a random one. The database (0026) also
 * withholds admin power until the password is actually changed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

// Phase 12: never bootstrap with a guessable password. If
// INITIAL_ADMIN_PASSWORD is empty a random one is generated and printed ONCE.
const WEAK = new Set(["admin12345", "password", "12345678", "admin1234", "changeme"]);
function initialPassword(): string {
  const given = process.env.INITIAL_ADMIN_PASSWORD?.trim();
  if (!given) return randomBytes(18).toString("base64url"); // 24 chars
  if (WEAK.has(given.toLowerCase()) || given.length < 12) {
    console.error(
      "INITIAL_ADMIN_PASSWORD is too weak (default or shorter than 12 characters).\n" +
        "Leave it empty to generate a random one, or set a strong value."
    );
    process.exit(1);
  }
  return given;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.INITIAL_ADMIN_EMAIL ?? "admin@cdti.ac.th";
  const password = initialPassword();
  const fullName = process.env.INITIAL_ADMIN_FULL_NAME ?? "CDTI System Administrator";

  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment."
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Create (or find) the auth user.
  const reset = process.argv.includes("--reset-password");
  let userId: string;
  let passwordSet = false;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // admin bootstrap shouldn't wait on an inbox
    user_metadata: {
      full_name: fullName,
      user_type: "teacher_staff",
    },
  });

  if (createError) {
    if (createError.message.toLowerCase().includes("already")) {
      console.log(`${email} already exists — repairing role only.`);
      const { data: list, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) throw listError;
      const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) {
        throw new Error(`${email} reported as existing but not found via listUsers().`);
      }
      userId = existing.id;
      // Never silently reset a live admin's password: only with an explicit flag.
      if (reset) {
        const { error } = await supabase.auth.admin.updateUserById(userId, { password });
        if (error) throw error;
        passwordSet = true;
      }
    } else {
      throw createError;
    }
  } else {
    userId = created.user.id;
    passwordSet = true;
    console.log(`Created auth user ${email} (${userId}).`);
  }

  // 2. handle_new_user() (0002_profiles.sql) already inserted a profiles row
  //    with role='user'. Promote it with the service role key (no JWT user:
  //    allowed by the role/flag triggers since 0026) and, when a new
  //    password was set, force a password change.
  const { error: updateError } = await supabase
    .from("profiles")
    .update(
      passwordSet
        ? { role: "admin", must_change_password: true, full_name: fullName }
        : { role: "admin", full_name: fullName }
    )
    .eq("id", userId);

  if (updateError) throw updateError;

  if (passwordSet) {
    console.log(`
Initial admin account ready:
  email:    ${email}
  password: ${password}
  (temporary — shown only now. Must be changed on first login; admin
   pages and admin database rights stay locked until it is.)

Log in at /login, then follow the forced /change-password flow.
`);
  } else {
    console.log(`Role repaired for ${email}. Password unchanged (use --reset-password to issue a new temporary one).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
