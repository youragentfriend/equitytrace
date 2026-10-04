export type AssetSector = "Technology" | "Broad Market" | "Finance" | "Healthcare" | "Energy" | "Consumer" | "Industrials" | "Unclassified";
export type AssetClass = "EQUITY" | "ETF" | "FUND" | "UNKNOWN";
export type AssetTheme = "AI & Semiconductors";
export type AssetStyle = "Growth";
export type ClassificationSource = "SEC" | "BITGET" | "CATALOG" | "UNCLASSIFIED";
export type AssetClassification = {
  sector: AssetSector;
  assetClass: AssetClass;
  themes: AssetTheme[];
  styles: AssetStyle[];
  source: ClassificationSource;
  asOf: string;
};

export type BitgetInstrument = {
  category: string;
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  symbolType?: string;
  isReality: string;
  status: string;
  pricePrecision?: string;
  quantityPrecision?: string;
  minTradeAmount?: string;
  maxTradeAmount?: string;
  makerFeeRate?: string;
  takerFeeRate?: string;
  launchTime?: string;
};

export type BitgetStockInfo = {
  symbol: string;
  code: string;
  name?: string | null;
  tradingPeriod?: string[];
};

export type BitgetTicker = {
  category: string;
  symbol: string;
  ts: string;
  lastPrice: string;
  openPrice24h: string;
  highPrice24h: string;
  lowPrice24h: string;
  ask1Price: string;
  bid1Price: string;
  bid1Size: string;
  ask1Size: string;
  price24hPcnt: string;
  volume24h: string;
  turnover24h: string;
  platformTurnover24h?: string;
};

export type BitgetCandle = [string, string, string, string, string, string, string];

export type AssetCatalogEntry = {
  symbol: string;
  token: string;
  underlyingSymbol?: string;
  name: string;
  sector: AssetSector;
  assetClass?: AssetClass;
  themes?: AssetTheme[];
  styles?: AssetStyle[];
  classificationSource?: ClassificationSource;
  classificationAsOf?: string;
  color: string;
  role: string;
};

export type MarketAsset = AssetCatalogEntry & {
  instrument: BitgetInstrument;
  ticker: BitgetTicker;
  candles: BitgetCandle[];
  stockInfo?: BitgetStockInfo;
};

export type Holding = { symbol: string; weight: number; quantity?: number };
export type TradeSide = "BUY" | "SELL";
export type TradeOrderType = "MARKET";
export type PortfolioTradeType = "OPENING" | "ADJUSTMENT" | "TRADE";
export type PortfolioPosition = {
  symbol: string;
  quantity: number;
  averageEntryPrice: number;
  costBasis: number;
  realizedPnl: number;
};
export type PortfolioTrade = {
  id: string;
  type: PortfolioTradeType;
  side: TradeSide;
  symbol: string;
  quantity: number;
  executionPrice: number;
  grossValue: number;
  fee: number;
  timestamp: string;
  orderType?: TradeOrderType;
  feeRate?: number;
  feeCurrency?: string;
  slippageBps?: number;
  source?: "OPENING" | "MANUAL" | "BITGET_ORDERBOOK" | "LAST_PRICE_FALLBACK";
  realizedPnl?: number;
};
export type PortfolioTradeExecution = {
  symbol: string;
  side: TradeSide;
  quantity: number;
  executionPrice: number;
  grossValue: number;
  fee: number;
  feeRate: number;
  feeCurrency: string;
  slippageBps?: number;
  orderType: TradeOrderType;
  source: "MANUAL" | "BITGET_ORDERBOOK" | "LAST_PRICE_FALLBACK";
  timestamp?: string;
};
export type PortfolioLedger = {
  schemaVersion: 2 | 3;
  startingCapital: number;
  cashBalance: number;
  positions: PortfolioPosition[];
  trades: PortfolioTrade[];
};
export type OrderBookLevel = { price: number; quantity: number };
export type BitgetOrderBook = {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
  source: string;
};
export type PerformancePoint = { label: string; timestamp: number; portfolio: number; benchmark: number };
export type PerformanceSeries = { key: string; label: string; color: string; values: number[] };
export type PortfolioPerformance = {
  points: PerformancePoint[];
  holdingSeries: PerformanceSeries[];
};
export type PortfolioCorrelation = {
  assets: Array<{ symbol: string; token: string; color: string }>;
  values: Array<Array<number | null>>;
};
export type PortfolioRiskReturnPoint = {
  key: string;
  label: string;
  symbol: string;
  color: string;
  weight: number;
  annualizedReturn: number;
  volatility: number;
  kind: "holding" | "portfolio" | "benchmark";
  sector?: AssetSector;
};
export type PortfolioHealthStatus = "CRITICAL" | "FRAGILE" | "MIXED" | "HEALTHY" | "RESILIENT";
export type PortfolioHealth = {
  score: number;
  status: PortfolioHealthStatus;
  tailResilience: number;
  diversificationCushion: number;
  returnConsistency: number;
  liquidityCapacity: number;
  expectedShortfall: number;
  positiveDayRate: number;
};
export type PortfolioRiskExposure = {
  window: number;
  observationCount: number;
  annualizedReturn: number;
  volatility: number;
  diversificationRatio: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number;
  beta: number | null;
  cashWeight: number;
  weightedSpreadBps: number;
  expectedShortfall: number | null;
  positiveDayRate: number | null;
  health: PortfolioHealth | null;
  correlation: PortfolioCorrelation;
  riskReturn: PortfolioRiskReturnPoint[];
};
export type AssetAnalytics = { symbol: string; quantity: number; weight: number; value: number; price: number; dayChange: number; sector: AssetSector };
export type FactorTone = "positive" | "neutral" | "caution" | "danger";
export type PortfolioFactor = {
  key: string;
  label: string;
  value: number;
  color: string;
  status: string;
  tone: FactorTone;
  metric: string;
  detail: string;
  drivers: string[];
};

