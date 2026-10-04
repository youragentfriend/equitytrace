import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQuantityAdjustment,
  calculateLedgerValue,
  calculatePortfolio,
  createOpeningLedger,
  holdingsFromLedger,
  markHoldingsToMarket,
} from "../src/lib/portfolio.ts";
import type { MarketAsset } from "../src/lib/types.ts";

function asset(symbol: string, price: number): MarketAsset {
  return {
    symbol,
    token: symbol.replace("USDT", ""),
    name: `${symbol} test instrument`,
    sector: "Technology",
    color: "#8a78ff",
    role: "test",
    instrument: { category: "SCOIN-FUTURES", symbol, baseCoin: symbol.replace("USDT", ""), quoteCoin: "USDT", isReality: "Yes", status: "online" },
    ticker: {
      category: "SCOIN-FUTURES",
      symbol,
      ts: String(Date.now()),
      lastPrice: String(price),
      openPrice24h: String(price),
      highPrice24h: String(price),
      lowPrice24h: String(price),
      ask1Price: String(price + 0.1),
      bid1Price: String(price - 0.1),
      bid1Size: "100",
      ask1Size: "100",
      price24hPcnt: "0",
      volume24h: "1000",
      turnover24h: "100000",
    },
    candles: [[String(Date.now()), String(price), String(price), String(price), String(price), "1", "1"]],
  };
}

test("opening ledger preserves quantities and creates explicit cash", () => {
  const ledger = createOpeningLedger([{ symbol: "RNVIDIAUSDT", quantity: 10, weight: 0 }], [asset("RNVIDIAUSDT", 100)], 10_000, "2026-09-25T00:00:00.000Z");

  assert.equal(ledger.startingCapital, 10_000);
  assert.equal(ledger.cashBalance, 9_000);
  assert.equal(ledger.positions[0]?.quantity, 10);
  assert.equal(ledger.positions[0]?.averageEntryPrice, 100);
  assert.equal(ledger.trades.length, 1);
  assert.equal(ledger.trades[0]?.type, "OPENING");
});

test("marking to market changes value but never quantity", () => {
  const ledger = createOpeningLedger([{ symbol: "RNVIDIAUSDT", quantity: 10, weight: 0 }], [asset("RNVIDIAUSDT", 100)], 10_000);
  const marked = calculateLedgerValue(ledger, [asset("RNVIDIAUSDT", 80)]);
  const holdings = markHoldingsToMarket(holdingsFromLedger(ledger), [asset("RNVIDIAUSDT", 80)], ledger.cashBalance);

  assert.equal(marked.cashBalance, 9_000);
  assert.equal(marked.investedValue, 800);
  assert.equal(marked.nav, 9_800);
  assert.equal(holdings[0]?.quantity, 10);
  assert.equal(holdings[0]?.weight, Number(((800 / 9_800) * 100).toFixed(1)));
});

test("portfolio analytics uses stored cash instead of treating starting capital as NAV", () => {
  const analytics = calculatePortfolio([{ symbol: "RNVIDIAUSDT", quantity: 10, weight: 0 }], [asset("RNVIDIAUSDT", 80)], 10_000, 9_000);

  assert.equal(analytics.nav, 9_800);
  assert.equal(analytics.cashValue, 9_000);
  assert.equal(analytics.assets[0]?.value, 800);
  assert.equal(analytics.cashWeight, Number(((9_000 / 9_800) * 100).toFixed(1)));
});

test("quantity adjustment moves cash and records realized P&L for a sale", () => {
  const opening = createOpeningLedger([{ symbol: "RNVIDIAUSDT", quantity: 10, weight: 0 }], [asset("RNVIDIAUSDT", 100)], 10_000);
  const bought = applyQuantityAdjustment(opening, "RNVIDIAUSDT", 12, 100, "2026-09-25T00:01:00.000Z");
  const sold = applyQuantityAdjustment(bought, "RNVIDIAUSDT", 5, 120, "2026-09-25T00:02:00.000Z");

  assert.equal(bought.cashBalance, 8_800);
  assert.equal(bought.positions[0]?.quantity, 12);
  assert.equal(bought.positions[0]?.averageEntryPrice, 100);
  assert.equal(sold.cashBalance, 9_640);
  assert.equal(sold.positions[0]?.quantity, 5);
  assert.equal(sold.positions[0]?.realizedPnl, 140);
  assert.equal(sold.trades.length, 3);
});

test("quantity adjustment rejects invalid negative quantities", () => {
  const opening = createOpeningLedger([{ symbol: "RNVIDIAUSDT", quantity: 10, weight: 0 }], [asset("RNVIDIAUSDT", 100)], 10_000);

  assert.throws(() => applyQuantityAdjustment(opening, "RNVIDIAUSDT", -1, 100), /zero or greater/);
});
