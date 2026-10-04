import assert from "node:assert/strict";
import test from "node:test";
import { applyTradeExecution, createOpeningLedger, upgradePortfolioLedger } from "../src/lib/portfolio.ts";
import {
  formatTradeQuantityInput,
  isTradeQuantityDraft,
  TRADE_QUANTITY_INCREMENT,
  simulateLastPriceOrder,
  simulateMarketOrder,
  tradeQuantityInputError,
} from "../src/lib/trading.ts";
import type { BitgetOrderBook, MarketAsset } from "../src/lib/types.ts";

function asset(symbol: string, price: number): MarketAsset {
  return {
    symbol,
    token: symbol.replace("USDT", ""),
    name: `${symbol} test instrument`,
    sector: "Technology",
    color: "#8a78ff",
    role: "test",
    instrument: { category: "SPOT", symbol, baseCoin: symbol.replace("USDT", ""), quoteCoin: "USDT", isReality: "Yes", status: "online" },
    ticker: {
      category: "SPOT",
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

const orderBook: BitgetOrderBook = {
  symbol: "RTESTUSDT",
  asks: [{ price: 100, quantity: 2 }, { price: 101, quantity: 4 }],
  bids: [{ price: 99, quantity: 3 }, { price: 98, quantity: 4 }],
  timestamp: "2026-09-25T00:00:00.000Z",
  source: "test",
};

test("trade quantity validation accepts six whole digits and four decimals", () => {
  assert.equal(isTradeQuantityDraft("123456"), true);
  assert.equal(isTradeQuantityDraft("123456.1234"), true);
  assert.equal(tradeQuantityInputError("123456.1234"), "");
});

test("trade quantity validation rejects signs, exponent notation, and excess precision", () => {
  assert.equal(isTradeQuantityDraft("-1"), false);
  assert.equal(isTradeQuantityDraft("+1"), false);
  assert.equal(isTradeQuantityDraft("1e3"), false);
  assert.equal(isTradeQuantityDraft("1234567"), false);
  assert.equal(isTradeQuantityDraft("1.12345"), false);
  assert.match(tradeQuantityInputError("1.12345"), /6 whole digits and 4 decimal places/);
});

test("trade quantity validation keeps empty and partial decimal drafts safe", () => {
  assert.equal(isTradeQuantityDraft(""), true);
  assert.equal(isTradeQuantityDraft("."), true);
  assert.equal(isTradeQuantityDraft("1."), true);
  assert.equal(tradeQuantityInputError(""), "");
  assert.equal(tradeQuantityInputError("."), "");
  assert.equal(tradeQuantityInputError("0"), "");
  assert.equal(tradeQuantityInputError("0.0000"), "");
});

test("trade quantity spinner uses a tenth-unit increment", () => {
  assert.equal(TRADE_QUANTITY_INCREMENT, 0.1);
  assert.equal(isTradeQuantityDraft("0.1"), true);
  assert.equal(isTradeQuantityDraft("999999.9"), true);
});

test("slider quantity formatting stays within the same six/four boundary", () => {
  assert.equal(formatTradeQuantityInput(1.234567), "1.2345");
  assert.equal(formatTradeQuantityInput(9999999), "999999.9999");
});

test("market simulation sweeps visible asks and calculates fee and slippage", () => {
  const quote = simulateMarketOrder(orderBook, "BUY", 3, 0.001);

  assert.equal(quote.filledQuantity, 3);
  assert.equal(quote.grossValue, 301);
  assert.equal(quote.executionPrice, 100.33333333);
  assert.equal(quote.fee, 0.301);
  assert.equal(quote.cashImpact, 301.301);
  assert.equal(quote.levelsUsed, 2);
  assert.equal(quote.source, "BITGET_ORDERBOOK");
  assert.ok(quote.slippageBps > 0);
});

test("last-price fallback quotes the full quantity with the current fee", () => {
  const quote = simulateLastPriceOrder(100, "BUY", 3, 0.001);

  assert.equal(quote.filledQuantity, 3);
  assert.equal(quote.grossValue, 300);
  assert.equal(quote.executionPrice, 100);
  assert.equal(quote.fee, 0.3);
  assert.equal(quote.cashImpact, 300.3);
  assert.equal(quote.slippageBps, 0);
  assert.equal(quote.levelsUsed, 0);
  assert.equal(quote.source, "LAST_PRICE_FALLBACK");
});

test("trade execution updates cash, cost basis, and realized P&L after fees", () => {
  const opening = createOpeningLedger([], [asset("RTESTUSDT", 100)], 1_000);
  const bought = applyTradeExecution(opening, {
    symbol: "RTESTUSDT",
    side: "BUY",
    quantity: 1,
    executionPrice: 100,
    grossValue: 100,
    fee: 0.1,
    feeRate: 0.001,
    feeCurrency: "USDT",
    orderType: "MARKET",
    source: "BITGET_ORDERBOOK",
    timestamp: "2026-09-25T00:01:00.000Z",
  });
  const sold = applyTradeExecution(bought, {
    symbol: "RTESTUSDT",
    side: "SELL",
    quantity: 0.5,
    executionPrice: 120,
    grossValue: 60,
    fee: 0.06,
    feeRate: 0.001,
    feeCurrency: "USDT",
    orderType: "MARKET",
    source: "BITGET_ORDERBOOK",
    timestamp: "2026-09-25T00:02:00.000Z",
  });

  assert.equal(sold.cashBalance, 959.84);
  assert.equal(sold.positions[0]?.quantity, 0.5);
  assert.equal(sold.positions[0]?.costBasis, 50.05);
  assert.equal(sold.positions[0]?.realizedPnl, 9.89);
  assert.equal(sold.trades[1]?.type, "TRADE");
  assert.equal(sold.trades[1]?.realizedPnl, 9.89);
});

test("phase 1 ledger migrates to the phase 2 trade schema", () => {
  const migrated = upgradePortfolioLedger({ schemaVersion: 2, startingCapital: 1_000, cashBalance: 1_000, positions: [], trades: [] });

  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.trades, []);
});

test("market simulation rejects insufficient visible liquidity", () => {
  assert.throws(() => simulateMarketOrder(orderBook, "SELL", 8), /visible order-book depth/);
});
