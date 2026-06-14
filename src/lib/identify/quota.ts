import { type SupabaseClient } from "@/lib/supabase";
import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import { HttpError } from "@/lib/api/http";

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function consumeSlot(supabase: SupabaseClient, period: string): Promise<void> {
  const { data: consumed, error } = await supabase.rpc("try_consume_image_usage", {
    p_period: period,
    p_limit: IDENTIFY_CONFIG.dailyImageLimit,
  });
  if (error) throw new HttpError(503, { error: "Usage check failed" });
  if (!consumed.allowed) {
    throw new HttpError(429, {
      error: "Daily limit reached",
      limit: IDENTIFY_CONFIG.dailyImageLimit,
      used: consumed.used,
    });
  }
}

export async function refundSlot(supabase: SupabaseClient, period: string): Promise<void> {
  // Best-effort: a failed refund only costs the user one slot.
  await supabase.rpc("refund_image_usage", { p_period: period });
}
