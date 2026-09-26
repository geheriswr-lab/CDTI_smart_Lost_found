// Phase 5 — Smart Matching: pure scoring (no I/O). See score.test.ts.
//
// Score out of 100 (README Phase 5):
//   Category 30 / Color 15 / Brand 15 / Location 20 / Date 10 / Keyword 10
//
// INFORMATION-ASYMMETRY RULE
// The lost side may use every field of the lost report (it belongs to the
// person who will see the result). The found side uses ONLY the finder's
// PUBLIC fields — never secret_details, serial_number, exact_location,
// exact_time or private images. Otherwise a claimant could edit their lost
// report repeatedly and watch the score change to reverse-engineer the
// finder's secret verification details.
//
// The result is only ever presented as "ความเป็นไปได้ที่รายการตรงกัน"
// (a likelihood band), never as proof of ownership.

export const WEIGHTS = {
  category: 30,
  color: 15,
  brand: 15,
  location: 20,
  date: 10,
  keyword: 10,
} as const;

/** Minimum score to store a potential match. */
export const MATCH_THRESHOLD = 40;
/** Minimum score to notify the lost-item reporter. */
export const NOTIFY_THRESHOLD = 50;
/** Found date may precede lost date by at most this many days (date-entry slack). */
export const EARLY_FOUND_SLACK_DAYS = 1;
/** Candidate window: found up to this many days after the loss. */
export const CANDIDATE_WINDOW_DAYS = 60;

export type LostForMatch = {
  id: string;
  reporter_id: string;
  category_id: string | null;
  item_name: string;
  brand: string | null;
  color: string | null;
  lost_date: string | null;
  location_id: string | null;
  description: string | null;
};

/** Public-only view of a found item — the only found data matching may use. */
export type FoundForMatch = {
  id: string;
  finder_id: string; // used ONLY to skip self-matches; never written to output
  category_id: string | null;
  general_name: string;
  color: string | null;
  found_date: string | null;
  location_id: string | null;
  description: string | null;
};

/** Column list for the service-role query — public columns + finder_id only. */
export const FOUND_MATCH_COLUMNS =
  "id, finder_id, category_id, general_name, color, found_date, location_id, description";
export const LOST_MATCH_COLUMNS =
  "id, reporter_id, category_id, item_name, brand, color, lost_date, location_id, description";

