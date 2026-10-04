import type { AssetAnalytics, Holding, MarketAsset, PerformancePoint, PortfolioAnalytics, PortfolioFactor, PortfolioHealth, PortfolioLedger, PortfolioPerformance, PortfolioPosition, PortfolioRiskExposure, PortfolioTrade, PortfolioTradeExecution } from "./types";
export { MAX_PORTFOLIO_HOLDINGS } from "./limits.ts";

export const MIN_PORTFOLIO_CAPITAL = 500;
export const MAX_PORTFOLIO_CAPITAL = 100_000;
export const NAV = 10_000;
const BENCHMARK = "RSPYUSDT";
const SECTOR_COLORS: Record<string, string> = { Technology: "#5DE2FF", "Broad Market": "#5B8DEF", Finance: "#D78BF0", Healthcare: "#67D5C1", Energy: "#F29C4B", Consumer: "#F079A3", Industrials: "#B8A07A", Unclassified: "#A5ADC4", Cash: "#3DDC97" };
const LEDGER_DECIMAL_PLACES = 8;
function ledgerRound(value: number) { return Number(value.toFixed(LEDGER_DECIMAL_PLACES)); }
function assetPrice(symbol: string, assets: MarketAsset[]) { return Number(assets.find((asset) => asset.symbol === symbol)?.ticker.lastPrice); }
function ledgerTradeId(ledger: PortfolioLedger, prefix: string) { return `${prefix}-${ledger.trades.length + 1}-${Date.now()}`; }

export function createOpeningLedger(holdings: Holding[], assets: MarketAsset[], startingCapital = NAV, timestamp = new Date().toISOString()): PortfolioLedger {
  const positions: PortfolioPosition[] = holdings.flatMap((holding) => {
    const price = assetPrice(holding.symbol, assets);
    if (!Number.isFinite(price) || price <= 0) return [];
    const inputQuantity = Number(holding.quantity);
    const quantity = Number.isFinite(inputQuantity) && inputQuantity >= 0 ? inputQuantity : (Math.max(0, Number(holding.weight) || 0) / 100) * startingCapital / price;
    if (!Number.isFinite(quantity) || quantity <= 0) return [];
    const costBasis = ledgerRound(quantity * price);
    return [{ symbol: holding.symbol, quantity: ledgerRound(quantity), averageEntryPrice: ledgerRound(price), costBasis, realizedPnl: 0 }];
  });
  const investedValue = positions.reduce((sum, position) => sum + position.costBasis, 0);
  if (investedValue > startingCapital + 0.01) throw new Error("Opening positions exceed starting capital.");
  const trades: PortfolioTrade[] = positions.map((position, index) => ({ id: `opening-${position.symbol}-${index + 1}`, type: "OPENING", side: "BUY", symbol: position.symbol, quantity: position.quantity, executionPrice: position.averageEntryPrice, grossValue: position.costBasis, fee: 0, feeRate: 0, feeCurrency: "USDT", source: "OPENING", realizedPnl: 0, timestamp }));
  return { schemaVersion: 3, startingCapital: ledgerRound(startingCapital), cashBalance: ledgerRound(startingCapital - investedValue), positions, trades };
}

export function upgradePortfolioLedger(ledger: PortfolioLedger): PortfolioLedger {
  return {
    ...ledger,
    schemaVersion: 3,
    trades: ledger.trades.map((trade) => ({
      ...trade,
      feeRate: trade.feeRate ?? 0,
      feeCurrency: trade.feeCurrency ?? "USDT",
      source: trade.source ?? (trade.type === "OPENING" ? "OPENING" : "MANUAL"),
      realizedPnl: trade.realizedPnl ?? 0,
    })),
  };
}

export function holdingsFromLedger(ledger: PortfolioLedger): Holding[] {
  return ledger.positions.filter((position) => position.quantity > 0).map((position) => ({ symbol: position.symbol, quantity: position.quantity, weight: 0 }));
}

