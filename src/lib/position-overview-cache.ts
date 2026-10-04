import type { PositionOverviewResponse } from "./types";

export const POSITION_OVERVIEW_CACHE_TTL_MS = 5 * 60_000;

export type PositionOverviewMode = "asset" | "news";
export type PositionOverviewCacheEntry = {
  data: PositionOverviewResponse;
  fetchedAt: number;
};

export function positionOverviewCacheKey(symbol: string, mode: PositionOverviewMode) {
  return `${symbol}:${mode}`;
}

export function isPositionOverviewCacheFresh(entry: PositionOverviewCacheEntry, now = Date.now()) {
  return now - entry.fetchedAt < POSITION_OVERVIEW_CACHE_TTL_MS;
}
