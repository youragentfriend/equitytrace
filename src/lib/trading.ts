import type { BitgetOrderBook, TradeSide } from "./types";

export const DEFAULT_TAKER_FEE_RATE = 0.0008;
export const MAX_TRADE_QUANTITY_INTEGER_DIGITS = 6;
export const MAX_TRADE_QUANTITY_DECIMAL_DIGITS = 4;
export const TRADE_QUANTITY_INCREMENT = 0.1;
export type MarketExecutionSource = "BITGET_ORDERBOOK" | "LAST_PRICE_FALLBACK";

export type MarketExecutionQuote = {
  side: TradeSide;
  requestedQuantity: number;
  filledQuantity: number;
  executionPrice: number;
  grossValue: number;
  feeRate: number;
  fee: number;
  feeCurrency: string;
  cashImpact: number;
  bestPrice: number;
  slippageBps: number;
  levelsUsed: number;
  source: MarketExecutionSource;
};

function round(value: number, digits = 8) {
  return Number(value.toFixed(digits));
}

const TRADE_QUANTITY_DRAFT_PATTERN = new RegExp(`^\\d{0,${MAX_TRADE_QUANTITY_INTEGER_DIGITS}}(?:\\.\\d{0,${MAX_TRADE_QUANTITY_DECIMAL_DIGITS}})?$`);
export const MAX_TRADE_QUANTITY = Number(`${"9".repeat(MAX_TRADE_QUANTITY_INTEGER_DIGITS)}.${"9".repeat(MAX_TRADE_QUANTITY_DECIMAL_DIGITS)}`);

export function isTradeQuantityDraft(value: string) {
  return TRADE_QUANTITY_DRAFT_PATTERN.test(value);
}

export function tradeQuantityInputError(value: string) {
  if (!value) return "";
  if (!isTradeQuantityDraft(value)) return `Use up to ${MAX_TRADE_QUANTITY_INTEGER_DIGITS} whole digits and ${MAX_TRADE_QUANTITY_DECIMAL_DIGITS} decimal places.`;
  return "";
}

export function formatTradeQuantityInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const factor = 10 ** MAX_TRADE_QUANTITY_DECIMAL_DIGITS;
  const capped = Math.min(value, MAX_TRADE_QUANTITY);
  const truncated = Math.floor(Number((capped * factor).toFixed(8))) / factor;
  return truncated > 0 ? truncated.toFixed(MAX_TRADE_QUANTITY_DECIMAL_DIGITS).replace(/\.?0+$/, "") : "";
}

export function simulateMarketOrder(orderBook: BitgetOrderBook, side: TradeSide, quantity: number, feeRate = DEFAULT_TAKER_FEE_RATE, feeCurrency = "USDT"): MarketExecutionQuote {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a quantity greater than zero.");
  if (!Number.isFinite(feeRate) || feeRate < 0) throw new Error("The fee rate is invalid.");
  const levels = side === "BUY" ? orderBook.asks : orderBook.bids;
  if (!levels.length) throw new Error("The live order book has no visible liquidity for this side.");
  const bestPrice = levels[0]?.price ?? 0;
  let remaining = quantity;
  let filledQuantity = 0;
  let grossValue = 0;
  let levelsUsed = 0;
  for (const level of levels) {
    if (remaining <= 0.00000001) break;
    const filledAtLevel = Math.min(remaining, level.quantity);
    filledQuantity += filledAtLevel;
    grossValue += filledAtLevel * level.price;
    remaining -= filledAtLevel;
    levelsUsed += 1;
  }
  if (remaining > 0.00000001) throw new Error("The visible order-book depth is not enough for this quantity.");
  const executionPrice = grossValue / filledQuantity;
  const fee = grossValue * feeRate;
  const cashImpact = side === "BUY" ? grossValue + fee : grossValue - fee;
  const slippageBps = side === "BUY"
    ? Math.max(0, ((executionPrice - bestPrice) / bestPrice) * 10_000)
    : Math.max(0, ((bestPrice - executionPrice) / bestPrice) * 10_000);
  return {
    side,
    requestedQuantity: round(quantity),
    filledQuantity: round(filledQuantity),
    executionPrice: round(executionPrice),
    grossValue: round(grossValue),
    feeRate,
    fee: round(fee),
    feeCurrency,
    cashImpact: round(cashImpact),
    bestPrice: round(bestPrice),
    slippageBps: round(slippageBps, 4),
    levelsUsed,
    source: "BITGET_ORDERBOOK",
  };
}

export function simulateLastPriceOrder(lastPrice: number, side: TradeSide, quantity: number, feeRate = DEFAULT_TAKER_FEE_RATE, feeCurrency = "USDT"): MarketExecutionQuote {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) throw new Error("The last price is unavailable.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a quantity greater than zero.");
  if (!Number.isFinite(feeRate) || feeRate < 0) throw new Error("The fee rate is invalid.");
  const grossValue = quantity * lastPrice;
  const fee = grossValue * feeRate;
  return {
    side,
    requestedQuantity: round(quantity),
    filledQuantity: round(quantity),
    executionPrice: round(lastPrice),
    grossValue: round(grossValue),
    feeRate,
    fee: round(fee),
    feeCurrency,
    cashImpact: round(side === "BUY" ? grossValue + fee : grossValue - fee),
    bestPrice: round(lastPrice),
    slippageBps: 0,
    levelsUsed: 0,
    source: "LAST_PRICE_FALLBACK",
  };
}