export function applyQuantityAdjustment(ledger: PortfolioLedger, symbol: string, targetQuantity: number, executionPrice: number, timestamp = new Date().toISOString()): PortfolioLedger {
  if (!Number.isFinite(targetQuantity) || targetQuantity < 0) throw new Error("Quantity must be zero or greater.");
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) throw new Error("Execution price must be greater than zero.");
  const current = ledger.positions.find((position) => position.symbol === symbol);
  const currentQuantity = current?.quantity ?? 0;
  const nextQuantity = ledgerRound(targetQuantity);
  const delta = ledgerRound(nextQuantity - currentQuantity);
  if (!delta) return ledger;
  const grossValue = ledgerRound(Math.abs(delta) * executionPrice);
  const positions = ledger.positions.filter((position) => position.symbol !== symbol);
  if (delta > 0) {
    if (ledger.cashBalance + 0.00000001 < grossValue) throw new Error("Not enough cash for this quantity.");
    const previousCostBasis = current?.costBasis ?? 0;
    const nextCostBasis = ledgerRound(previousCostBasis + grossValue);
    const nextPosition: PortfolioPosition = {
      symbol,
      quantity: nextQuantity,
      averageEntryPrice: ledgerRound(nextCostBasis / nextQuantity),
      costBasis: nextCostBasis,
      realizedPnl: current?.realizedPnl ?? 0,
    };
    return {
      ...ledger,
      cashBalance: ledgerRound(ledger.cashBalance - grossValue),
      positions: [...positions, nextPosition],
      schemaVersion: 3,
      trades: [...ledger.trades, { id: ledgerTradeId(ledger, "adjustment"), type: "ADJUSTMENT", side: "BUY", symbol, quantity: delta, executionPrice: ledgerRound(executionPrice), grossValue, fee: 0, feeRate: 0, feeCurrency: "USDT", source: "MANUAL", realizedPnl: 0, timestamp }],
    };
  }
  const soldQuantity = Math.abs(delta);
  if (!current || soldQuantity > current.quantity + 0.00000001) throw new Error("Cannot sell more than the current position.");
  const nextCostBasis = ledgerRound(Math.max(0, current.costBasis - current.averageEntryPrice * soldQuantity));
  const nextPosition: PortfolioPosition = {
    symbol,
    quantity: nextQuantity,
    averageEntryPrice: nextQuantity > 0 ? current.averageEntryPrice : 0,
    costBasis: nextCostBasis,
    realizedPnl: ledgerRound(current.realizedPnl + (executionPrice - current.averageEntryPrice) * soldQuantity),
  };
  return {
    ...ledger,
    cashBalance: ledgerRound(ledger.cashBalance + grossValue),
    positions: [...positions, nextPosition],
    schemaVersion: 3,
    trades: [...ledger.trades, { id: ledgerTradeId(ledger, "adjustment"), type: "ADJUSTMENT", side: "SELL", symbol, quantity: soldQuantity, executionPrice: ledgerRound(executionPrice), grossValue, fee: 0, feeRate: 0, feeCurrency: "USDT", source: "MANUAL", realizedPnl: ledgerRound((executionPrice - current.averageEntryPrice) * soldQuantity), timestamp }],
  };
}

export function applyTradeExecution(ledger: PortfolioLedger, execution: PortfolioTradeExecution): PortfolioLedger {
  if (!Number.isFinite(execution.quantity) || execution.quantity <= 0) throw new Error("Trade quantity must be greater than zero.");
  if (!Number.isFinite(execution.executionPrice) || execution.executionPrice <= 0) throw new Error("Execution price must be greater than zero.");
  if (!Number.isFinite(execution.grossValue) || execution.grossValue <= 0) throw new Error("Trade value must be greater than zero.");
  if (!Number.isFinite(execution.fee) || execution.fee < 0) throw new Error("Trade fee must be zero or greater.");
  if (!Number.isFinite(execution.feeRate) || execution.feeRate < 0) throw new Error("Trade fee rate is invalid.");
  const quantity = ledgerRound(execution.quantity);
  const grossValue = ledgerRound(execution.grossValue);
  const fee = ledgerRound(execution.fee);
  const current = ledger.positions.find((position) => position.symbol === execution.symbol);
  const positions = ledger.positions.filter((position) => position.symbol !== execution.symbol);
  const timestamp = execution.timestamp ?? new Date().toISOString();
  const tradeBase = { id: ledgerTradeId(ledger, "trade"), type: "TRADE" as const, side: execution.side, symbol: execution.symbol, quantity, executionPrice: ledgerRound(execution.executionPrice), grossValue, fee, feeRate: execution.feeRate, feeCurrency: execution.feeCurrency, orderType: execution.orderType, source: execution.source, ...(execution.slippageBps === undefined ? {} : { slippageBps: execution.slippageBps }), timestamp };
  if (execution.side === "BUY") {
    const cashRequired = ledgerRound(grossValue + fee);
    if (ledger.cashBalance + 0.00000001 < cashRequired) throw new Error("Not enough cash for this trade, including the estimated fee.");
    const nextQuantity = ledgerRound((current?.quantity ?? 0) + quantity);
    const nextCostBasis = ledgerRound((current?.costBasis ?? 0) + grossValue + fee);
    const nextPosition: PortfolioPosition = { symbol: execution.symbol, quantity: nextQuantity, averageEntryPrice: ledgerRound(nextCostBasis / nextQuantity), costBasis: nextCostBasis, realizedPnl: current?.realizedPnl ?? 0 };
    return { ...ledger, schemaVersion: 3, cashBalance: ledgerRound(ledger.cashBalance - cashRequired), positions: [...positions, nextPosition], trades: [...ledger.trades, { ...tradeBase, realizedPnl: 0 }] };
  }
  if (!current || quantity > current.quantity + 0.00000001) throw new Error("Cannot sell more than the current position.");
  const nextQuantity = ledgerRound(current.quantity - quantity);
  const nextCostBasis = ledgerRound(Math.max(0, current.costBasis - current.averageEntryPrice * quantity));
  const realizedPnl = ledgerRound((grossValue - fee) - current.averageEntryPrice * quantity);
  const nextPosition: PortfolioPosition = { symbol: execution.symbol, quantity: nextQuantity, averageEntryPrice: nextQuantity > 0 ? current.averageEntryPrice : 0, costBasis: nextCostBasis, realizedPnl: ledgerRound(current.realizedPnl + realizedPnl) };
  return { ...ledger, schemaVersion: 3, cashBalance: ledgerRound(ledger.cashBalance + grossValue - fee), positions: [...positions, nextPosition], trades: [...ledger.trades, { ...tradeBase, realizedPnl }] };
}

