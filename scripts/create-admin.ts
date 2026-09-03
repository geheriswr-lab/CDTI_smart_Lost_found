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
 * README Phase 12 explicitly calls out rotating the 'admin12345' default
 * before production deployment.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.INITIAL_ADMIN_EMAIL ?? "admin@cdti.ac.th";
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? "admin12345";
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
  let userId: string;

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
      console.log(`${email} already exists — looking it up to repair role/flags instead.`);
      const { data: list, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) throw listError;
      const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) {
        throw new Error(`${email} reported as existing but not found via listUsers().`);
      }
      userId = existing.id;
    } else {
      throw createError;
    }
  } else {
    userId = created.user.id;
    console.log(`Created auth user ${email} (${userId}).`);
  }

  // 2. handle_new_user() (0002_profiles.sql) already inserted a profiles row
  //    with role='user' via the auth.users trigger. Promote it to admin and
  //    force a password change — using the service role key, which bypasses
  //    both RLS and the trg_profiles_block_self_role_escalation /
  //    trg_profiles_protect_sensitive_fields triggers (those only apply to
  //    non-admin callers; this script runs with full DB privileges).
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      role: "admin",
      must_change_password: true,
      full_name: fullName,
    })
    .eq("id", userId);

  if (updateError) throw updateError;

  console.log(`
Initial admin account ready:
  email:    ${email}
  password: ${password}  (must be changed on first login — must_change_password=true)

Log in at /login, then follow the forced /change-password flow.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
