"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import {
  checkImage,
  mapReportDbError,
  validateFoundReport,
  validateLostReport,
  type FieldErrors,
  type ImageCheck,
} from "@/lib/reports/validation";
import { PRIVATE_BUCKET, PUBLIC_BUCKET } from "@/lib/reports/storage";
import { runMatchingSafely } from "@/lib/matching/engine";

export type ReportFormState = {
  error: string | null;
  fieldErrors: FieldErrors;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type ValidImage = Extract<ImageCheck, { ok: true }>;

/**
 * Public images:  `<kind>/<random>.<ext>`        (no user id — the path is part
 *                 of a public URL; ownership is tracked by storage owner_id)
 * Private images: `<uid>/<kind>/<random>.<ext>`  (never shown publicly)
 * The storage policies (0016/0019) and the DB guard (0018/0019) enforce
 * these conventions. File names are always random so they never carry the
 * user's original filename (which can contain personal info).
 */
async function upload(
  supabase: SupabaseServerClient,
  bucket: string,
  userId: string,
  kind: "lost" | "found",
  image: ValidImage
): Promise<string | null> {
  if (!image.file) return null;
  const file = `${randomUUID()}.${image.ext}`;
  const path = bucket === PUBLIC_BUCKET ? `${kind}/${file}` : `${userId}/${kind}/${file}`;
  const { error } = await supabase.storage.from(bucket).upload(path, image.file, {
    contentType: image.mime, // sniffed from magic bytes, not the client's claim
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw new Error("UPLOAD_FAILED");
  return path;
}

/** Only the public-bucket object can be removed by its owner (0016 policies). */
async function cleanupPublic(supabase: SupabaseServerClient, path: string | null) {
  if (path) await supabase.storage.from(PUBLIC_BUCKET).remove([path]);
}

async function assertActiveReference(
  supabase: SupabaseServerClient,
  categoryId: string,
  locationId: string | null
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const { data: cat } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("is_active", true)
    .maybeSingle();
  if (!cat) errors.category_id = "ประเภทสิ่งของไม่ถูกต้อง";

  if (locationId) {
    const { data: loc } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("is_active", true)
      .maybeSingle();
    if (!loc) errors.location_id = "สถานที่ไม่ถูกต้อง";
  }
  return errors;
}

async function checkImages(formData: FormData) {
  const pub = await checkImage(formData.get("public_image"));
  const priv = await checkImage(formData.get("private_image"));
  const errors: FieldErrors = {};
  if (!pub.ok) errors.public_image = pub.error;
  if (!priv.ok) errors.private_image = priv.error;
  return { pub, priv, errors };
}

const INVALID_FORM = "กรุณาตรวจสอบข้อมูลที่ไฮไลต์ไว้";

// ---------------------------------------------------------------------------
// Report lost item
// ---------------------------------------------------------------------------
export async function reportLostItemAction(
  _prev: ReportFormState,
  formData: FormData
): Promise<ReportFormState> {
  // Identity always comes from the session — never from the form.
  const profile = await requireProfile();
  if (profile.is_restricted) {
    return { error: mapReportDbError("REPORT_FORBIDDEN"), fieldErrors: {} };
  }

  const parsed = validateLostReport(formData);
  const images = await checkImages(formData);
  const fieldErrors = { ...(parsed.ok ? {} : parsed.errors), ...images.errors };
  if (!parsed.ok || !images.pub.ok || !images.priv.ok) {
    return { error: INVALID_FORM, fieldErrors };
  }

  const supabase = await createClient();
  const refErrors = await assertActiveReference(supabase, parsed.data.category_id, parsed.data.location_id);
  if (Object.keys(refErrors).length > 0) return { error: INVALID_FORM, fieldErrors: refErrors };

  let publicPath: string | null = null;
  let privatePath: string | null = null;
  try {
    publicPath = await upload(supabase, PUBLIC_BUCKET, profile.id, "lost", images.pub);
    privatePath = await upload(supabase, PRIVATE_BUCKET, profile.id, "lost", images.priv);
  } catch {
    await cleanupPublic(supabase, publicPath);
    return { error: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่", fieldErrors: {} };
  }

  const { data: created, error } = await supabase.from("lost_items").insert({
    ...parsed.data,
    reporter_id: profile.id,
    public_image_url: publicPath,
    private_image_url: privatePath,
  })
    .select("id")
    .single();

  if (error || !created) {
    await cleanupPublic(supabase, publicPath);
    return { error: mapReportDbError(error?.message), fieldErrors: {} };
  }

  // Phase 5: suggest potential matches. Failures are logged, never shown —
  // the report itself is already saved.
  await runMatchingSafely("lost", created.id);

  revalidatePath("/dashboard");
  revalidatePath("/lost");
  redirect("/dashboard?reported=lost");
}

// ---------------------------------------------------------------------------
// Report found item
// ---------------------------------------------------------------------------
export async function reportFoundItemAction(
  _prev: ReportFormState,
  formData: FormData
): Promise<ReportFormState> {
  const profile = await requireProfile();
  if (profile.is_restricted) {
    return { error: mapReportDbError("REPORT_FORBIDDEN"), fieldErrors: {} };
  }

  const parsed = validateFoundReport(formData);
  const images = await checkImages(formData);
  const fieldErrors = { ...(parsed.ok ? {} : parsed.errors), ...images.errors };
  if (!parsed.ok || !images.pub.ok || !images.priv.ok) {
    return { error: INVALID_FORM, fieldErrors };
  }

  const supabase = await createClient();
  const refErrors = await assertActiveReference(supabase, parsed.data.category_id, parsed.data.location_id);
  if (Object.keys(refErrors).length > 0) return { error: INVALID_FORM, fieldErrors: refErrors };

  let publicPath: string | null = null;
  let privatePath: string | null = null;
  try {
    publicPath = await upload(supabase, PUBLIC_BUCKET, profile.id, "found", images.pub);
    privatePath = await upload(supabase, PRIVATE_BUCKET, profile.id, "found", images.priv);
  } catch {
    await cleanupPublic(supabase, publicPath);
    return { error: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่", fieldErrors: {} };
  }

  // status is forced to 'reported' by the DB guard regardless; custody is
  // limited to the two finder-declarable states there too.
  const { data: created, error } = await supabase.from("found_items").insert({
    ...parsed.data,
    finder_id: profile.id,
    public_image_url: publicPath,
    private_image_url: privatePath,
  })
    .select("id")
    .single();

  if (error || !created) {
    await cleanupPublic(supabase, publicPath);
    return { error: mapReportDbError(error?.message), fieldErrors: {} };
  }

  // Phase 5: suggest potential matches. Failures are logged, never shown —
  // the report itself is already saved.
  await runMatchingSafely("found", created.id);

  revalidatePath("/dashboard");
  revalidatePath("/found");
  redirect("/dashboard?reported=found");
}