export function calculateLedgerValue(ledger: PortfolioLedger, assets: MarketAsset[]) {
  const investedValue = ledger.positions.reduce((sum, position) => {
    const price = assetPrice(position.symbol, assets);
    return sum + (Number.isFinite(price) && price > 0 ? position.quantity * price : 0);
  }, 0);
  const unrealizedPnl = ledger.positions.reduce((sum, position) => {
    const price = assetPrice(position.symbol, assets);
    return sum + (Number.isFinite(price) && price > 0 ? (price - position.averageEntryPrice) * position.quantity : 0);
  }, 0);
  return { cashBalance: ledger.cashBalance, investedValue, nav: ledger.cashBalance + investedValue, unrealizedPnl, realizedPnl: ledger.positions.reduce((sum, position) => sum + position.realizedPnl, 0), totalPnl: ledger.cashBalance + investedValue - ledger.startingCapital };
}

export function markHoldingsToMarket(holdings: Holding[], assets: MarketAsset[], cashBalance: number) {
  const investedValue = totalHoldingValue(holdings, assets, 0);
  const nav = cashBalance + investedValue;
  return holdings.map((holding) => {
    const value = holdingValue(holding, assets, 0);
    return { ...holding, weight: nav > 0 ? Number(((value / nav) * 100).toFixed(1)) : 0 };
  });
}
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function standardDeviation(values: number[]) { if (values.length < 2) return 0; const mean = average(values); return Math.sqrt(average(values.map((value) => (value - mean) ** 2))); }
function covariance(left: number[], right: number[]) { const size = Math.min(left.length, right.length); if (size < 2) return 0; const a = left.slice(-size); const b = right.slice(-size); const am = average(a); const bm = average(b); return average(a.map((value, index) => (value - am) * (b[index] - bm))); }
function correlation(left: number[], right: number[]) { const size = Math.min(left.length, right.length); if (size < 2) return null; const a = left.slice(-size); const b = right.slice(-size); const leftDeviation = standardDeviation(a); const rightDeviation = standardDeviation(b); if (!leftDeviation || !rightDeviation) return null; return Math.max(-1, Math.min(1, covariance(a, b) / (leftDeviation * rightDeviation))); }
function returnsFor(asset: MarketAsset) { const closes = asset.candles.map((candle) => Number(candle[4])).filter(Number.isFinite); return closes.slice(1).map((close, index) => closes[index] ? close / closes[index] - 1 : 0); }
function portfolioReturns(holdings: Holding[], assets: MarketAsset[], length: number) { const bySymbol = new Map(assets.map((asset) => [asset.symbol, returnsFor(asset)])); return Array.from({ length }, (_, offset) => holdings.reduce((sum, holding) => sum + (holding.weight / 100) * (bySymbol.get(holding.symbol)?.at(-(length - offset)) ?? 0), 0)); }
function maxDrawdown(returns: number[]) { let equity = 1; let peak = 1; let drawdown = 0; for (const value of returns) { equity *= 1 + value; peak = Math.max(peak, equity); drawdown = Math.min(drawdown, equity / peak - 1); } return drawdown; }
function expectedShortfall(returns: number[], tailFraction = 0.05) { if (!returns.length) return null; const tailCount = Math.max(1, Math.ceil(returns.length * tailFraction)); const worstReturns = [...returns].sort((left, right) => left - right).slice(0, tailCount); return Math.max(0, -average(worstReturns)); }
function positiveDayRate(returns: number[]) { return returns.length ? returns.filter((value) => value > 0).length / returns.length : null; }
function clamp(value: number, minimum = 0, maximum = 100) { return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)); }
function compoundReturn(returns: number[]) { return returns.reduce((equity, value) => equity * (1 + value), 1) - 1; }
function signedPercent(value: number, digits = 1) { return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`; }
function signedPoints(value: number, digits = 1) { return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}pp`; }
function tokenFor(symbol: string, assets: MarketAsset[]) { return assets.find((asset) => asset.symbol === symbol)?.token ?? symbol.replace(/USDT$/, ""); }
function holdingDrivers(rows: Array<{ symbol: string; score: number; text: string }>, assets: MarketAsset[]) { return rows.sort((left, right) => Math.abs(right.score) - Math.abs(left.score)).slice(0, 3).map((row) => `${tokenFor(row.symbol, assets)} ${row.text}`); }
function statusTone(status: string): PortfolioFactor["tone"] { if (["LOW", "POSITIVE", "OUTPERFORMING"].includes(status)) return "positive"; if (["ELEVATED", "LAGGING"].includes(status)) return "danger"; if (status === "MODERATE") return "caution"; return "neutral"; }
function healthStatus(score: number): PortfolioHealth["status"] { if (score < 20) return "CRITICAL"; if (score < 40) return "FRAGILE"; if (score < 60) return "MIXED"; if (score < 80) return "HEALTHY"; return "RESILIENT"; }
function lowerIsBetterScore(value: number, good: number, bad: number) { return clamp(((bad - value) / (bad - good)) * 100); }
function higherIsBetterScore(value: number, weak: number, strong: number) { return clamp(((value - weak) / (strong - weak)) * 100); }
export function calculatePortfolioHealth(inputs: { expectedShortfall: number | null; positiveDayRate: number | null; diversificationRatio: number | null; cashWeight: number; weightedSpreadBps: number }): PortfolioHealth | null {
  if (inputs.expectedShortfall === null || inputs.positiveDayRate === null) return null;
  const tailResilience = lowerIsBetterScore(inputs.expectedShortfall, 0.005, 0.04);
  const diversificationCushion = inputs.diversificationRatio === null ? 50 : higherIsBetterScore(inputs.diversificationRatio, 1, 1.5);
  const returnConsistency = higherIsBetterScore(inputs.positiveDayRate, 0.35, 0.65);
  const spreadCapacity = lowerIsBetterScore(inputs.weightedSpreadBps, 2, 25);
  const cashCapacity = higherIsBetterScore(Math.min(30, Math.max(0, inputs.cashWeight)), 0, 30);
  const liquidityCapacity = spreadCapacity * 0.7 + cashCapacity * 0.3;
  const score = Math.round(clamp(tailResilience * 0.4 + diversificationCushion * 0.3 + returnConsistency * 0.2 + liquidityCapacity * 0.1));
  return { score, status: healthStatus(score), tailResilience: Math.round(tailResilience), diversificationCushion: Math.round(diversificationCushion), returnConsistency: Math.round(returnConsistency), liquidityCapacity: Math.round(liquidityCapacity), expectedShortfall: inputs.expectedShortfall, positiveDayRate: inputs.positiveDayRate };
}

