import assert from "node:assert/strict";
import test from "node:test";
import { positionOverviewCacheKey, isPositionOverviewCacheFresh } from "../src/lib/position-overview-cache.ts";

test("Position Overview cache separates asset and news responses", () => {
  assert.notEqual(positionOverviewCacheKey("RMSFTUSDT", "asset"), positionOverviewCacheKey("RMSFTUSDT", "news"));
  assert.notEqual(positionOverviewCacheKey("RMSFTUSDT", "asset"), positionOverviewCacheKey("RNVDAUSDT", "asset"));
});

test("Position Overview cache expires at its five-minute boundary", () => {
  const fetchedAt = 1_000_000;
  const entry = { data: {} as never, fetchedAt };

  assert.equal(isPositionOverviewCacheFresh(entry, fetchedAt + (5 * 60_000) - 1), true);
  assert.equal(isPositionOverviewCacheFresh(entry, fetchedAt + (5 * 60_000)), false);
});
