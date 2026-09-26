// Pure helpers for the public listing (Phase 4). No Supabase imports so they
// can be unit-tested (see search.test.ts).
//
// Two independent guards keep verification data out of public responses:
//   1. The DB views (0015) only contain whitelisted columns.
//   2. This module selects an explicit column list AND re-picks only
//      whitelisted keys before anything is rendered — so even if a view is
//      ever widened by mistake, extra columns never reach the page.

import type { PublicFoundItem, PublicLostItem } from "@/types/database.types";

export const PAGE_SIZE = 12;
const MAX_PAGE = 500;
const MAX_QUERY_LEN = 60;

export const PUBLIC_FOUND_FIELDS = [
  "id",
  "category_id",
  "category_name_th",
  "general_name",
  "color",
  "found_date",
  "location_id",
  "location_name",
  "description",
  "public_image_url",
  "status",
  "created_at",
] as const satisfies readonly (keyof PublicFoundItem)[];

export const PUBLIC_LOST_FIELDS = [
  "id",
  "category_id",
  "category_name_th",
  "item_name",
  "color",
  "lost_date",
  "location_id",
  "location_name",
  "description",
  "public_image_url",
  "status",
  "created_at",
] as const satisfies readonly (keyof PublicLostItem)[];

/** Column names that must never appear in any public query or response. */
export const FORBIDDEN_PUBLIC_FIELDS = [
  "finder_id",
  "reporter_id",
  "secret_details",
  "serial_number",
  "exact_location",
  "exact_time",
  "private_image_url",
  "private_ownership_details",
  "custody_status",
  "brand",
] as const;

export type PublicFoundCard = Pick<PublicFoundItem, (typeof PUBLIC_FOUND_FIELDS)[number]>;
export type PublicLostCard = Pick<PublicLostItem, (typeof PUBLIC_LOST_FIELDS)[number]>;

export const PUBLIC_FOUND_SELECT = PUBLIC_FOUND_FIELDS.join(", ");
export const PUBLIC_LOST_SELECT = PUBLIC_LOST_FIELDS.join(", ");

function pick<K extends string>(row: Record<string, unknown>, keys: readonly K[]): Record<K, unknown> {
  const out = {} as Record<K, unknown>;
  for (const k of keys) out[k] = row[k] ?? null;
  return out;
}

export function toPublicFoundCard(row: Record<string, unknown>): PublicFoundCard {
  return pick(row, PUBLIC_FOUND_FIELDS) as PublicFoundCard;
}

export function toPublicLostCard(row: Record<string, unknown>): PublicLostCard {
  return pick(row, PUBLIC_LOST_FIELDS) as PublicLostCard;
}

// ---------------------------------------------------------------------------
// Search params
// ---------------------------------------------------------------------------

export type PublicSearch = {
  q: string | null;
  category: string | null;
  color: string | null;
  location: string | null;
  from: string | null;
  to: string | null;
  page: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

/**
 * Keeps letters (incl. Thai vowels/tone marks), digits, spaces and hyphens.
 * Everything else is dropped, which also neutralises PostgREST filter
 * syntax (`,` `(` `)` `.` `*`) and LIKE wildcards (`%` `_`) — so user input
 * can never change the shape of the query.
 */
export function sanitizeText(value: string, max = MAX_QUERY_LEN): string | null {
  const cleaned = value
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned === "" ? null : cleaned;
}

function validDate(v: string): string | null {
  return DATE_RE.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) ? v : null;
}

export function parsePublicSearch(params: RawParams): PublicSearch {
  const category = first(params.category);
  const location = first(params.location);
  let from = validDate(first(params.from));
  let to = validDate(first(params.to));
  if (from && to && from > to) [from, to] = [to, from];

  const pageNum = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1;

  return {
    q: sanitizeText(first(params.q)),
    category: UUID_RE.test(category) ? category : null,
    color: sanitizeText(first(params.color), 30),
    location: UUID_RE.test(location) ? location : null,
    from,
    to,
    page,
  };
}

export function hasActiveFilters(s: PublicSearch): boolean {
  return !!(s.q || s.category || s.color || s.location || s.from || s.to);
}

/** Builds a listing URL, dropping empty params. */
export function buildSearchHref(basePath: string, s: Partial<PublicSearch>): string {
  const params = new URLSearchParams();
  for (const key of ["q", "category", "color", "location", "from", "to"] as const) {
    const v = s[key];
    if (v) params.set(key, v);
  }
  if (s.page && s.page > 1) params.set("page", String(s.page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function pageRange(page: number): { from: number; to: number } {
  const from = (page - 1) * PAGE_SIZE;
  return { from, to: from + PAGE_SIZE - 1 };
}
