import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PlatformSettings } from "./labels";

const FALLBACK: PlatformSettings = {
  id: 1, reward_fee_percent: 2, reward_fee_min: 0, reward_min: 20, reward_max: 5000,
  reward_offer_days: 30, vouchers_per_finder_30d: 3, payment_mode: "demo", updated_at: "", updated_by: null,
};

/** Current SE settings (readable by everyone; 0028). */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle();
  return data ? { ...data, reward_fee_percent: Number(data.reward_fee_percent), reward_fee_min: Number(data.reward_fee_min) } : FALLBACK;
}
