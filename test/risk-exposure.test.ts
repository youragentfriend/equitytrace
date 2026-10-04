import assert from "node:assert/strict";
import test from "node:test";
import { calculatePortfolioHealth, calculateRiskExposure } from "../src/lib/portfolio.ts";
import type { MarketAsset } from "../src/lib/types.ts";

function asset(symbol: string, token: string, closes: number[], color: string): MarketAsset {
  return {
    symbol,
    token,
    name: `${token} test instrument`,
    sector: "Technology",
    color,
    role: "test",
    instrument: { category: "SCOIN-FUTURES", symbol, baseCoin: token, quoteCoin: "USDT", isReality: "Yes", status: "online" },
    ticker: {
      category: "SCOIN-FUTURES",
      symbol,
      ts: String(Date.now()),
      lastPrice: String(closes.at(-1)),
      openPrice24h: String(closes.at(-2) ?? closes.at(-1)),
      highPrice24h: String(closes.at(-1)),
      lowPrice24h: String(closes.at(-1)),
      ask1Price: String((closes.at(-1) ?? 0) + 0.1),
      bid1Price: String((closes.at(-1) ?? 0) - 0.1),
      bid1Size: "100",
      ask1Size: "100",
      price24hPcnt: "0.01",
      volume24h: "1000",
      turnover24h: "100000",
    },
    candles: closes.map((close, index) => [String(Date.UTC(2026, 0, index + 1)), String(close), String(close), String(close), String(close), "1", "1"]),
  };
}

test("risk exposure returns dynamic ratios and a correlation matrix for the selected window", () => {
  const assets = [
    asset("RSPYUSDT", "rSPY", [100, 102, 100, 103, 101, 104], "#5de2ff"),
    asset("RTECHUSDT", "rTECH", [100, 101, 99, 102, 100, 103], "#8a78ff"),
    asset("RHEALTHUSDT", "rHEALTH", [100, 99, 101, 98, 100, 97], "#71e9ad"),
  ];
  const exposure = calculateRiskExposure([{ symbol: "RTECHUSDT", weight: 70 }, { symbol: "RHEALTHUSDT", weight: 30 }], assets, 10_000, 5);

  assert.equal(exposure.window, 5);
  assert.equal(exposure.observationCount, 5);
  assert.equal(exposure.correlation.assets.map((item) => item.symbol).join(","), "RTECHUSDT,RHEALTHUSDT");
  assert.equal(exposure.correlation.values.length, 2);
  assert.equal(exposure.riskReturn.length, 4);
  assert.ok(exposure.diversificationRatio !== null && exposure.diversificationRatio > 0);
  assert.ok(Math.abs((exposure.correlation.values[0]?.[0] ?? 0) - 1) < 1e-10);
  assert.ok((exposure.correlation.values[0]?.[1] ?? 0) < 1);
  assert.ok(Number.isFinite(exposure.annualizedReturn));
  assert.ok(exposure.volatility > 0);
  assert.ok(exposure.sortino !== null);
  assert.equal(exposure.cashWeight, 0);
});

test("risk exposure observes a shorter chart window without changing the portfolio risk-signal model", () => {
  const assets = [
    asset("RSPYUSDT", "rSPY", [100, 102, 100, 103, 101, 104], "#5de2ff"),
    asset("RTECHUSDT", "rTECH", [100, 101, 99, 102, 100, 103], "#8a78ff"),
  ];
  const exposure = calculateRiskExposure([{ symbol: "RTECHUSDT", weight: 80 }], assets, 10_000, 3);

  assert.equal(exposure.window, 3);
  assert.equal(exposure.observationCount, 3);
  assert.equal(exposure.correlation.values[0]?.length, 1);
});

test("portfolio health maps resilience inputs to the gauge boundaries", () => {
  const resilient = calculatePortfolioHealth({ expectedShortfall: 0.005, positiveDayRate: 0.65, diversificationRatio: 1.5, cashWeight: 30, weightedSpreadBps: 2 });
  const critical = calculatePortfolioHealth({ expectedShortfall: 0.04, positiveDayRate: 0.35, diversificationRatio: 1, cashWeight: 0, weightedSpreadBps: 25 });

  assert.equal(resilient?.score, 100);
  assert.equal(resilient?.status, "RESILIENT");
  assert.equal(critical?.score, 0);
  assert.equal(critical?.status, "CRITICAL");
});