function buildFactorScores({ usableHoldings, assets, assetsAnalytics, concentration, beta, portfolioSeries, alignedBenchmark, cashWeight, benchmarkAsset, capital }: { usableHoldings: Holding[]; assets: MarketAsset[]; assetsAnalytics: AssetAnalytics[]; concentration: number; beta: number; portfolioSeries: number[]; alignedBenchmark: number[]; cashWeight: number; benchmarkAsset: MarketAsset; capital: number }): PortfolioFactor[] {
  const benchmarkLabel = benchmarkAsset.token || "rSPY";
  const lookback = Math.min(30, portfolioSeries.length, alignedBenchmark.length);
  const hhiScore = concentration * 100;
  const topThreeWeight = assetsAnalytics.slice().sort((left, right) => right.weight - left.weight).slice(0, 3).reduce((sum, asset) => sum + asset.weight, 0);
  const growthSensitiveSymbols = new Set(assets.filter((asset) => asset.sector === "Technology" || asset.themes?.includes("AI & Semiconductors") || asset.styles?.includes("Growth")).map((asset) => asset.symbol));
  const growthExposure = assetsAnalytics.filter((asset) => growthSensitiveSymbols.has(asset.symbol)).reduce((sum, asset) => sum + asset.weight, 0);
  const marketSensitivity = Math.abs(beta);
  const marketStatus = marketSensitivity < 0.75 ? "LOW" : marketSensitivity < 1.1 ? "MODERATE" : "ELEVATED";
  const growthStatus = growthExposure < 30 ? "LOW" : growthExposure < 60 ? "MODERATE" : "ELEVATED";
  const marketRows = assetsAnalytics.map((asset) => ({ symbol: asset.symbol, score: asset.weight, text: `${asset.weight.toFixed(1)}% weight` }));
  const growthRows = assetsAnalytics.filter((asset) => growthSensitiveSymbols.has(asset.symbol)).map((asset) => {
    const metadata = assets.find((candidate) => candidate.symbol === asset.symbol);
    const labels = [...(metadata?.themes ?? []), ...(metadata?.styles ?? [])];
    return { symbol: asset.symbol, score: asset.weight, text: `${asset.weight.toFixed(1)}% ${labels[0] ?? asset.sector}` };
  });
  const concentrationRows = assetsAnalytics.map((asset) => ({ symbol: asset.symbol, score: asset.weight, text: `${asset.weight.toFixed(1)}% weight` }));
  const portfolioMomentum = lookback ? compoundReturn(portfolioSeries.slice(-lookback)) : 0;
  const benchmarkMomentum = lookback ? compoundReturn(alignedBenchmark.slice(-lookback)) : 0;
  const relativeMomentum = (portfolioMomentum - benchmarkMomentum) * 100;
  const momentumStatus = relativeMomentum > 1.5 ? "OUTPERFORMING" : relativeMomentum < -1.5 ? "LAGGING" : "NEUTRAL";
  const momentumRows = usableHoldings.map((holding) => {
    const asset = assets.find((candidate) => candidate.symbol === holding.symbol);
    const assetReturn = asset && lookback ? compoundReturn(returnsFor(asset).slice(-lookback)) * 100 : 0;
    const contribution = (holding.weight / 100) * assetReturn;
    return { symbol: holding.symbol, score: contribution, text: `${signedPercent(contribution)} contribution` };
  });
  const liquidityRows = usableHoldings.map((holding) => {
    const asset = assets.find((candidate) => candidate.symbol === holding.symbol);
    const bid = Number(asset?.ticker.bid1Price);
    const ask = Number(asset?.ticker.ask1Price);
    const mid = (bid + ask) / 2;
    const spreadBps = mid > 0 && ask >= bid ? ((ask - bid) / mid) * 10_000 : 0;
    const turnover = Number(asset?.ticker.turnover24h);
    const positionValue = holdingValue(holding, assets, capital);
    const positionImpact = turnover > 0 ? clamp((positionValue / turnover) * 100) : 0;
    return { symbol: holding.symbol, score: (holding.weight / 100) * (spreadBps + positionImpact), text: `${spreadBps.toFixed(1)} bps spread`, spreadBps, positionImpact };
  });
  const weightedSpreadBps = liquidityRows.reduce((sum, row) => sum + (assetsAnalytics.find((asset) => asset.symbol === row.symbol)?.weight ?? 0) / 100 * row.spreadBps, 0);
  const weightedPositionImpact = liquidityRows.reduce((sum, row) => sum + (assetsAnalytics.find((asset) => asset.symbol === row.symbol)?.weight ?? 0) / 100 * row.positionImpact, 0);
  const liquidityPressure = clamp(weightedSpreadBps * 3 + weightedPositionImpact * 0.45 + Math.max(0, 40 - cashWeight) * 0.35);
  const liquidityStatus = liquidityPressure < 25 ? "LOW" : liquidityPressure < 55 ? "MODERATE" : "ELEVATED";
  const factor = (key: string, label: string, value: number, color: string, status: string, metric: string, detail: string, drivers: string[]): PortfolioFactor => ({ key, label, value: clamp(value), color, status, tone: statusTone(status), metric, detail, drivers });

  return [
    factor("market-sensitivity", "Market Sensitivity", marketSensitivity * 55, "#5DE2FF", marketStatus, `β ${beta.toFixed(2)} vs ${benchmarkLabel}`, `Moves ${marketSensitivity < 1 ? "less" : "more"} than the benchmark across the current ${portfolioSeries.length}D return window.`, holdingDrivers(marketRows, assets)),
    factor("growth-rates", "Growth / Rates", growthExposure, "#8A78FF", growthStatus, `${growthExposure.toFixed(1)}% growth-sensitive`, "AI, technology, and growth exposure can react more sharply when rates move higher.", holdingDrivers(growthRows, assets)),
    factor("concentration", "Concentration", hhiScore, "#FF72B6", hhiScore < 25 ? "LOW" : hhiScore < 40 ? "MODERATE" : "ELEVATED", `HHI ${hhiScore.toFixed(0)}`, `The largest three tokens represent ${topThreeWeight.toFixed(1)}% of the invested book; cash is included in this HHI score.`, holdingDrivers(concentrationRows, assets)),
    factor("momentum", "Momentum", 50 + relativeMomentum * 4, "#63E6A4", momentumStatus, `${signedPoints(relativeMomentum)} vs ${benchmarkLabel}`, `${lookback}D portfolio ${signedPercent(portfolioMomentum * 100)} versus ${benchmarkLabel} ${signedPercent(benchmarkMomentum * 100)}.`, holdingDrivers(momentumRows, assets)),
    factor("liquidity-pressure", "Liquidity Pressure", liquidityPressure, "#FFCA72", liquidityStatus, `${weightedSpreadBps.toFixed(1)} bps weighted spread`, `Cash buffer ${cashWeight.toFixed(1)}%; higher pressure means wider spreads or larger positions relative to 24h turnover.`, holdingDrivers(liquidityRows, assets)),
  ];
}

