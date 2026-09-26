import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PUBLIC_BUCKET } from "@/lib/reports/storage";
import { PUBLIC_FOUND_SELECT, toPublicFoundCard, type PublicFoundCard } from "@/lib/listing/search";
import { likelihood, type Likelihood } from "./score";

export type MatchForOwner = {
  found: PublicFoundCard & { image_src: string | null };
  likelihood: Likelihood;
  created_at: string;
};

/**
 * Potential matches for one of the CURRENT user's lost items.
 * - matches: RLS limits rows to the lost reporter (and staff); we also
 *   filter by lost_item_id the caller has already verified they own.
 * - found item data comes ONLY from the public view — the owner sees
 *   exactly what any guest sees about the found item, nothing more.
 * - the raw score / breakdown is reduced to a likelihood band.
 */
export async function getMatchesForLostItem(lostItemId: string): Promise<MatchForOwner[]> {
  const supabase = await createClient();
  const { data: matches } = await supabase
    .from("matches")
    .select("found_item_id, score, created_at")
    .eq("lost_item_id", lostItemId)
    .order("score", { ascending: false })
    .limit(20);
  if (!matches || matches.length === 0) return [];

  const { data: rows } = await supabase
    .from("public_found_items")
    .select(PUBLIC_FOUND_SELECT)
    .in("id", matches.map((m) => m.found_item_id));

  const byId = new Map(
    ((rows ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const card = toPublicFoundCard(r);
      const image_src = card.public_image_url
        ? supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(card.public_image_url).data.publicUrl
        : null;
      return [card.id, { ...card, image_src }];
    })
  );

  // Found items that are no longer public (returned/closed) drop out here.
  return matches
    .filter((m) => byId.has(m.found_item_id))
    .map((m) => ({
      found: byId.get(m.found_item_id)!,
      likelihood: likelihood(Number(m.score)),
      created_at: m.created_at,
    }));
}

/** Number of potential matches per lost item id (for the dashboard list). */
export async function countMatchesByLostItem(lostItemIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (lostItemIds.length === 0) return counts;
  const supabase = await createClient();
  const { data } = await supabase.from("matches").select("lost_item_id").in("lost_item_id", lostItemIds);
  for (const m of data ?? []) counts.set(m.lost_item_id, (counts.get(m.lost_item_id) ?? 0) + 1);
  return counts;
}
