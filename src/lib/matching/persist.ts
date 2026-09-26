// Phase 5 — Smart Matching: load candidates, score, store matches, notify.
//
// Takes a SERVICE-ROLE Supabase client as a parameter: matches,
// notifications and audit_logs have no client INSERT policy by design
// (0006/0009/0011), so only trusted server code can write them.
// No "server-only" import here so scripts/rematch-all.ts can reuse it;
// app code must go through ./engine.ts, which is server-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  CANDIDATE_WINDOW_DAYS,
  EARLY_FOUND_SLACK_DAYS,
  FOUND_MATCH_COLUMNS,
  LOST_MATCH_COLUMNS,
  NOTIFY_THRESHOLD,
  likelihood,
  rankCandidates,
  type FoundForMatch,
  type LostForMatch,
  type ScoredPair,
} from "./score";

type Admin = SupabaseClient<Database>;

/** Statuses that are still "open" for matching. */
export const MATCHABLE_LOST_STATUSES = ["reported", "matched"] as const;
export const MATCHABLE_FOUND_STATUSES = ["reported", "in_custody", "matched"] as const;
const CANDIDATE_LIMIT = 500;

export type MatchRunResult = { scored: number; created: number; updated: number; notified: number };

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadLost(admin: Admin, id: string): Promise<LostForMatch | null> {
  const { data, error } = await admin
    .from("lost_items")
    .select(LOST_MATCH_COLUMNS)
    .eq("id", id)
    .in("status", [...MATCHABLE_LOST_STATUSES])
    .maybeSingle();
  if (error) throw new Error(`load lost: ${error.message}`);
  return (data as unknown as LostForMatch) ?? null;
}

async function loadFound(admin: Admin, id: string): Promise<FoundForMatch | null> {
  const { data, error } = await admin
    .from("found_items")
    .select(FOUND_MATCH_COLUMNS) // public columns only — never secret/serial/exact_*
    .eq("id", id)
    .in("status", [...MATCHABLE_FOUND_STATUSES])
    .maybeSingle();
  if (error) throw new Error(`load found: ${error.message}`);
  return (data as unknown as FoundForMatch) ?? null;
}