export function holdingValue(holding: Holding, assets: MarketAsset[], capital = NAV) {
  const asset = assets.find((candidate) => candidate.symbol === holding.symbol);
  const price = Number(asset?.ticker.lastPrice);
  const quantity = Number(holding.quantity);
  if (Number.isFinite(quantity) && quantity >= 0 && Number.isFinite(price) && price > 0) return quantity * price;
  return (Math.max(0, Number(holding.weight) || 0) / 100) * capital;
}

export function totalHoldingValue(holdings: Holding[], assets: MarketAsset[], capital = NAV) {
  return holdings.reduce((sum, holding) => sum + holdingValue(holding, assets, capital), 0);
}

export function cashValue(holdings: Holding[], assets: MarketAsset[], capital = NAV) {
  return Math.max(0, capital - totalHoldingValue(holdings, assets, capital));
}

function usableHoldingsForAnalytics(holdings: Holding[], assets: MarketAsset[], capital: number, cashBalance?: number) {
  return cashBalance === undefined
    ? normalizeHoldings(holdings, assets.map((asset) => asset.symbol), assets, capital)
    : markHoldingsToMarket(holdings, assets, cashBalance);
}

export function normalizeHoldings(holdings: Holding[], allowedSymbols: string[], assets: MarketAsset[] = [], capital = NAV) {
  const allowed = new Set(allowedSymbols);
  const bySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const unique = new Map<string, Holding>();
  for (const holding of holdings) if (allowed.has(holding.symbol)) unique.set(holding.symbol, holding);
  const normalized = new Map<string, Holding>();
  let remainingCapital = Math.max(0, capital);
  for (const holding of unique.values()) {
    const asset = bySymbol.get(holding.symbol);
    const price = Number(asset?.ticker.lastPrice);
    const inputWeight = Math.max(0, Math.min(100, Number(holding.weight) || 0));
    const inputQuantity = Number(holding.quantity);
    const hasQuantity = Number.isFinite(inputQuantity) && inputQuantity >= 0;
    if (asset && Number.isFinite(price) && price > 0) {
      const requestedQuantity = hasQuantity ? inputQuantity : (inputWeight / 100) * capital / price;
      const quantity = Math.max(0, Math.min(capital / price, remainingCapital / price, requestedQuantity));
      const value = quantity * price;
      const weight = Number(((value / capital) * 100).toFixed(1));
      if (quantity > 0) normalized.set(holding.symbol, { symbol: holding.symbol, quantity: Number(quantity.toFixed(6)), weight });
      remainingCapital = Math.max(0, remainingCapital - value);
    } else if (inputWeight > 0 || (hasQuantity && inputQuantity > 0)) {
      normalized.set(holding.symbol, { symbol: holding.symbol, ...(hasQuantity ? { quantity: Number(inputQuantity.toFixed(6)) } : {}), weight: Number(inputWeight.toFixed(1)) });
    }
  }
  return [...normalized.values()];
}

