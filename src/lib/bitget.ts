import { z } from "zod";
import { catalogFor, catalogFromInstrument, DEFAULT_SYMBOLS } from "./catalog";
import { fetchDeterministicClassificationMap } from "./classification";
import { uniqueSymbolsWithinPortfolioLimit } from "./limits";
import { normalizeRealitySymbol } from "./reality-symbol";
import type { BitgetCandle, BitgetInstrument, BitgetOrderBook, BitgetStockInfo, BitgetTicker, MarketAsset, MarketSnapshot } from "./types";

export { normalizeRealitySymbol } from "./reality-symbol";

const BITGET_API = "https://api.bitget.com";
const instrumentSchema = z.object({ category: z.string(), symbol: z.string(), baseCoin: z.string(), quoteCoin: z.string(), symbolType: z.string().optional(), isReality: z.string(), status: z.string(), pricePrecision: z.string().optional(), quantityPrecision: z.string().optional(), minTradeAmount: z.string().optional(), maxTradeAmount: z.string().optional(), makerFeeRate: z.string().optional(), takerFeeRate: z.string().optional(), launchTime: z.string().optional() });
const tickerSchema = z.object({ category: z.string(), symbol: z.string(), ts: z.string(), lastPrice: z.string(), openPrice24h: z.string(), highPrice24h: z.string(), lowPrice24h: z.string(), ask1Price: z.string(), bid1Price: z.string(), bid1Size: z.string(), ask1Size: z.string(), price24hPcnt: z.string(), volume24h: z.string(), turnover24h: z.string(), platformTurnover24h: z.string().optional() });
const stockInfoSchema = z.object({ symbol: z.string(), code: z.string(), name: z.string().nullable().optional(), tradingPeriod: z.array(z.string()).optional() });
const orderBookLevelSchema = z.tuple([z.union([z.string(), z.number()]), z.union([z.string(), z.number()])]);
const orderBookSchema = z.object({ a: z.array(orderBookLevelSchema), b: z.array(orderBookLevelSchema), ts: z.string() });
const publicCandleSchema = z.array(z.array(z.string()).length(7));
const fundingRateSchema = z.array(z.object({
  symbol: z.string(),
  fundingRate: z.string(),
  fundingRateInterval: z.string().optional(),
  nextUpdate: z.string().optional(),
}));
const openInterestSchema = z.object({ openInterestList: z.array(z.object({ symbol: z.string(), size: z.string() })).optional() }).passthrough();
const longShortSchema = z.array(z.object({
  longRatio: z.string(),
  shortRatio: z.string(),
  longShortRatio: z.string(),
  ts: z.string(),
}));

type CacheEntry<T> = { value: T; expiresAt: number };
let instrumentsCache: CacheEntry<BitgetInstrument[]> | null = null;
let stockInfoCache: CacheEntry<BitgetStockInfo[]> | null = null;
const tickerCache = new Map<string, CacheEntry<BitgetTicker>>();
const candlesCache = new Map<string, CacheEntry<BitgetCandle[]>>();
const orderBookCache = new Map<string, CacheEntry<BitgetOrderBook>>();
const publicCandleCache = new Map<string, CacheEntry<BitgetCandle[]>>();
const cryptoStructureCache = new Map<string, CacheEntry<CryptoMarketStructure>>();
const MARKET_METADATA_TTL_MS = 30_000;
const TICKER_TTL_MS = 15_000;
const CANDLES_TTL_MS = 5 * 60_000;
const ORDER_BOOK_TTL_MS = 2_000;
const CRYPTO_STRUCTURE_TTL_MS = 30_000;
const MARKET_REQUEST_BATCH_SIZE = 8;

