import type { AssetCatalogEntry, AssetClassification, BitgetInstrument, BitgetStockInfo, Holding } from "./types";

export const REALITY_CATALOG: AssetCatalogEntry[] = [
  { symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA Corporation", sector: "Technology", themes: ["AI & Semiconductors"], color: "#8a78ff", role: "AI infrastructure leader" },
  { symbol: "RMSFTUSDT", token: "rMSFT", name: "Microsoft Corporation", sector: "Technology", color: "#5de2ff", role: "cloud + enterprise compounder" },
  { symbol: "RSPYUSDT", token: "rSPY", name: "SPDR S&P 500 ETF", sector: "Broad Market", assetClass: "ETF", color: "#63e6a4", role: "broad-market anchor" },
  { symbol: "RQQQUSDT", token: "rQQQ", name: "Invesco QQQ Trust", sector: "Broad Market", assetClass: "ETF", styles: ["Growth"], color: "#ffca72", role: "growth-factor basket" },
  { symbol: "RAAPLUSDT", token: "rAAPL", name: "Apple Inc.", sector: "Technology", color: "#ff728d", role: "consumer ecosystem" },
  { symbol: "RAMZNUSDT", token: "rAMZN", name: "Amazon.com Inc.", sector: "Consumer", color: "#bf9cff", role: "cloud + commerce" },
  { symbol: "RMETAUSDT", token: "rMETA", name: "Meta Platforms Inc.", sector: "Technology", themes: ["AI & Semiconductors"], color: "#6aa7ff", role: "advertising + AI" },
  { symbol: "RTSLAUSDT", token: "rTSLA", name: "Tesla Inc.", sector: "Consumer", styles: ["Growth"], color: "#f783ac", role: "high-beta growth" },
  { symbol: "RXOMUSDT", token: "rXOM", name: "Exxon Mobil Corporation", sector: "Energy", color: "#f29c4b", role: "integrated energy major" },
  { symbol: "RBAUSDT", token: "rBA", name: "The Boeing Company", sector: "Industrials", color: "#b8a07a", role: "aerospace manufacturer" },
];

export const DEFAULT_HOLDINGS: Holding[] = [
  { symbol: "RNVDAUSDT", weight: 18 },
  { symbol: "RAAPLUSDT", weight: 12 },
  { symbol: "RSPYUSDT", weight: 18 },
  { symbol: "RJPMUSDT", weight: 10 },
  { symbol: "RLLYUSDT", weight: 9 },
  { symbol: "RAMZNUSDT", weight: 8 },
  { symbol: "RMSFTUSDT", weight: 15 },
];

export const DEFAULT_SYMBOLS = DEFAULT_HOLDINGS.map((holding) => holding.symbol);
export function catalogFor(symbol: string) { return REALITY_CATALOG.find((asset) => asset.symbol === symbol); }

const DYNAMIC_COLORS = ["#8a78ff", "#5de2ff", "#63e6a4", "#ffca72", "#ff728d", "#bf9cff", "#6aa7ff", "#f783ac"];

function dynamicColor(symbol: string) {
  const score = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0);
  return DYNAMIC_COLORS[score % DYNAMIC_COLORS.length];
}

export function catalogFromInstrument(instrument: BitgetInstrument, stockInfo?: BitgetStockInfo, classification?: AssetClassification): AssetCatalogEntry {
  const known = catalogFor(instrument.symbol);
  const usableClassification = classification?.sector === "Unclassified" ? undefined : classification;
  const token = instrument.baseCoin || instrument.symbol.replace(/USDT$/, "");
  const underlyingSymbol = stockInfo?.code || token.replace(/^r/i, "");
  return {
    symbol: instrument.symbol,
    token,
    underlyingSymbol,
    name: stockInfo?.name || known?.name || `${underlyingSymbol} Reality instrument`,
    sector: usableClassification?.sector ?? known?.sector ?? "Unclassified",
    assetClass: usableClassification?.assetClass ?? known?.assetClass,
    themes: usableClassification?.themes ?? known?.themes,
    styles: usableClassification?.styles ?? known?.styles,
    classificationSource: usableClassification?.source ?? known?.classificationSource ?? (known ? "CATALOG" : "UNCLASSIFIED"),
    classificationAsOf: usableClassification?.asOf ?? known?.classificationAsOf,
    color: known?.color ?? dynamicColor(instrument.symbol),
    role: known?.role ?? "live Bitget Reality market instrument",
  };
}

export function tokenLabel(symbol: string) {
  return catalogFor(symbol)?.token ?? symbol.replace(/USDT$/, "");
}