export type PortfolioAnalytics = {
  nav: number;
  cashValue: number;
  cashWeight: number;
  dayChange: number;
  annualizedReturn: number;
  volatility: number;
  sharpe: number;
  maxDrawdown: number;
  beta: number;
  concentration: number;
  diversification: number;
  benchmarkSymbol: string;
  performance: PerformancePoint[];
  assets: AssetAnalytics[];
  sectorWeights: Array<{ label: string; value: number; color: string }>;
  factorScores: PortfolioFactor[];
};

export type MarketSnapshot = {
  assets: MarketAsset[];
  availableSymbols: string[];
  availableInstruments: AssetCatalogEntry[];
  asOf: string;
  source: string;
  warnings: string[];
};
export type PositionOverviewEvent = {
  type: "EARNINGS" | "DIVIDEND" | "SPLIT" | "SUSPENSION" | "RESUMPTION" | "SHARE_CAPITAL";
  label: string;
  date?: string;
  detail?: string;
};

export type FinancialReport = {
  period?: string;
  announcementDate?: string;
  isActual?: boolean;
  revenue?: number;
  ebit?: number;
  eps?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  operatingCashFlow?: number;
  cashAtEnd?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  revenueMargin?: number;
  grossMargin?: number;
  currentRatio?: number;
  roe?: number;
};

export type ValuationSnapshot = {
  pe?: number;
  peTtm?: number;
  pb?: number;
  ps?: number;
  pcf?: number;
  evEbitda?: number;
  marketCap?: number;
  dividendYield?: number;
};

export type OwnershipSnapshot = {
  institutionalPosition?: number;
  institutionalHolderCount?: number;
  institutionalNetTradeVolume?: number;
  insiderTradeCount?: number;
  executiveHolderCount?: number;
  majorHolderCount?: number;
  insiderName?: string;
  insiderTitle?: string;
  insiderDate?: string;
  insiderType?: string;
  majorHolder?: string;
};

export type AssetProfile = {
  company?: string;
  tradingPeriod?: string[];
};

export type AssetQuote = {
  lastPrice?: number;
  changePercent?: number;
  volume?: number;
  high52Week?: number;
  low52Week?: number;
  totalMarketCap?: number;
  pb?: number;
};

export type PositionOverviewResponse = {
  symbol: string;
  token: string;
  underlyingSymbol: string;
  name: string;
  kind: "EQUITY" | "ETF";
  source: string;
  asOf: string;
  status: "LIVE" | "PARTIAL" | "UNAVAILABLE";
  warnings: string[];
  events?: PositionOverviewEvent[];
  profile?: AssetProfile;
  quote?: AssetQuote;
  report?: FinancialReport;
  valuation?: ValuationSnapshot;
  ownership?: OwnershipSnapshot;
};
