// Staff-only review aids. NEVER shown to claimants, never used to decide
// automatically — the decision is always made by a human (README rule:
// "ห้ามใช้ AI ตัดสินว่าใครเป็นเจ้าของ").

import { wordTokens } from "@/lib/matching/score";

export type SerialHint = "match" | "mismatch" | "not_provided" | "no_record";

export function normalizeSerial(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function serialHint(claimed: string | null | undefined, recorded: string | null | undefined): SerialHint {
  const a = normalizeSerial(claimed);
  const b = normalizeSerial(recorded);
  if (!b) return "no_record";
  if (!a) return "not_provided";
  return a === b ? "match" : "mismatch";
}

export type ClaimHints = {
  serial: SerialHint;
  /** Words from the finder's secret details that also appear in the claimant's answers. */
  secretOverlap: string[];
  secretWordCount: number;
  /** Words from the finder's exact location that appear in the claimant's "where/when" answer. */
  locationOverlap: string[];
};

export function buildClaimHints(
  answers: Record<string, unknown>,
  found: { secret_details: string | null; serial_number: string | null; exact_location: string | null }
): ClaimHints {
  const text = Object.entries(answers)
    .filter(([k, v]) => k !== "_form" && typeof v === "string")
    .map(([, v]) => v as string)
    .join(" ");
  const answerWords = wordTokens(text, { keepColors: true });
  const secretWords = wordTokens(found.secret_details, { keepColors: true });
  const whereWords = wordTokens(typeof answers.where_when === "string" ? answers.where_when : "", { keepColors: true });
  const locWords = wordTokens(found.exact_location, { keepColors: true });

  return {
    serial: serialHint(typeof answers.serial === "string" ? answers.serial : null, found.serial_number),
    secretOverlap: [...secretWords].filter((w) => answerWords.has(w)),
    secretWordCount: secretWords.size,
    locationOverlap: [...locWords].filter((w) => whereWords.has(w)),
  };
}
