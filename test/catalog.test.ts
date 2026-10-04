import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HOLDINGS } from "../src/lib/catalog.ts";

test("default portfolio has seven popular holdings with diversified allocation weights", () => {
  assert.deepEqual(DEFAULT_HOLDINGS.map((holding) => holding.symbol), [
    "RNVDAUSDT",
    "RAAPLUSDT",
    "RSPYUSDT",
    "RJPMUSDT",
    "RLLYUSDT",
    "RAMZNUSDT",
    "RMSFTUSDT",
  ]);
  assert.equal(DEFAULT_HOLDINGS.length, 7);
  assert.equal(new Set(DEFAULT_HOLDINGS.map((holding) => holding.symbol)).size, 7);
  assert.equal(DEFAULT_HOLDINGS.reduce((total, holding) => total + holding.weight, 0), 90);
});
