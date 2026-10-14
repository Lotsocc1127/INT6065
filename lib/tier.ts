import { tierOf, type Tier } from "./mastery";

export const TIERS: Tier[] = ["foundation", "intermediate", "advanced"];

export function isValidTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as string[]).includes(v);
}

/**
 * 有效分层 = 教师锁定（tierOverride）?? 掌握度自动判定。
 * 存值非法时视为 null（回到自动判定）。
 */
export function effectiveTierOf(avgMastery: number, override: string | null | undefined): Tier {
  return isValidTier(override) ? override : tierOf(avgMastery);
}
