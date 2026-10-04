import assert from "node:assert/strict";
import test from "node:test";
import { classifyAssetMetadata } from "../src/lib/classification.ts";

test("deterministic classification maps semiconductor companies to Technology with an AI theme", () => {
  const classification = classifyAssetMetadata({ industry: "Semiconductors & Related Devices", name: "NVIDIA CORP", sic: "3674", secMatched: true });

  assert.equal(classification.sector, "Technology");
  assert.deepEqual(classification.themes, ["AI & Semiconductors"]);
  assert.deepEqual(classification.styles, []);
  assert.equal(classification.source, "SEC");
});

test("deterministic classification keeps broad-market ETFs separate from Growth style", () => {
  const classification = classifyAssetMetadata({ name: "Invesco QQQ Trust NASDAQ-100", kind: "ETF", secMatched: true });

  assert.equal(classification.sector, "Broad Market");
  assert.deepEqual(classification.styles, ["Growth"]);
  assert.equal(classification.assetClass, "ETF");
});

test("deterministic classification uses SIC when the description is unavailable", () => {
  const classification = classifyAssetMetadata({ name: "Example financial company", sic: "6021", secMatched: true });

  assert.equal(classification.sector, "Finance");
  assert.equal(classification.source, "SEC");
});

test("deterministic classification covers consumer durable SIC ranges", () => {
  const classification = classifyAssetMetadata({ industry: "Mobile Homes", sic: "2451", secMatched: true });

  assert.equal(classification.sector, "Consumer");
});

test("deterministic classification does not invent a category for insufficient metadata", () => {
  const classification = classifyAssetMetadata({ name: "Unknown Reality instrument" });

  assert.equal(classification.sector, "Unclassified");
  assert.equal(classification.source, "UNCLASSIFIED");
});