async function foundCandidatesFor(admin: Admin, lost: LostForMatch): Promise<FoundForMatch[]> {
  let q = admin.from("found_items").select(FOUND_MATCH_COLUMNS).in("status", [...MATCHABLE_FOUND_STATUSES]);
  if (lost.lost_date) {
    const from = addDays(lost.lost_date, -EARLY_FOUND_SLACK_DAYS);
    const to = addDays(lost.lost_date, CANDIDATE_WINDOW_DAYS);
    q = q.or(`found_date.is.null,and(found_date.gte.${from},found_date.lte.${to})`);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(CANDIDATE_LIMIT);
  if (error) throw new Error(`found candidates: ${error.message}`);
  return (data ?? []) as unknown as FoundForMatch[];
}

async function lostCandidatesFor(admin: Admin, found: FoundForMatch): Promise<LostForMatch[]> {
  let q = admin.from("lost_items").select(LOST_MATCH_COLUMNS).in("status", [...MATCHABLE_LOST_STATUSES]);
  if (found.found_date) {
    const from = addDays(found.found_date, -CANDIDATE_WINDOW_DAYS);
    const to = addDays(found.found_date, EARLY_FOUND_SLACK_DAYS);
    q = q.or(`lost_date.is.null,and(lost_date.gte.${from},lost_date.lte.${to})`);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(CANDIDATE_LIMIT);
  if (error) throw new Error(`lost candidates: ${error.message}`);
  return (data ?? []) as unknown as LostForMatch[];
}

/**
 * Upserts scored pairs. New pairs get an audit log entry and (above the
 * notify threshold) a notification to the LOST reporter — one per lost
 * item per run, never to the finder, and never containing any found-item
 * private data.
 */
export async function persistMatches(
  admin: Admin,
  pairs: ScoredPair[],
  reporterOf: Map<string, string>
): Promise<MatchRunResult> {
  const result: MatchRunResult = { scored: pairs.length, created: 0, updated: 0, notified: 0 };
  if (pairs.length === 0) return result;

  const lostIds = [...new Set(pairs.map((p) => p.lost_item_id))];
  const foundIds = [...new Set(pairs.map((p) => p.found_item_id))];
  const { data: existing, error: exErr } = await admin
    .from("matches")
    .select("id, lost_item_id, found_item_id, score")
    .in("lost_item_id", lostIds)
    .in("found_item_id", foundIds);
  if (exErr) throw new Error(`existing matches: ${exErr.message}`);

  const key = (l: string, f: string) => `${l}|${f}`;
  const existingMap = new Map((existing ?? []).map((m) => [key(m.lost_item_id, m.found_item_id), m]));

  const fresh = pairs.filter((p) => !existingMap.has(key(p.lost_item_id, p.found_item_id)));
  const changed = pairs.filter((p) => {
    const m = existingMap.get(key(p.lost_item_id, p.found_item_id));
    return m && Number(m.score) !== p.score;
  });

  // Re-scores of known pairs: update quietly (no new notification).
  for (const p of changed) {
    const { error } = await admin
      .from("matches")
      .update({ score: p.score, score_breakdown: p.score_breakdown })
      .eq("lost_item_id", p.lost_item_id)
      .eq("found_item_id", p.found_item_id);
    if (error) throw new Error(`update match: ${error.message}`);
    result.updated++;
  }

  if (fresh.length === 0) return result;

  // ignoreDuplicates makes concurrent runs (lost + found reported at the same
  // moment) safe against the unique (lost_item_id, found_item_id) constraint.
  const { data: inserted, error: insErr } = await admin
    .from("matches")
    .upsert(fresh, { onConflict: "lost_item_id,found_item_id", ignoreDuplicates: true })
    .select("id, lost_item_id, found_item_id, score");
  if (insErr) throw new Error(`insert matches: ${insErr.message}`);
  const created = inserted ?? [];
  result.created = created.length;
  if (created.length === 0) return result;

  await admin.from("audit_logs").insert(
    created.map((m) => ({
      actor_id: null, // system action
      action: "match.created",
      entity_type: "match",
      entity_id: m.id,
      metadata: { lost_item_id: m.lost_item_id, found_item_id: m.found_item_id, score: Number(m.score) },
    }))
  );

  // One notification per lost item, only for matches above NOTIFY_THRESHOLD.
  const byLost = new Map<string, { found: string[]; best: number }>();
  for (const m of created) {
    const score = Number(m.score);
    if (score < NOTIFY_THRESHOLD) continue;
    const entry = byLost.get(m.lost_item_id) ?? { found: [], best: 0 };
    entry.found.push(m.found_item_id);
    entry.best = Math.max(entry.best, score);
    byLost.set(m.lost_item_id, entry);
  }

  const notifications = [...byLost.entries()]
    .map(([lostId, { found, best }]) => {
      const userId = reporterOf.get(lostId);
      if (!userId) return null;
      return {
        user_id: userId,
        type: "potential_match",
        title: "พบรายการที่อาจตรงกับของที่คุณแจ้งหาย",
        message:
          found.length === 1
            ? "มีประกาศพบของ 1 รายการที่อาจตรงกับของที่คุณแจ้งหาย — นี่เป็นเพียงความเป็นไปได้ กรุณาตรวจสอบรายละเอียด"
            : `มีประกาศพบของ ${found.length} รายการที่อาจตรงกับของที่คุณแจ้งหาย — นี่เป็นเพียงความเป็นไปได้ กรุณาตรวจสอบรายละเอียด`,
        // Ids + likelihood band only. No found-item text, no finder identity.
        payload: { lost_item_id: lostId, found_item_ids: found, likelihood: likelihood(best) },
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);

  if (notifications.length > 0) {
    const { error } = await admin.from("notifications").insert(notifications);
    if (error) throw new Error(`notify: ${error.message}`);
    result.notified = notifications.length;
  }
  return result;
}

export async function matchLostItem(admin: Admin, lostId: string): Promise<MatchRunResult> {
  const lost = await loadLost(admin, lostId);
  if (!lost) return { scored: 0, created: 0, updated: 0, notified: 0 };
  const candidates = await foundCandidatesFor(admin, lost);
  const pairs = rankCandidates([lost], candidates);
  return persistMatches(admin, pairs, new Map([[lost.id, lost.reporter_id]]));
}

export async function matchFoundItem(admin: Admin, foundId: string): Promise<MatchRunResult> {
  const found = await loadFound(admin, foundId);
  if (!found) return { scored: 0, created: 0, updated: 0, notified: 0 };
  const candidates = await lostCandidatesFor(admin, found);
  const pairs = rankCandidates(candidates, [found]);
  return persistMatches(admin, pairs, new Map(candidates.map((l) => [l.id, l.reporter_id])));
}