export function cashWeight(holdings: Holding[], assets: MarketAsset[] = [], capital = NAV, explicitCash?: number) {
  if (assets.length) {
    const cash = explicitCash ?? cashValue(holdings, assets, capital);
    const nav = cash + totalHoldingValue(holdings, assets, capital);
    return nav > 0 ? Number(((cash / nav) * 100).toFixed(1)) : 0;
  }
  return Math.max(0, Number((100 - holdings.reduce((sum, holding) => sum + holding.weight, 0)).toFixed(1)));
}

export function calculatePerformance(holdings: Holding[], assets: MarketAsset[], days = 90, capital = NAV, cashBalance?: number): PortfolioPerformance {
  const empty: PortfolioPerformance = { points: [], holdingSeries: [] };
  if (!assets.length) return empty;

  const usableHoldings = usableHoldingsForAnalytics(holdings, assets, capital, cashBalance);
  const benchmarkAsset = assets.find((asset) => asset.symbol === BENCHMARK) ?? assets[0];
  const benchmarkReturns = returnsFor(benchmarkAsset);
  const returnsBySymbol = new Map(assets.map((asset) => [asset.symbol, returnsFor(asset)]));
  const availableLengths = [benchmarkReturns.length, ...usableHoldings.map((holding) => returnsBySymbol.get(holding.symbol)?.length ?? 0).filter((length) => length > 0)];
  const length = availableLengths.length ? Math.min(Math.max(1, days), ...availableLengths) : 0;
  if (!length) return empty;

  const alignedBenchmark = benchmarkReturns.slice(-length);
  const alignedHoldings = new Map(usableHoldings.map((holding) => [holding.symbol, (returnsBySymbol.get(holding.symbol) ?? []).slice(-length)]));
  const portfolioSeries = Array.from({ length }, (_, index) => usableHoldings.reduce((sum, holding) => sum + (holding.weight / 100) * (alignedHoldings.get(holding.symbol)?.[index] ?? 0), 0));
  const points: PerformancePoint[] = [];
  let portfolioEquity = 1;
  let benchmarkEquity = 1;
  for (let index = 0; index < length; index += 1) {
    portfolioEquity *= 1 + portfolioSeries[index];
    benchmarkEquity *= 1 + (alignedBenchmark[index] ?? 0);
    const candleIndex = Math.max(0, benchmarkAsset.candles.length - length + index + 1);
    const timestamp = Number(benchmarkAsset.candles[candleIndex]?.[0] ?? Date.now());
    points.push({
      label: new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      timestamp,
      portfolio: Number(((portfolioEquity - 1) * 100).toFixed(2)),
      benchmark: Number(((benchmarkEquity - 1) * 100).toFixed(2)),
    });
  }

  const holdingSeries = usableHoldings.map((holding) => {
    const asset = assets.find((candidate) => candidate.symbol === holding.symbol);
    let equity = 1;
    const values = Array.from({ length }, (_, index) => {
      equity *= 1 + (alignedHoldings.get(holding.symbol)?.[index] ?? 0);
      return Number(((equity - 1) * 100).toFixed(2));
    });
    return { key: holding.symbol, label: asset?.token ?? holding.symbol, color: asset?.color ?? "#8a78ff", values };
  });

  return { points, holdingSeries };
}

