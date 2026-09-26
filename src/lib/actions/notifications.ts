"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only is_read is writable by users (column grant in 0020); RLS limits the
// rows to the caller's own notifications. The explicit user_id filter is
// belt-and-braces.

export async function markNotificationReadAction(formData: FormData) {
  const profile = await requireProfile();
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("notifications").update({ is_read: true }).eq("id", id).eq("user_id", profile.id);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction() {
  const profile = await requireProfile();
  const supabase = await createClient();
  await supabase.from("notifications").update({ is_read: true }).eq("user_id", profile.id).eq("is_read", false);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