async function bitgetJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${BITGET_API}${path}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Bitget returned HTTP ${response.status} for ${path}`);
  const body = (await response.json()) as { code?: string; msg?: string; data?: unknown };
  if (body.code !== "00000") throw new Error(`Bitget rejected ${path}: ${body.msg ?? "unknown error"}`);
  return schema.parse(body.data);
}

export async function fetchRealityInstruments(): Promise<BitgetInstrument[]> {
  if (instrumentsCache && instrumentsCache.expiresAt > Date.now()) return instrumentsCache.value;
  const data = await bitgetJson("/api/v3/market/instruments?category=SPOT", z.array(instrumentSchema));
  const reality = data.filter((instrument) => instrument.isReality.toLowerCase() === "yes" && instrument.status.toLowerCase() === "online");
  instrumentsCache = { value: reality, expiresAt: Date.now() + MARKET_METADATA_TTL_MS };
  return reality;
}

export async function fetchRealityStockInfo(): Promise<BitgetStockInfo[]> {
  if (stockInfoCache && stockInfoCache.expiresAt > Date.now()) return stockInfoCache.value;
  const data = await bitgetJson("/api/v3/reality/market/stock-info", z.array(stockInfoSchema));
  stockInfoCache = { value: data, expiresAt: Date.now() + MARKET_METADATA_TTL_MS };
  return data;
}

export async function fetchRealityTicker(symbol: string): Promise<BitgetTicker> {
  const cached = tickerCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const data = await bitgetJson(`/api/v3/market/tickers?category=SPOT&symbol=${encodeURIComponent(symbol)}`, z.array(tickerSchema));
  const ticker = data[0];
  if (!ticker) throw new Error(`Bitget returned no ticker for ${symbol}`);
  tickerCache.set(symbol, { value: ticker, expiresAt: Date.now() + TICKER_TTL_MS });
  return ticker;
}

export async function fetchRealityCandles(symbol: string, limit = 90): Promise<BitgetCandle[]> {
  const cacheKey = `${symbol}:${limit}`;
  const cached = candlesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const data = await bitgetJson(`/api/v3/market/candles?category=SPOT&symbol=${encodeURIComponent(symbol)}&interval=1D&limit=${limit}`, z.array(z.array(z.string()).length(7)));
  const candles = [...data].sort((a, b) => Number(a[0]) - Number(b[0])) as BitgetCandle[];
  candlesCache.set(cacheKey, { value: candles, expiresAt: Date.now() + CANDLES_TTL_MS });
  return candles;
}

export async function fetchRealityOrderBook(symbol: string, limit = 20): Promise<BitgetOrderBook> {
  const depth = Math.min(100, Math.max(5, Math.round(limit)));
  const cacheKey = `${symbol}:${depth}`;
  const cached = orderBookCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const data = await bitgetJson(`/api/v3/market/orderbook?category=SPOT&symbol=${encodeURIComponent(symbol)}&limit=${depth}`, orderBookSchema);
  const normalizeLevel = ([price, quantity]: [string | number, string | number]) => ({ price: Number(price), quantity: Number(quantity) });
  const orderBook: BitgetOrderBook = {
    symbol,
    asks: data.a.map(normalizeLevel).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.quantity) && level.price > 0 && level.quantity > 0),
    bids: data.b.map(normalizeLevel).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.quantity) && level.price > 0 && level.quantity > 0),
    timestamp: new Date(Number(data.ts)).toISOString(),
    source: "Bitget public spot order book",
  };
  orderBookCache.set(cacheKey, { value: orderBook, expiresAt: Date.now() + ORDER_BOOK_TTL_MS });
  return orderBook;
}

export type CryptoMarketStructure = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  fundingRate?: number;
  fundingIntervalHours?: number;
  openInterest?: number;
  longRatio?: number;
  shortRatio?: number;
  longShortRatio?: number;
  asOf: string;
  source: string;
  limitations: string[];
};

export async function fetchPublicMarketCandles(symbol: string, limit = 90): Promise<BitgetCandle[]> {
  const normalized = symbol.trim().toUpperCase();
  const bounded = Math.min(365, Math.max(10, Math.round(limit)));
  const cacheKey = `${normalized}:${bounded}`;
  const cached = publicCandleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const candles = await bitgetJson(`/api/v3/market/candles?category=SPOT&symbol=${encodeURIComponent(normalized)}&interval=1D&limit=${bounded}`, publicCandleSchema);
  const ordered = [...candles].sort((left, right) => Number(left[0]) - Number(right[0])) as BitgetCandle[];
  publicCandleCache.set(cacheKey, { value: ordered, expiresAt: Date.now() + CANDLES_TTL_MS });
  return ordered;
}

export async function fetchCryptoMarketStructure(symbol = "BTCUSDT"): Promise<CryptoMarketStructure> {
  const normalized = symbol.trim().toUpperCase();
  const cached = cryptoStructureCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [tickers, funding, openInterest, longShort] = await Promise.allSettled([
    bitgetJson(`/api/v3/market/tickers?category=USDT-FUTURES&symbol=${encodeURIComponent(normalized)}`, z.array(tickerSchema)),
    bitgetJson(`/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES&symbol=${encodeURIComponent(normalized)}`, fundingRateSchema),
    bitgetJson(`/api/v2/mix/market/open-interest?productType=USDT-FUTURES&symbol=${encodeURIComponent(normalized)}`, openInterestSchema),
    bitgetJson(`/api/v2/mix/market/long-short?symbol=${encodeURIComponent(normalized)}&period=1h`, longShortSchema),
  ]);
  if (tickers.status === "rejected" || !tickers.value[0]) throw tickers.status === "rejected" ? tickers.reason : new Error(`Bitget returned no futures ticker for ${normalized}`);
  const ticker = tickers.value[0];
  const fundingItem = funding.status === "fulfilled" ? funding.value[0] : undefined;
  const openInterestRecord = openInterest.status === "fulfilled" ? openInterest.value : undefined;
  const openInterestList = openInterestRecord?.openInterestList;
  const openInterestItem = Array.isArray(openInterestList) ? openInterestList[0] : undefined;
  const positioning = longShort.status === "fulfilled" ? longShort.value[0] : undefined;
  const limitations = [
    funding.status === "rejected" ? "Funding rate unavailable" : "",
    openInterest.status === "rejected" ? "Open interest unavailable" : "",
    longShort.status === "rejected" ? "Long/short positioning unavailable" : "",
  ].filter(Boolean);
  const result: CryptoMarketStructure = {
    symbol: normalized,
    price: Number(ticker.lastPrice),
    change24h: Number(ticker.price24hPcnt),
    volume24h: Number(ticker.turnover24h),
    fundingRate: fundingItem ? Number(fundingItem.fundingRate) : undefined,
    fundingIntervalHours: fundingItem?.fundingRateInterval ? Number(fundingItem.fundingRateInterval) : undefined,
    openInterest: openInterestItem ? Number(openInterestItem.size) : undefined,
    longRatio: positioning ? Number(positioning.longRatio) : undefined,
    shortRatio: positioning ? Number(positioning.shortRatio) : undefined,
    longShortRatio: positioning ? Number(positioning.longShortRatio) : undefined,
    asOf: new Date(Number(ticker.ts)).toISOString(),
    source: "Bitget public futures market API",
    limitations,
  };
  cryptoStructureCache.set(normalized, { value: result, expiresAt: Date.now() + CRYPTO_STRUCTURE_TTL_MS });
  return result;
}

export async function fetchMarketSnapshot(requestedSymbols?: string[], providedInstruments?: BitgetInstrument[], providedStockInfo?: BitgetStockInfo[], options: { classifyDynamic?: boolean } = {}): Promise<MarketSnapshot> {
  const classifyDynamic = options.classifyDynamic !== false;
  const instrumentsPromise = providedInstruments ? Promise.resolve(providedInstruments) : fetchRealityInstruments();
  const stockInfoPromise = providedStockInfo ? Promise.resolve(providedStockInfo) : fetchRealityStockInfo().catch(() => [] as BitgetStockInfo[]);
  const [instruments, stockInfo] = await Promise.all([instrumentsPromise, stockInfoPromise]);
  const available = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
  const stockInfoBySymbol = new Map(stockInfo.map((info) => [info.symbol, info]));
  const requested = uniqueSymbolsWithinPortfolioLimit(requestedSymbols?.map(normalizeRealitySymbol).filter(Boolean) ?? []);
  const defaultSymbols = [
    ...DEFAULT_SYMBOLS.filter((symbol) => available.has(symbol)),
    ...instruments.map((instrument) => instrument.symbol).filter((symbol) => !DEFAULT_SYMBOLS.includes(symbol)),
  ].slice(0, 8);
  const symbols = [...new Set(requested.length ? requested : defaultSymbols)].filter((symbol) => available.has(symbol));
  const classificationSymbols = requestedSymbols?.length ? symbols : DEFAULT_SYMBOLS.filter((symbol) => available.has(symbol));
  const classificationTargets = classificationSymbols.flatMap((symbol) => {
    const instrument = available.get(symbol);
    if (!instrument) return [];
    const info = stockInfoBySymbol.get(symbol);
    const token = instrument.baseCoin || instrument.symbol.replace(/USDT$/, "");
    const underlying = (info?.code || token.replace(/^r/i, "")).replace(/^r/i, "").toUpperCase();
    const name = info?.name || catalogFor(symbol)?.name || `${underlying} Reality instrument`;
    const kind: "EQUITY" | "ETF" = catalogFor(symbol)?.assetClass === "ETF" || /\b(etf|trust|index)\b/i.test(name) ? "ETF" : "EQUITY";
    return [{ symbol, underlying, name, kind }];
  });
  const classificationResult = classifyDynamic ? await fetchDeterministicClassificationMap(classificationTargets) : { classifications: new Map(), warnings: [] };
  const classifications = classificationResult.classifications;
  const availableInstruments = instruments.map((instrument) => catalogFromInstrument(instrument, stockInfoBySymbol.get(instrument.symbol), classifications.get(instrument.symbol)));
  const warnings: string[] = [];
  warnings.push(...classificationResult.warnings);
  for (const symbol of requested) if (!available.has(symbol)) warnings.push(`${symbol}: not currently online as a Bitget Reality instrument`);
  if (symbols.length === 0) throw new Error("No requested Reality instruments are currently online on Bitget.");
  const assets: Array<MarketAsset | null> = [];
  for (let index = 0; index < symbols.length; index += MARKET_REQUEST_BATCH_SIZE) {
    const batch = symbols.slice(index, index + MARKET_REQUEST_BATCH_SIZE);
    const batchAssets = await Promise.all(batch.map(async (symbol) => {
      try {
        const [ticker, candles] = await Promise.all([fetchRealityTicker(symbol), fetchRealityCandles(symbol)]);
        const instrument = available.get(symbol)!;
        const info = stockInfoBySymbol.get(symbol);
        return { ...catalogFromInstrument(instrument, info, classifications.get(symbol)), instrument, ticker, candles, ...(info ? { stockInfo: info } : {}) } satisfies MarketAsset;
      } catch (error) {
        warnings.push(`${symbol}: ${error instanceof Error ? error.message : "market data unavailable"}`);
        return null;
      }
    }));
    assets.push(...batchAssets);
  }
  const readyAssets = assets.filter((asset): asset is MarketAsset => asset !== null);
  if (readyAssets.length === 0) throw new Error("Bitget returned no usable Reality market data for the requested portfolio.");
  return { assets: readyAssets, availableSymbols: instruments.map((instrument) => instrument.symbol), availableInstruments, asOf: new Date(Math.max(...readyAssets.map((asset) => Number(asset.ticker.ts)))).toISOString(), source: "Bitget public Reality market API + stock reference data", warnings };
}
