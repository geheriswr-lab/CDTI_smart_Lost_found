import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

/**
 * Server-side client for use inside Server Components, Server Actions, and
 * Route Handlers. Still uses the anon key — it authenticates as the current
 * user via their session cookie, so it is STILL bound by RLS. This is what
 * "server-side authorization, don't trust the client" means in practice:
 * we re-check `auth.uid()` / profile.role on the server, but we still let
 * Postgres RLS be the final backstop, we don't bypass it here.
 *
 * For operations that must legitimately bypass RLS (admin bootstrap,
 * matching job, notification writer, etc.) use src/lib/supabase/admin.ts
 * instead, and only from trusted server-only code.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component that can't set cookies directly.
            // Safe to ignore as long as middleware.ts is refreshing the
            // session on every request (it is — see middleware.ts).
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // Same as above.
          }
        },
      },
    }
  );
}