export function calculateRiskExposure(holdings: Holding[], assets: MarketAsset[], capital = NAV, days = 90, cashBalance?: number): PortfolioRiskExposure {
  const empty: PortfolioRiskExposure = {
    window: days,
    observationCount: 0,
    annualizedReturn: 0,
    volatility: 0,
    diversificationRatio: null,
    sharpe: null,
    sortino: null,
    maxDrawdown: 0,
    beta: null,
    cashWeight: 100,
    weightedSpreadBps: 0,
    expectedShortfall: null,
    positiveDayRate: null,
    health: null,
    correlation: { assets: [], values: [] },
    riskReturn: [],
  };
  if (!assets.length) return empty;

  const usableHoldings = usableHoldingsForAnalytics(holdings, assets, capital, cashBalance);
  const benchmarkAsset = assets.find((asset) => asset.symbol === BENCHMARK) ?? assets[0];
  const benchmarkReturns = returnsFor(benchmarkAsset);
  const returnsBySymbol = new Map(assets.map((asset) => [asset.symbol, returnsFor(asset)]));
  const availableLengths = [benchmarkReturns.length, ...usableHoldings.map((holding) => returnsBySymbol.get(holding.symbol)?.length ?? 0)];
  const observationCount = availableLengths.length && availableLengths.every((length) => length > 0) ? Math.min(Math.max(1, days), ...availableLengths) : 0;
  if (!observationCount) return { ...empty, cashWeight: cashWeight(usableHoldings, assets, capital, cashBalance) };

  const portfolioSeries = portfolioReturns(usableHoldings, assets, observationCount);
  const alignedBenchmark = benchmarkReturns.slice(-observationCount);
  const dailyVolatility = standardDeviation(portfolioSeries);
  const annualizedReturnBase = 1 + compoundReturn(portfolioSeries);
  const annualizedReturn = annualizedReturnBase > 0 ? annualizedReturnBase ** (252 / observationCount) - 1 : -1;
  const volatility = dailyVolatility * Math.sqrt(252);
  const benchmarkVariance = covariance(alignedBenchmark, alignedBenchmark);
  const beta = benchmarkVariance > 0 ? covariance(portfolioSeries, alignedBenchmark) / benchmarkVariance : null;
  const downsideDeviation = Math.sqrt(average(portfolioSeries.map((value) => Math.min(0, value) ** 2))) * Math.sqrt(252);
  const annualizedReturnFor = (returns: number[]) => {
    if (!returns.length) return 0;
    const endingEquity = 1 + compoundReturn(returns);
    return endingEquity > 0 ? endingEquity ** (252 / returns.length) - 1 : -1;
  };
  const volatilityFor = (returns: number[]) => standardDeviation(returns) * Math.sqrt(252);
  const weightedHoldingVolatility = usableHoldings.reduce((sum, holding) => {
    const returns = (returnsBySymbol.get(holding.symbol) ?? []).slice(-observationCount);
    return sum + (holding.weight / 100) * volatilityFor(returns);
  }, 0);
  const diversificationRatio = volatility > 0 ? weightedHoldingVolatility / volatility : null;
  const riskReturn: PortfolioRiskExposure["riskReturn"] = [
    { key: "portfolio", label: "Portfolio", symbol: "PORTFOLIO", color: "#9a8cff", weight: 100, annualizedReturn, volatility, kind: "portfolio" },
    { key: "benchmark", label: benchmarkAsset.token || "rSPY", symbol: benchmarkAsset.symbol, color: "#5de2ff", weight: 0, annualizedReturn: annualizedReturnFor(alignedBenchmark), volatility: volatilityFor(alignedBenchmark), kind: "benchmark" },
    ...usableHoldings.flatMap((holding) => {
      const asset = assets.find((candidate) => candidate.symbol === holding.symbol);
      const returns = (returnsBySymbol.get(holding.symbol) ?? []).slice(-observationCount);
      if (!asset || !returns.length) return [];
      return [{ key: asset.symbol, label: asset.token, symbol: asset.symbol, color: asset.color, weight: holding.weight, annualizedReturn: annualizedReturnFor(returns), volatility: volatilityFor(returns), kind: "holding" as const, sector: asset.sector }];
    }),
  ];
  const weightedSpreadBps = usableHoldings.reduce((sum, holding) => {
    const asset = assets.find((candidate) => candidate.symbol === holding.symbol);
    const bid = Number(asset?.ticker.bid1Price);
    const ask = Number(asset?.ticker.ask1Price);
    const midpoint = (bid + ask) / 2;
    const spreadBps = midpoint > 0 && ask >= bid ? ((ask - bid) / midpoint) * 10_000 : 0;
    return sum + (holding.weight / 100) * spreadBps;
  }, 0);

  const matrixAssets = usableHoldings
    .map((holding) => ({ holding, asset: assets.find((candidate) => candidate.symbol === holding.symbol) }))
    .filter((entry): entry is { holding: Holding; asset: MarketAsset } => Boolean(entry.asset && (returnsBySymbol.get(entry.holding.symbol)?.length ?? 0) > 1))
    .sort((left, right) => right.holding.weight - left.holding.weight);
  const matrixReturns = matrixAssets.map(({ holding }) => (returnsBySymbol.get(holding.symbol) ?? []).slice(-observationCount));
  const matrixValues = matrixReturns.map((row) => matrixReturns.map((column) => correlation(row, column)));
  const portfolioExpectedShortfall = expectedShortfall(portfolioSeries);
  const portfolioPositiveDayRate = positiveDayRate(portfolioSeries);
  const portfolioCashWeight = cashWeight(usableHoldings, assets, capital, cashBalance);
  const portfolioHealth = calculatePortfolioHealth({ expectedShortfall: portfolioExpectedShortfall, positiveDayRate: portfolioPositiveDayRate, diversificationRatio, cashWeight: portfolioCashWeight, weightedSpreadBps });

  return {
    window: days,
    observationCount,
    annualizedReturn,
    volatility,
    diversificationRatio,
    sharpe: volatility > 0 ? annualizedReturn / volatility : null,
    sortino: downsideDeviation > 0 ? annualizedReturn / downsideDeviation : null,
    maxDrawdown: maxDrawdown(portfolioSeries),
    beta,
    cashWeight: portfolioCashWeight,
    weightedSpreadBps,
    expectedShortfall: portfolioExpectedShortfall,
    positiveDayRate: portfolioPositiveDayRate,
    health: portfolioHealth,
    riskReturn,
    correlation: {
      assets: matrixAssets.map(({ asset }) => ({ symbol: asset.symbol, token: asset.token, color: asset.color })),
      values: matrixValues,
    },
  };
}

