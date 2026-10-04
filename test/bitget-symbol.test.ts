import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRealitySymbol } from "../src/lib/reality-symbol.ts";

test("Reality symbol normalization supports tokens, pair symbols, and exact underlying tickers", () => {
  assert.equal(normalizeRealitySymbol("rAAPL"), "RAAPLUSDT");
  assert.equal(normalizeRealitySymbol("RAAPLUSDT"), "RAAPLUSDT");
  assert.equal(normalizeRealitySymbol("AAPL"), "RAAPLUSDT");
});

test("Reality symbol normalization does not guess from company names or free text", () => {
  assert.equal(normalizeRealitySymbol("Apple Inc"), "");
  assert.equal(normalizeRealitySymbol("should I hold AAPL"), "");
  assert.equal(normalizeRealitySymbol(""), "");
});
