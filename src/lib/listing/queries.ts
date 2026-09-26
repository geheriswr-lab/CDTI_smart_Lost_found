import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PUBLIC_BUCKET } from "@/lib/reports/storage";
import {
  PUBLIC_FOUND_SELECT,
  PUBLIC_LOST_SELECT,
  pageRange,
  toPublicFoundCard,
  toPublicLostCard,
  type PublicFoundCard,
  type PublicLostCard,
  type PublicSearch,
} from "./search";

// Everything here reads ONLY from the public views (public_found_items /
// public_lost_items). The base tables are never touched on public pages.

export type WithImage<T> = T & { image_src: string | null };
export type ListingResult<T> = { items: WithImage<T>[]; total: number; error: boolean };

type Client = Awaited<ReturnType<typeof createClient>>;

function imageSrc(supabase: Client, path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function searchPublicFound(s: PublicSearch): Promise<ListingResult<PublicFoundCard>> {
  const supabase = await createClient();
  const { from, to } = pageRange(s.page);

  let query = supabase.from("public_found_items").select(PUBLIC_FOUND_SELECT, { count: "exact" });
  // q / color are pre-sanitised by parsePublicSearch (no , ( ) . * % _ " left),
  // so they cannot alter the PostgREST filter expression.
  if (s.q) query = query.or(`general_name.ilike."*${s.q}*",description.ilike."*${s.q}*"`);
  if (s.category) query = query.eq("category_id", s.category);
  if (s.location) query = query.eq("location_id", s.location);
  if (s.color) query = query.ilike("color", `%${s.color}%`);
  if (s.from) query = query.gte("found_date", s.from);
  if (s.to) query = query.lte("found_date", s.to);

  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) return { items: [], total: 0, error: true };

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return {
    items: rows.map((r) => {
      const card = toPublicFoundCard(r);
      return { ...card, image_src: imageSrc(supabase, card.public_image_url) };
    }),
    total: count ?? 0,
    error: false,
  };
}

export async function searchPublicLost(s: PublicSearch): Promise<ListingResult<PublicLostCard>> {
  const supabase = await createClient();
  const { from, to } = pageRange(s.page);

  let query = supabase.from("public_lost_items").select(PUBLIC_LOST_SELECT, { count: "exact" });
  if (s.q) query = query.or(`item_name.ilike."*${s.q}*",description.ilike."*${s.q}*"`);
  if (s.category) query = query.eq("category_id", s.category);
  if (s.location) query = query.eq("location_id", s.location);
  if (s.color) query = query.ilike("color", `%${s.color}%`);
  if (s.from) query = query.gte("lost_date", s.from);
  if (s.to) query = query.lte("lost_date", s.to);

  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) return { items: [], total: 0, error: true };

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return {
    items: rows.map((r) => {
      const card = toPublicLostCard(r);
      return { ...card, image_src: imageSrc(supabase, card.public_image_url) };
    }),
    total: count ?? 0,
    error: false,
  };
}

export async function getPublicFound(id: string): Promise<WithImage<PublicFoundCard> | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("public_found_items").select(PUBLIC_FOUND_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const card = toPublicFoundCard(data as unknown as Record<string, unknown>);
  return { ...card, image_src: imageSrc(supabase, card.public_image_url) };
}

export async function getPublicLost(id: string): Promise<WithImage<PublicLostCard> | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("public_lost_items").select(PUBLIC_LOST_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const card = toPublicLostCard(data as unknown as Record<string, unknown>);
  return { ...card, image_src: imageSrc(supabase, card.public_image_url) };
}