export function calculatePortfolio(holdings: Holding[], assets: MarketAsset[], capital = NAV, cashBalance?: number): PortfolioAnalytics {
  const usableHoldings = usableHoldingsForAnalytics(holdings, assets, capital, cashBalance);
  const benchmarkAsset = assets.find((asset) => asset.symbol === BENCHMARK) ?? assets[0];
  const benchmarkReturns = returnsFor(benchmarkAsset);
  const minLength = Math.max(2, Math.min(benchmarkReturns.length, ...assets.map((asset) => returnsFor(asset).length)));
  const portfolioSeries = portfolioReturns(usableHoldings, assets, minLength);
  const alignedBenchmark = benchmarkReturns.slice(-minLength);
  const dailyVol = standardDeviation(portfolioSeries);
  const annualizedReturn = average(portfolioSeries) * 252;
  const volatility = dailyVol * Math.sqrt(252);
  const beta = covariance(portfolioSeries, alignedBenchmark) / Math.max(covariance(alignedBenchmark, alignedBenchmark), 0.000001);
  const portfolioCashValue = cashBalance ?? cashValue(usableHoldings, assets, capital);
  const portfolioNav = portfolioCashValue + totalHoldingValue(usableHoldings, assets, capital);
  const portfolioCashWeight = cashWeight(usableHoldings, assets, capital, cashBalance);
  const concentration = usableHoldings.reduce((sum, holding) => sum + (holding.weight / 100) ** 2, (portfolioCashWeight / 100) ** 2);
  const dayChange = usableHoldings.reduce((sum, holding) => sum + (holding.weight / 100) * Number(assets.find((candidate) => candidate.symbol === holding.symbol)?.ticker.price24hPcnt ?? 0), 0);
  let portfolioEquity = 1; let benchmarkEquity = 1;
  const performance: PerformancePoint[] = portfolioSeries.map((value, index) => { portfolioEquity *= 1 + value; benchmarkEquity *= 1 + (alignedBenchmark[index] ?? 0); const candleIndex = Math.max(0, benchmarkAsset.candles.length - portfolioSeries.length + index + 1); const timestamp = Number(benchmarkAsset.candles[candleIndex]?.[0] ?? Date.now()); return { label: new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }), timestamp, portfolio: Number(((portfolioEquity - 1) * 100).toFixed(2)), benchmark: Number(((benchmarkEquity - 1) * 100).toFixed(2)) }; }).filter((_, index) => index % Math.max(1, Math.floor(portfolioSeries.length / 18)) === 0 || index === portfolioSeries.length - 1);
  const assetsAnalytics: AssetAnalytics[] = usableHoldings.map((holding) => { const asset = assets.find((candidate) => candidate.symbol === holding.symbol)!; return { symbol: asset.symbol, quantity: Number(holding.quantity ?? 0), weight: holding.weight, value: Math.round(holdingValue(holding, assets, capital)), price: Number(asset.ticker.lastPrice), dayChange: Number(asset.ticker.price24hPcnt), sector: asset.sector }; });
  const sectorMap = new Map<string, number>(); for (const asset of assetsAnalytics) sectorMap.set(asset.sector, (sectorMap.get(asset.sector) ?? 0) + asset.weight); sectorMap.set("Cash", portfolioCashWeight);
  const factorScores = buildFactorScores({ usableHoldings, assets, assetsAnalytics, concentration, beta, portfolioSeries, alignedBenchmark, cashWeight: portfolioCashWeight, benchmarkAsset, capital: portfolioNav });
  return { nav: portfolioNav, cashValue: portfolioCashValue, cashWeight: portfolioCashWeight, dayChange, annualizedReturn, volatility, sharpe: volatility ? annualizedReturn / volatility : 0, maxDrawdown: maxDrawdown(portfolioSeries), beta, concentration, diversification: 1 - concentration, benchmarkSymbol: benchmarkAsset.symbol, performance, assets: assetsAnalytics, sectorWeights: [...sectorMap.entries()].map(([label, value]) => ({ label, value, color: SECTOR_COLORS[label] ?? "#8a78ff" })), factorScores };
}
