import assert from "node:assert/strict";
import test from "node:test";
import { isWithinLimit, MAX_PORTFOLIO_HOLDINGS, uniqueSymbolsWithinPortfolioLimit } from "../src/lib/limits.ts";

test("portfolio limit accepts the requested 25-holding boundary", () => {
  for (const count of [12, 13, 16, 17, 25]) assert.equal(isWithinLimit(count, MAX_PORTFOLIO_HOLDINGS), true);
  assert.equal(isWithinLimit(26, MAX_PORTFOLIO_HOLDINGS), false);
});

test("portfolio symbol validation deduplicates before enforcing the 25-holding cap", () => {
  assert.equal(uniqueSymbolsWithinPortfolioLimit(["RNVDAUSDT", "RNVDAUSDT"]).length, 1);
  assert.equal(uniqueSymbolsWithinPortfolioLimit(Array.from({ length: 25 }, (_, index) => `R${index}USDT`)).length, 25);
  assert.throws(() => uniqueSymbolsWithinPortfolioLimit(Array.from({ length: 26 }, (_, index) => `R${index}USDT`)), /up to 25 holdings/);
});