export type ScoreBreakdown = Record<keyof typeof WEIGHTS, number>;
export type MatchScore = { total: number; breakdown: ScoreBreakdown };

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function normalize(s: string | null | undefined): string {
  return (s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

const segmenter = new Intl.Segmenter("th", { granularity: "word" });

const STOPWORDS = new Set([
  "สี", "มี", "และ", "หรือ", "ที่", "ของ", "ใน", "บน", "กับ", "เป็น", "อยู่", "ได้", "ไม่", "มา", "ไป",
  "อัน", "ชิ้น", "ใบ", "ตัว", "เครื่อง", "แบบ", "ค่อนข้าง", "ประมาณ", "เล็ก", "ใหญ่", "เก่า", "ใหม่",
  "the", "a", "an", "and", "or", "of", "with", "in", "on",
]);

/** Word tokens (Thai-aware), lower-cased, without stopwords / 1-char noise. */
export function wordTokens(text: string | null | undefined, opts: { keepColors?: boolean } = {}): Set<string> {
  const out = new Set<string>();
  const t = normalize(text);
  if (!t) return out;
  for (const seg of segmenter.segment(t)) {
    if (!seg.isWordLike) continue;
    const w = seg.segment.trim();
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    if (!opts.keepColors && COLOR_WORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

/** Matching tokens: colour words removed (colour has its own criterion). */
export function tokens(...texts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of wordTokens(t)) out.add(w);
  return out;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLOR_GROUPS: Record<string, string[]> = {
  black: ["ดำ", "black"],
  white: ["ขาว", "white", "ครีม", "cream"],
  gray: ["เทา", "gray", "grey"],
  silver: ["เงิน", "silver"],
  gold: ["ทอง", "gold"],
  red: ["แดง", "red", "เลือดหมู"],
  pink: ["ชมพู", "pink"],
  orange: ["ส้ม", "orange"],
  yellow: ["เหลือง", "yellow"],
  green: ["เขียว", "green"],
  lightblue: ["ฟ้า", "light blue", "sky"],
  blue: ["น้ำเงิน", "blue", "กรม", "navy"],
  purple: ["ม่วง", "purple", "violet"],
  brown: ["น้ำตาล", "brown", "ช็อกโกแลต", "กากี", "khaki"],
  clear: ["ใส", "clear", "transparent"],
};

/** Colours people commonly confuse — half credit. */
const RELATED: [string, string][] = [
  ["blue", "lightblue"],
  ["silver", "gray"],
  ["white", "silver"],
  ["black", "gray"],
  ["red", "pink"],
  ["orange", "yellow"],
  ["brown", "orange"],
  ["purple", "pink"],
  ["gold", "yellow"],
];

const COLOR_WORDS = new Set(Object.values(COLOR_GROUPS).flat());

export function colorGroups(value: string | null): Set<string> {
  const v = normalize(value);
  const found = new Set<string>();
  if (!v) return found;
  for (const [group, words] of Object.entries(COLOR_GROUPS)) {
    for (const w of words) {
      if (!v.includes(w)) continue;
      // "น้ำเงิน" contains "เงิน": don't also count silver in that case.
      if (w === "เงิน" && v.includes("น้ำเงิน") && !v.replace(/น้ำเงิน/g, "").includes("เงิน")) continue;
      found.add(group);
    }
  }
  return found;
}

function scoreColor(a: string | null, b: string | null): number {
  const ga = colorGroups(a);
  const gb = colorGroups(b);
  if (ga.size === 0 || gb.size === 0) {
    // Unrecognised colour words: fall back to plain text equality.
    const na = normalize(a);
    return na && na === normalize(b) ? WEIGHTS.color : 0;
  }
  for (const g of ga) if (gb.has(g)) return WEIGHTS.color;
  for (const [x, y] of RELATED) {
    if ((ga.has(x) && gb.has(y)) || (ga.has(y) && gb.has(x))) return Math.round(WEIGHTS.color / 2);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

const BRAND_ALIASES: Record<string, string[]> = {
  apple: ["apple", "แอปเปิ้ล", "แอปเปิล", "iphone", "ไอโฟน", "ipad", "ไอแพด", "macbook", "airpods"],
  samsung: ["samsung", "ซัมซุง", "galaxy"],
  xiaomi: ["xiaomi", "เสียวหมี่", "redmi"],
  oppo: ["oppo", "ออปโป้"],
  vivo: ["vivo", "วีโว่"],
  huawei: ["huawei", "หัวเว่ย"],
  sony: ["sony", "โซนี่"],
  casio: ["casio", "คาสิโอ"],
  asus: ["asus", "เอซุส"],
  acer: ["acer", "เอเซอร์"],
  lenovo: ["lenovo", "เลอโนโว"],
  dell: ["dell", "เดลล์"],
  hp: ["hp"],
  nike: ["nike", "ไนกี้"],
  adidas: ["adidas", "อาดิดาส"],
  coach: ["coach", "โค้ช"],
};

function brandForms(brand: string): string[] {
  const b = normalize(brand);
  for (const forms of Object.values(BRAND_ALIASES)) if (forms.includes(b)) return forms;
  return [b];
}

/**
 * Lost brand (reporter's own data) vs the finder's PUBLIC text only.
 * Finders are advised not to publish brands, so this is often 0 — that is
 * intentional (see the information-asymmetry rule at the top of the file).
 */
function scoreBrand(lostBrand: string | null, found: FoundForMatch): number {
  const b = normalize(lostBrand);
  if (b.length < 2) return 0;
  const hay = ` ${normalize(found.general_name)} ${normalize(found.description)} `;
  return brandForms(b).some((f) => (/^[a-z0-9]+$/.test(f) ? new RegExp(`(^|[^a-z0-9])${f}([^a-z0-9]|$)`).test(hay) : hay.includes(f)))
    ? WEIGHTS.brand
    : 0;
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

export function dayDiff(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(toDate + "T00:00:00Z") - Date.parse(fromDate + "T00:00:00Z")) / 86_400_000);
}

function scoreDate(lostDate: string | null, foundDate: string | null): number {
  if (!lostDate || !foundDate) return 0;
  const d = dayDiff(lostDate, foundDate); // positive = found after lost
  if (d < -EARLY_FOUND_SLACK_DAYS) return 0;
  const gap = Math.max(0, d);
  if (gap <= 1) return WEIGHTS.date;
  if (gap <= 3) return 7;
  if (gap <= 7) return 4;
  if (gap <= 14) return 2;
  return 0;
}

/** A found item dated clearly BEFORE the loss can't be the same object. */
export function isImpossibleByDate(lostDate: string | null, foundDate: string | null): boolean {
  return !!lostDate && !!foundDate && dayDiff(lostDate, foundDate) < -EARLY_FOUND_SLACK_DAYS;
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

function scoreKeywords(lost: LostForMatch, found: FoundForMatch): number {
  const a = tokens(lost.item_name, lost.description);
  const b = tokens(found.general_name, found.description);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;
  const ratio = overlap / Math.min(a.size, b.size);
  return Math.min(WEIGHTS.keyword, Math.round(ratio * WEIGHTS.keyword));
}

// ---------------------------------------------------------------------------
// Total
// ---------------------------------------------------------------------------

export function scoreMatch(lost: LostForMatch, found: FoundForMatch): MatchScore {
  const breakdown: ScoreBreakdown = {
    category: lost.category_id && lost.category_id === found.category_id ? WEIGHTS.category : 0,
    color: scoreColor(lost.color, found.color),
    brand: scoreBrand(lost.brand, found),
    location: lost.location_id && lost.location_id === found.location_id ? WEIGHTS.location : 0,
    date: scoreDate(lost.lost_date, found.found_date),
    keyword: scoreKeywords(lost, found),
  };
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  return { total, breakdown };
}

export type ScoredPair = { lost_item_id: string; found_item_id: string; score: number; score_breakdown: ScoreBreakdown };

/** Scores candidates and keeps those worth storing. Pure. */
export function rankCandidates(lost: LostForMatch[], found: FoundForMatch[]): ScoredPair[] {
  const out: ScoredPair[] = [];
  for (const l of lost) {
    for (const f of found) {
      if (l.reporter_id === f.finder_id) continue; // same person on both sides
      if (isImpossibleByDate(l.lost_date, f.found_date)) continue;
      const { total, breakdown } = scoreMatch(l, f);
      if (total >= MATCH_THRESHOLD) {
        out.push({ lost_item_id: l.id, found_item_id: f.id, score: total, score_breakdown: breakdown });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export type Likelihood = "high" | "medium" | "low";

export function likelihood(score: number): Likelihood {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export const LIKELIHOOD_TH: Record<Likelihood, string> = {
  high: "ความเป็นไปได้สูง",
  medium: "ความเป็นไปได้ปานกลาง",
  low: "ความเป็นไปได้ต่ำ",
};
