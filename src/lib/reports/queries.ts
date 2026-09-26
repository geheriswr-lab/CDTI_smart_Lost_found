import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Category, HandoverLocation, Location } from "@/types/database.types";
import { PRIVATE_BUCKET, PRIVATE_URL_TTL_SECONDS, PUBLIC_BUCKET } from "./storage";

export type ReferenceData = {
  categories: Pick<Category, "id" | "name_th" | "is_high_value">[];
  locations: Pick<Location, "id" | "name">[];
  handoverLocations: Pick<HandoverLocation, "id" | "name" | "address">[];
};

/** Active categories / locations / drop-off points for the report forms. */
export async function getReferenceData(): Promise<ReferenceData> {
  const supabase = await createClient();
  const [cats, locs, handovers] = await Promise.all([
    supabase.from("categories").select("id, name_th, is_high_value").eq("is_active", true).order("name_th"),
    supabase.from("locations").select("id, name").eq("is_active", true).order("name"),
    supabase.from("handover_locations").select("id, name, address").eq("is_active", true).order("name"),
  ]);
  return {
    categories: cats.data ?? [],
    locations: locs.data ?? [],
    handoverLocations: handovers.data ?? [],
  };
}

/** Builds the public URL for an object path stored in `public_image_url`. */
export async function publicImageUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  return supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Short-lived signed URL for an object in the private bucket. Storage RLS
 * (0016) only lets the uploader or staff sign it, so calling this for
 * someone else's file simply returns null.
 */
export async function privateImageUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, PRIVATE_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
