"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Database,
  Filter,
  LoaderCircle,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { DEFAULT_HOLDINGS, DEFAULT_SYMBOLS, tokenLabel } from "@/lib/catalog";
import { MAX_PORTFOLIO_CAPITAL, MAX_PORTFOLIO_HOLDINGS, MIN_PORTFOLIO_CAPITAL, NAV, applyQuantityAdjustment, applyTradeExecution, calculateLedgerValue, calculatePerformance, calculatePortfolio, calculateRiskExposure, createOpeningLedger, holdingsFromLedger, normalizeHoldings, upgradePortfolioLedger } from "@/lib/portfolio";
import { DEFAULT_TAKER_FEE_RATE, formatTradeQuantityInput, isTradeQuantityDraft, MAX_TRADE_QUANTITY, simulateLastPriceOrder, simulateMarketOrder, TRADE_QUANTITY_INCREMENT, tradeQuantityInputError } from "@/lib/trading";
import { positionOverviewCacheKey, isPositionOverviewCacheFresh, type PositionOverviewCacheEntry } from "@/lib/position-overview-cache";
import { PortfolioAnalysis } from "@/components/portfolio-analysis";
import type { PortfolioAnalysisContext } from "@/lib/portfolio-analysis";
import type {
  BitgetOrderBook,
  Holding,
  MarketSnapshot,
  PortfolioAnalytics,
  PortfolioHealth,
  PortfolioLedger,
  PortfolioRiskExposure,
  PositionOverviewResponse,
  PortfolioPerformance,
  PerformanceSeries,
  TradeSide,
} from "@/lib/types";

type LoadState = "loading" | "ready" | "error";
type WorkspaceView = "Overview" | "Portfolio" | "Analysis" | "Metrics";
type PositionTab = "trade" | "overview" | "history";
type PositionOverviewMode = "position" | "asset" | "news";
type HistoryFilter = "selected" | "all";
type ChartLine = PerformanceSeries & { dashed?: boolean };
type HoldingSortKey = "quantity" | "weight" | "last" | "change24h" | "value";
type HoldingSort = { key: HoldingSortKey; direction: "asc" | "desc" };

const WORKSPACE_TARGETS: Record<WorkspaceView, string> = {
  Overview: "action-strip",
  Portfolio: "portfolio",
  Analysis: "portfolio-analysis",
  Metrics: "portfolio-risk-exposure",
};

const HOLDINGS_PAGE_SIZE = 7;
const WORKSPACE_STORAGE_KEY = "equitytrace-workspace-v3";
const LEGACY_WORKSPACE_STORAGE_KEY_V2 = "equitytrace-workspace-v2";
const LEGACY_WORKSPACE_STORAGE_KEY_V1 = "equitytrace-workspace-v1";

type SavedWorkspace = {
  ledger?: PortfolioLedger;
  capital?: number;
  holdings?: Holding[];
  bookSymbols?: string[];
  selectedSymbol?: string;
  chartRange?: 30 | 90;
  chartView?: "portfolio" | "holdings";
  chartHoldingSymbols?: string[];
  holdingSort?: HoldingSort | null;
  holdingPage?: number;
};

const HOLDING_SORT_KEYS: HoldingSortKey[] = ["quantity", "weight", "last", "change24h", "value"];

function savedPage(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function savedHoldingSort(value: unknown): HoldingSort | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { key?: unknown; direction?: unknown };
  return typeof candidate.key === "string" && HOLDING_SORT_KEYS.includes(candidate.key as HoldingSortKey) && (candidate.direction === "asc" || candidate.direction === "desc")
    ? { key: candidate.key as HoldingSortKey, direction: candidate.direction }
    : null;
}

function savedSymbols(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function savedPortfolioLedger(value: unknown): PortfolioLedger | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PortfolioLedger>;
  const startingCapital = candidate.startingCapital;
  const cashBalance = candidate.cashBalance;
  if ((candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3) || typeof startingCapital !== "number" || !Number.isFinite(startingCapital) || typeof cashBalance !== "number" || !Number.isFinite(cashBalance) || !Array.isArray(candidate.positions) || !Array.isArray(candidate.trades)) return null;
  const positions = candidate.positions.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const position = item as PortfolioLedger["positions"][number];
    return typeof position.symbol === "string" && Number.isFinite(position.quantity) && position.quantity >= 0 && Number.isFinite(position.averageEntryPrice) && position.averageEntryPrice >= 0 && Number.isFinite(position.costBasis) && position.costBasis >= 0 && Number.isFinite(position.realizedPnl)
      ? [position]
      : [];
  });
  const trades = candidate.trades.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const trade = item as PortfolioLedger["trades"][number];
    return typeof trade.id === "string" && (trade.type === "OPENING" || trade.type === "ADJUSTMENT" || trade.type === "TRADE") && (trade.side === "BUY" || trade.side === "SELL") && typeof trade.symbol === "string" && Number.isFinite(trade.quantity) && trade.quantity >= 0 && Number.isFinite(trade.executionPrice) && trade.executionPrice >= 0 && Number.isFinite(trade.grossValue) && trade.grossValue >= 0 && Number.isFinite(trade.fee) && trade.fee >= 0 && (trade.feeRate === undefined || (Number.isFinite(trade.feeRate) && trade.feeRate >= 0)) && (trade.slippageBps === undefined || (Number.isFinite(trade.slippageBps) && trade.slippageBps >= 0)) && typeof trade.timestamp === "string"
      ? [trade]
      : [];
  });
  if (positions.length !== candidate.positions.length || trades.length !== candidate.trades.length) return null;
  return upgradePortfolioLedger({ schemaVersion: candidate.schemaVersion, startingCapital, cashBalance, positions, trades });
}

function money(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function chartPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function chartDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function metricClass(value: number) {
  return value >= 0 ? "positive" : "negative";
}

function positionOverviewDate(value?: string) {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function positionOverviewNumber(value?: number, digits = 1) {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function positionOverviewMoney(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function positionOverviewPercent(value?: number, digits = 1) {
  return value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}%`;
}

function positionOverviewSignedClass(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value === 0) return "position-overview-accent";
  return value > 0 ? "positive" : "negative";
}

function holdingWeight(holdings: Holding[], symbol: string) {
  return holdings.find((holding) => holding.symbol === symbol)?.weight ?? 0;
}

function holdingQuantity(holdings: Holding[], symbol: string) {
  return holdings.find((holding) => holding.symbol === symbol)?.quantity ?? 0;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatTradeQuantity(value: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(value);
}

function formatTradeBalanceQuantity(value: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(value);
}

function formatTradePrice(value: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

function tradeTimeLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function precisionStep(value?: string) {
  const precision = Number(value);
  return Number.isInteger(precision) && precision >= 0 && precision <= 8 ? 10 ** -precision : 0.01;
}

function tradeQuantityLimit(orderBook: BitgetOrderBook | null, side: TradeSide, cashBalance: number, holdingQuantity: number, feeRate: number) {
  if (!orderBook) return 0;
  const levels = side === "BUY" ? orderBook.asks : orderBook.bids;
  if (side === "SELL") return Math.max(0, Math.min(holdingQuantity, levels.reduce((total, level) => total + level.quantity, 0)));
  let remainingCash = Math.max(0, cashBalance);
  let quantity = 0;
  for (const level of levels) {
    const unitCost = level.price * (1 + feeRate);
    if (!Number.isFinite(unitCost) || unitCost <= 0) continue;
    const fill = Math.min(level.quantity, remainingCash / unitCost);
    if (fill <= 0) break;
    quantity += fill;
    remainingCash -= fill * unitCost;
  }
  return quantity;
}

function lastPriceTradeQuantityLimit(lastPrice: number, side: TradeSide, cashBalance: number, holdingQuantity: number, feeRate: number) {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return 0;
  if (side === "SELL") return Math.max(0, holdingQuantity);
  return Math.max(0, cashBalance / (lastPrice * (1 + feeRate)));
}

function snapTradeQuantity(value: number, step: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number((Math.floor((value + Number.EPSILON) / step) * step).toFixed(8));
}

function formatCapital(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatCapitalInput(value: number | string) {
  const digits = String(value).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const MAX_CAPITAL_DIGITS = String(MAX_PORTFOLIO_CAPITAL).replace(/\D/g, "").length;
function portfolioCapitalRangeMessage() {
  return `Starting capital should be between ${formatCapital(MIN_PORTFOLIO_CAPITAL)} and ${formatCapital(MAX_PORTFOLIO_CAPITAL)}.`;
}

function capitalInputError(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed > MAX_PORTFOLIO_CAPITAL || parsed < MIN_PORTFOLIO_CAPITAL) return portfolioCapitalRangeMessage();
  return "";
}

function isValidCapital(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_PORTFOLIO_CAPITAL && value <= MAX_PORTFOLIO_CAPITAL;
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function allocationGradient(sectors: PortfolioAnalytics["sectorWeights"]) {
  const visibleSectors = sectors.filter((sector) => sector.value > 0);
  if (!visibleSectors.length) return "conic-gradient(#47516d 0 100%)";
  let cursor = 0;
  const stops = visibleSectors.map((sector, index) => {
    const start = cursor;
    const end = index === visibleSectors.length - 1 ? 100 : cursor + sector.value;
    cursor = end;
    return `${sector.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function LineChart({ performance, lines }: { performance: PortfolioPerformance; lines: ChartLine[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  if (!performance.points.length || !lines.length) return <div className="skeleton" />;

  const width = 1000;
  const height = 220;
  const values = lines.flatMap((line) => line.values);
  const min = Math.min(...values, 0) - 1;
  const max = Math.max(...values, 1) + 1;
  const range = Math.max(0.01, max - min);
  const axisValues = Array.from({ length: 5 }, (_, index) => max - (range * index) / 4);
  const xForIndex = (index: number) => (index / Math.max(1, performance.points.length - 1)) * width;
  const yForValue = (value: number) => height - ((value - min) / range) * height;
  const points = (line: ChartLine) => line.values
    .map((value, index) => {
      return `${xForIndex(index).toFixed(1)},${yForValue(value).toFixed(1)}`;
    })
    .join(" ");
  const hoveredPoint = hoveredIndex === null ? undefined : performance.points[hoveredIndex];
  const hoveredRatio = hoveredIndex === null ? 0 : hoveredIndex / Math.max(1, performance.points.length - 1);
  const tooltipRatio = Math.min(0.84, Math.max(0.16, hoveredRatio));

  return (
    <div className="chart-wrap">
      <div className="chart-y-axis" aria-hidden="true">{axisValues.map((value) => <span key={value}>{chartPercent(value)}</span>)}</div>
      <div className="chart-plot" onMouseLeave={() => setHoveredIndex(null)}>
        <div className="chart-grid" aria-hidden="true">
          {axisValues.map((value) => <span className="chart-grid-line" key={value} />)}
        </div>
        <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={lines.map((line) => line.label).join(" versus ")}>
          <defs>
            <linearGradient id="equitytrace-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#8a78ff" stopOpacity="0.26" />
              <stop offset="1" stopColor="#8a78ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,${height} ${points(lines[0])} ${width},${height}`} fill="url(#equitytrace-fill)" />
          {lines.map((line) => <polyline points={points(line)} fill="none" key={line.key} stroke={line.color} strokeWidth={line.dashed ? "2" : "3"} strokeDasharray={line.dashed ? "5 7" : undefined} vectorEffect="non-scaling-stroke" />)}
          {lines.map((line) => line.values.map((value, index) => <circle className="chart-hit-target" cx={xForIndex(index)} cy={yForValue(value)} fill="transparent" key={`${line.key}-${index}`} r="8" tabIndex={0} stroke="transparent" onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex((current) => current === index ? null : current)} onMouseEnter={() => setHoveredIndex(index)} aria-label={`${line.label}, ${chartDate(performance.points[index]?.timestamp ?? Date.now())}: ${chartPercent(value)}`}><title>{`${line.label}, ${chartDate(performance.points[index]?.timestamp ?? Date.now())}: ${chartPercent(value)}`}</title></circle>))}
        </svg>
        {hoveredPoint && hoveredIndex !== null && <>
          <span className="chart-hover-guide" style={{ left: `${hoveredRatio * 100}%` }} aria-hidden="true" />
          <div className="chart-tooltip" style={{ left: `${tooltipRatio * 100}%` }} role="tooltip">
            <strong>{chartDate(hoveredPoint.timestamp)}</strong>
            {lines.map((line) => <span key={line.key}><i style={{ background: line.color }} />{line.label}<b>{chartPercent(line.values[hoveredIndex] ?? 0)}</b></span>)}
          </div>
        </>}
      </div>
      <div className="chart-axis">
        {performance.points.filter((_, index) => index % Math.max(1, Math.floor(performance.points.length / 5)) === 0).map((point) => <span key={`${point.label}-${point.portfolio}`}>{point.label}</span>)}
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className={`metric-delta ${tone}`}>{detail}</div>
    </div>
  );
}

function FactorMap({ analytics }: { analytics: PortfolioAnalytics }) {
  return (
    <div className="factor-map">
      {analytics.factorScores.map((factor) => {
        const score = Math.max(0, Math.min(100, factor.value));
        return <div className="factor-row" key={factor.label}>
          <div className="factor-row-header">
            <div className="factor-name"><strong>{factor.label}</strong></div>
            <strong className="signal-value" style={{ color: factor.color }}>{score.toFixed(0)}</strong>
          </div>
          <div className="signal-graph factor-tooltip-trigger" tabIndex={0} aria-describedby={`factor-tooltip-${factor.key}`}>
            <div className="signal-track" role="progressbar" aria-label={`${factor.label} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(score.toFixed(0))}><span className="signal-fill" style={{ width: `${score}%`, background: factor.color }} /></div>
            <div className="factor-tooltip" id={`factor-tooltip-${factor.key}`} role="tooltip"><strong className="factor-tooltip-title" style={{ color: factor.color }}>{factor.metric}</strong><span className="factor-tooltip-status">{factor.status}</span><span className="factor-tooltip-copy">{factor.detail}</span>{factor.drivers.length > 0 && <span className="factor-tooltip-drivers"><strong>Drivers:</strong> {factor.drivers.join(" · ")}</span>}</div>
          </div>
        </div>;
      })}
    </div>
  );
}

function PortfolioHealthGauge({ health }: { health: PortfolioHealth | null }) {
  const width = 300;
  const height = 116;
  const centerX = width / 2;
  const centerY = 99;
  const colors = ["#FF5F6D", "#FF9E64", "#FFCA72", "#A7E8C1", "#3DDC97"];
  const labels = ["Critical", "Fragile", "Mixed", "Healthy", "Resilient"];
  const score = health?.score ?? 0;
  const segmentIndex = Math.min(4, Math.floor(score / 20));
  const angle = Math.PI - (score / 100) * Math.PI;
  const needleX = centerX + 78 * Math.cos(angle);
  const needleY = centerY - 78 * Math.sin(angle);
  const ariaLabel = health ? `${labels[segmentIndex]} resilience score: ${health.score} out of 100.` : "Resilience score is unavailable because there is not enough return history.";

  if (!health) return <div className="portfolio-health-empty" role="status">Not enough return history for a resilience score.</div>;

  return (
    <div className="portfolio-health">
      <div className="portfolio-health-gauge" tabIndex={0} aria-describedby="portfolio-health-tooltip">
        <div className="portfolio-health-readout" aria-hidden="true">
          <div className="portfolio-health-status" style={{ color: colors[segmentIndex] }}>{labels[segmentIndex]}</div>
          <div className="portfolio-health-score">{health.score}</div>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
          <title>{ariaLabel}</title>
          <path className="portfolio-health-track" d="M 52 99 A 98 98 0 0 1 248 99" pathLength="100" />
          {colors.map((color, index) => <path className="portfolio-health-segment" d="M 52 99 A 98 98 0 0 1 248 99" key={color} pathLength="100" stroke={color} strokeDasharray="18.4 81.6" strokeDashoffset={-(index * 20)} />)}
          <line className="portfolio-health-needle" x1={centerX} x2={needleX} y1={centerY} y2={needleY} style={{ stroke: colors[segmentIndex] }} />
          <circle className="portfolio-health-needle-dot" cx={centerX} cy={centerY} r="6" style={{ fill: colors[segmentIndex] }} />
          <text className="portfolio-health-axis-label" x="48" y="114">0</text>
          <text className="portfolio-health-axis-label" x="252" y="114" textAnchor="end">100</text>
        </svg>
        <div className="portfolio-health-tooltip" id="portfolio-health-tooltip" role="tooltip">
          <strong>Resilience inputs</strong>
          <span><b>Downside resilience</b>{health.tailResilience}/100 · {pct(-health.expectedShortfall)} tail loss</span>
          <span><b>Diversification cushion</b>{health.diversificationCushion}/100</span>
          <span><b>Return consistency</b>{health.returnConsistency}/100 · {(health.positiveDayRate * 100).toFixed(0)}% positive days</span>
          <span><b>Liquidity capacity</b>{health.liquidityCapacity}/100</span>
          <small>Descriptive 90D model · not a forecast</small>
        </div>
      </div>
    </div>
  );
}

function RiskExposureMetric({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="risk-exposure-metric"><div><strong>{label}</strong><span>{detail}</span></div><b className={tone}>{value}</b></div>;
}

function RiskReturnMap({ points, benchmarkLabel }: { points: PortfolioRiskExposure["riskReturn"]; benchmarkLabel: string }) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const width = 640;
  const height = 270;
  const padding = { top: 18, right: 18, bottom: 35, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxVolatility = Math.max(0.1, ...points.map((point) => point.volatility)) * 1.12;
  const minReturn = Math.min(-0.05, ...points.map((point) => point.annualizedReturn)) * 1.12;
  const maxReturn = Math.max(0.05, ...points.map((point) => point.annualizedReturn)) * 1.12;
  const xFor = (value: number) => padding.left + (Math.max(0, value) / maxVolatility) * plotWidth;
  const yFor = (value: number) => padding.top + ((maxReturn - value) / Math.max(0.001, maxReturn - minReturn)) * plotHeight;
  const hoveredPoint = points.find((point) => point.key === hoveredKey);
  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  if (!points.length) return <div className="risk-visual-empty">Comparable candle history is not available for a risk-return map.</div>;

  return <div className="risk-visual risk-return-map">
    <div className="risk-visual-heading"><div><strong>Risk–return map</strong></div><span>Higher and farther right = more return and more volatility</span></div>
    <div className="risk-return-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Risk-return map for ${points.filter((point) => point.kind === "holding").length} holdings`}>
        {xTicks.map((tick) => <g key={`x-${tick}`}><line className="risk-chart-grid-line" x1={xFor(maxVolatility * tick)} x2={xFor(maxVolatility * tick)} y1={padding.top} y2={height - padding.bottom} /><text className="risk-chart-axis-label" x={xFor(maxVolatility * tick)} y={height - 10} textAnchor="middle">{pct(maxVolatility * tick, 0)}</text></g>)}
        {yTicks.map((tick) => { const value = maxReturn - (maxReturn - minReturn) * tick; return <g key={`y-${tick}`}><line className="risk-chart-grid-line" x1={padding.left} x2={width - padding.right} y1={yFor(value)} y2={yFor(value)} /><text className="risk-chart-axis-label" x={padding.left - 8} y={yFor(value) + 4} textAnchor="end">{pct(value, 0)}</text></g>; })}
        <line className="risk-chart-zero-line" x1={padding.left} x2={width - padding.right} y1={yFor(0)} y2={yFor(0)} />
        {points.map((point) => { const radius = point.kind === "portfolio" ? 9 : point.kind === "benchmark" ? 7 : 5 + Math.min(5, Math.sqrt(point.weight) / 2); return <circle className={`risk-return-point ${point.kind}`} cx={xFor(point.volatility)} cy={yFor(point.annualizedReturn)} fill={point.color} key={point.key} r={radius} tabIndex={0} aria-label={`${point.label}: ${pct(point.annualizedReturn)} annualized return, ${pct(point.volatility)} volatility`} onBlur={() => setHoveredKey((current) => current === point.key ? null : current)} onFocus={() => setHoveredKey(point.key)} onMouseEnter={() => setHoveredKey(point.key)} onMouseLeave={() => setHoveredKey(null)} stroke={point.kind === "holding" ? "#0b1020" : "#f3f5ff"} strokeWidth={point.kind === "holding" ? 2 : 2.5}><title>{`${point.label}: ${pct(point.annualizedReturn)} annualized return · ${pct(point.volatility)} volatility`}</title></circle>; })}
      </svg>
      {hoveredPoint && <div className="risk-return-tooltip" style={{ left: `${Math.min(86, Math.max(14, (xFor(hoveredPoint.volatility) / width) * 100))}%`, top: `${Math.max(6, (yFor(hoveredPoint.annualizedReturn) / height) * 100 - 3)}%` }} role="tooltip"><strong>{hoveredPoint.label}</strong><span>{pct(hoveredPoint.annualizedReturn)} annualized return · {pct(hoveredPoint.volatility)} volatility</span>{hoveredPoint.kind === "holding" ? <span>{hoveredPoint.weight.toFixed(1)}% weight · {hoveredPoint.sector}</span> : <span>{hoveredPoint.kind === "benchmark" ? `${benchmarkLabel} reference` : "Current portfolio"}</span>}</div>}
    </div>
    <div className="risk-visual-legend"><span><i className="holding" /> Holdings</span><span><i className="portfolio" /> Portfolio</span><span><i className="benchmark" /> {benchmarkLabel}</span></div>
  </div>;
}

function correlationBackground(value: number | null) {
  if (value === null) return "rgba(91, 104, 143, 0.12)";
  const opacity = 0.12 + Math.min(1, Math.abs(value)) * 0.5;
  return value >= 0 ? `rgba(138, 120, 255, ${opacity})` : `rgba(93, 226, 255, ${opacity})`;
}

function PortfolioRiskExposurePanel({ exposure, benchmarkLabel }: { exposure: PortfolioRiskExposure; benchmarkLabel: string }) {
  const correlationAssets = exposure.correlation.assets;
  const correlationGrid = `minmax(82px, 1fr) repeat(${Math.max(1, correlationAssets.length)}, 58px)`;
  const annualizedReturnTone = exposure.annualizedReturn >= 0 ? "positive" : "negative";
  const betaTone = exposure.beta === null ? "" : Math.abs(exposure.beta) > 1.1 ? "negative" : Math.abs(exposure.beta) < 0.75 ? "positive" : "";
  const volatilityTone = exposure.volatility > 0.35 ? "negative" : exposure.volatility > 0.2 ? "warn" : "positive";
  const sharpeTone = exposure.sharpe !== null && exposure.sharpe >= 1 ? "positive" : exposure.sharpe !== null && exposure.sharpe < 0.5 ? "negative" : "";
  const diversificationTone = exposure.diversificationRatio === null ? "" : exposure.diversificationRatio < 1 ? "negative" : exposure.diversificationRatio >= 1.2 ? "positive" : "warn";

  return <section className="panel full portfolio-risk-exposure-panel" id="portfolio-risk-exposure">
    <div className="panel-header portfolio-risk-exposure-header">
      <div><div className="eyebrow">PORTFOLIO / LIVE RISK &amp; EXPOSURE</div><div className="panel-title">Portfolio Risk &amp; Exposure</div></div>
    </div>
    <div className="panel-body">
      <div className="risk-exposure-two-column">
        <div className="risk-exposure-column risk-exposure-left-column">
          <RiskReturnMap points={exposure.riskReturn} benchmarkLabel={benchmarkLabel} />
          <div className="risk-exposure-quick-metrics">
            <RiskExposureMetric label="Annualized return" value={pct(exposure.annualizedReturn)} detail="current weights backcast" tone={annualizedReturnTone} />
            <RiskExposureMetric label="Beta" value={exposure.beta === null ? "—" : `β ${exposure.beta.toFixed(2)}`} detail={`versus ${benchmarkLabel}`} tone={betaTone} />
            <RiskExposureMetric label="Annualized volatility" value={`${(exposure.volatility * 100).toFixed(1)}%`} detail={`${exposure.observationCount} daily observations`} tone={volatilityTone} />
            <RiskExposureMetric label="Sharpe ratio" value={exposure.sharpe === null ? "—" : exposure.sharpe.toFixed(2)} detail="return / total volatility" tone={sharpeTone} />
            <RiskExposureMetric label="Sortino ratio" value={exposure.sortino === null ? "—" : exposure.sortino.toFixed(2)} detail="return / downside volatility" />
            <RiskExposureMetric label="Diversification ratio" value={exposure.diversificationRatio === null ? "—" : `${exposure.diversificationRatio.toFixed(2)}×`} detail="weighted holding vol / portfolio vol" tone={diversificationTone} />
          </div>
        </div>
        <div className="risk-exposure-column risk-exposure-correlation-section">
        <div className="risk-exposure-correlation-heading"><div><span className="section-label">Daily return correlation</span></div><span className="risk-exposure-coverage">{correlationAssets.length} positions · {exposure.observationCount} observations</span></div>
        {correlationAssets.length ? <div className="risk-exposure-correlation-scroll"><div className="risk-exposure-correlation-grid" style={{ gridTemplateColumns: correlationGrid }}>
          <span className="risk-exposure-correlation-corner" />
          {correlationAssets.map((asset) => <span className="risk-exposure-correlation-label" key={`column-${asset.symbol}`} style={{ color: asset.color }}>{asset.token}</span>)}
          {correlationAssets.map((asset, rowIndex) => <Fragment key={`row-${asset.symbol}`}><span className="risk-exposure-correlation-label row" style={{ color: asset.color }}>{asset.token}</span>{correlationAssets.map((column, columnIndex) => { const value = exposure.correlation.values[rowIndex]?.[columnIndex] ?? null; return <span className="risk-exposure-correlation-cell" key={`${asset.symbol}-${column.symbol}`} style={{ background: correlationBackground(value) }} title={`${asset.token} / ${column.token}: ${value === null ? "unavailable" : value.toFixed(2)}`} aria-label={`${asset.token} and ${column.token}: ${value === null ? "correlation unavailable" : value.toFixed(2)}`}>{value === null ? "—" : value.toFixed(2)}</span>; })}</Fragment>)}
        </div></div> : <div className="risk-exposure-empty">Comparable candle history is not available for the current holdings.</div>}
        <div className="risk-exposure-correlation-legend"><span><i className="negative" /> Inverse</span><span><i className="neutral" /> Uncorrelated</span><span><i className="positive" /> Together</span></div>
        <p className="risk-exposure-correlation-help">Positive values move together; negative values move in opposite directions. Rows are sorted by current weight.</p>
      </div>
      </div>

    </div>
  </section>;
}

function PositionOverviewField({ label, value, detail, tone = "" }: { label: string; value: string; detail?: string; tone?: string }) {
  return <div className="position-overview-field"><span>{label}</span><strong className={tone}>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function PositionOverviewEventsView({ data }: { data: PositionOverviewResponse }) {
  const events = data.events ?? [];
  return <section className="position-overview-card position-overview-events position-overview-events-page"><div className="position-overview-card-heading"><div><strong>Recent and upcoming events</strong></div></div><div className="position-overview-events-list">{events.length ? events.map((event, index) => <div key={`${event.type}-${event.date}-${index}`}><b>{event.label}</b><span>{positionOverviewDate(event.date)}{event.detail ? ` · ${event.detail}` : ""}</span></div>) : <div><b>No corporate events returned</b><span>Bitget did not return an event for this asset.</span></div>}</div></section>;
}

function PositionOverviewDataView({ data, loading, error, mode = "asset" }: { data: PositionOverviewResponse | null; loading: boolean; error: string; mode?: "asset" | "news" }) {
  const report = data?.report;
  const valuation = data?.valuation;
  const ownership = data?.ownership;
  const quote = data?.quote;
  return <div className="position-overview-content">
    {loading && <div className="position-overview-loading"><LoaderCircle size={18} className="animate-spin" /><span>{mode === "news" ? "Loading live events…" : "Loading live market data…"}</span></div>}
    {!loading && error && <div className="position-overview-note" role="status"><span>Live Bitget Position Overview data is temporarily unavailable.</span></div>}
    {!loading && data && <>
      {mode === "asset" && <div className="position-overview-grid">
        <section className="position-overview-card position-overview-market"><div className="position-overview-card-heading"><div><span className="section-label">Market profile</span><strong>{data.profile?.company || data.name}</strong><small>{data.underlyingSymbol} · {data.kind === "ETF" ? "ETF" : "Equity"}</small></div><span className={`position-overview-status ${data.status.toLowerCase()}`}>{data.status === "LIVE" ? "Live" : data.status.toLowerCase()}</span></div><div className="position-overview-fields"><PositionOverviewField label="Current price" value={quote?.lastPrice === undefined ? "—" : money(quote.lastPrice)} tone={positionOverviewSignedClass(quote?.changePercent)} /><PositionOverviewField label="Day change" value={positionOverviewPercent(quote?.changePercent === undefined ? undefined : quote.changePercent * 100, 2)} tone={positionOverviewSignedClass(quote?.changePercent)} /><PositionOverviewField label="Market cap" value={positionOverviewMoney(quote?.totalMarketCap ?? valuation?.marketCap)} /><PositionOverviewField label="Volume" value={positionOverviewNumber(quote?.volume, 0)} /><PositionOverviewField label="52-week range" value={quote?.low52Week === undefined || quote.high52Week === undefined ? "—" : `${money(quote.low52Week)} – ${money(quote.high52Week)}`} /><PositionOverviewField label="Trading sessions" value={data.profile?.tradingPeriod?.join(" · ") || "—"} /></div></section>
        <section className="position-overview-card"><div className="position-overview-card-heading"><div><span className="section-label">Valuation</span><strong>Underlying market measures</strong></div></div><div className="position-overview-fields"><PositionOverviewField label="P/E · TTM" value={positionOverviewNumber(valuation?.peTtm ?? valuation?.pe, 1)} /><PositionOverviewField label="P/B" value={positionOverviewNumber(valuation?.pb ?? quote?.pb, 1)} /><PositionOverviewField label="P/S" value={positionOverviewNumber(valuation?.ps, 1)} /><PositionOverviewField label="EV / EBITDA" value={positionOverviewNumber(valuation?.evEbitda, 1)} /><PositionOverviewField label="P/CF" value={positionOverviewNumber(valuation?.pcf, 1)} /><PositionOverviewField label="Dividend yield" value={positionOverviewPercent(valuation?.dividendYield, 2)} /></div></section>
        <section className="position-overview-card"><div className="position-overview-card-heading"><div><span className="section-label">Fundamentals</span><strong>{report?.period ? `${report.isActual ? "Reported" : "Forecast"} · FY ${report.period}` : "Latest reported data"}</strong></div></div><div className="position-overview-fields"><PositionOverviewField label="Revenue" value={positionOverviewMoney(report?.revenue)} /><PositionOverviewField label="EBIT" value={positionOverviewMoney(report?.ebit ?? report?.operatingIncome)} tone={positionOverviewSignedClass(report?.ebit ?? report?.operatingIncome)} /><PositionOverviewField label="Net income" value={positionOverviewMoney(report?.netIncome)} tone={positionOverviewSignedClass(report?.netIncome)} /><PositionOverviewField label="EPS" value={positionOverviewNumber(report?.eps, 2)} /><PositionOverviewField label="ROE" value={positionOverviewPercent(report?.roe)} /><PositionOverviewField label="Publication" value={positionOverviewDate(report?.announcementDate)} /></div></section>
        <section className="position-overview-card"><div className="position-overview-card-heading"><div><span className="section-label">Ownership</span><strong>{data.kind === "ETF" ? "Not applicable" : "Latest available records"}</strong></div></div>{data.kind === "ETF" ? <div className="position-overview-copy"><span>Ownership records are not provided for this ETF through the Reality basic-data endpoints.</span></div> : <div className="position-overview-copy"><span>Insider trades · {positionOverviewNumber(ownership?.insiderTradeCount, 0)}</span><span>Executive holders · {positionOverviewNumber(ownership?.executiveHolderCount, 0)}</span><span>Major holders · {positionOverviewNumber(ownership?.majorHolderCount, 0)}</span><small>{ownership?.majorHolder ? `Latest major holder · ${ownership.majorHolder}` : "No major-holder name returned"}</small></div>}</section>
      </div>}
      {mode === "news" && <PositionOverviewEventsView data={data} />}
      {mode !== "news" && <div className="position-overview-source"><span><Database size={14} /> {data.source} · as of {positionOverviewDate(data.asOf)}</span></div>}
    </>}
  </div>;
}

export function EquityTraceApp() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [marketRefreshing, setMarketRefreshing] = useState(false);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [portfolioLedger, setPortfolioLedger] = useState<PortfolioLedger | null>(null);
  const [capitalInput, setCapitalInput] = useState(formatCapitalInput(NAV));
  const [capitalError, setCapitalError] = useState("");
  const [positionTab, setPositionTab] = useState<PositionTab>("trade");
  const [positionOverviewMode, setPositionOverviewMode] = useState<PositionOverviewMode>("position");
  const [tradeSide, setTradeSide] = useState<TradeSide>("BUY");
  const [tradeQuantityDraft, setTradeQuantityDraft] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("selected");
  const [orderBook, setOrderBook] = useState<BitgetOrderBook | null>(null);
  const [orderBookLoading, setOrderBookLoading] = useState(false);
  const [orderBookError, setOrderBookError] = useState("");
  const [tradeError, setTradeError] = useState("");
  const [tradeNotice, setTradeNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookSymbols, setBookSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>(DEFAULT_SYMBOLS[0]);
  const [activeView, setActiveView] = useState<WorkspaceView>("Overview");
  const [universeQuery, setUniverseQuery] = useState("");
  const [holdingSort, setHoldingSort] = useState<HoldingSort | null>(null);
  const [holdingPage, setHoldingPage] = useState(1);
  const holdingsPanelRef = useRef<HTMLElement>(null);
  const positionOverviewRef = useRef<HTMLElement>(null);
  const [holdingManager, setHoldingManager] = useState<"add" | "remove" | null>(null);
  const [removeSymbols, setRemoveSymbols] = useState<string[]>([]);
  const [positionOverviewData, setPositionOverviewData] = useState<PositionOverviewResponse | null>(null);
  const [positionOverviewLoading, setPositionOverviewLoading] = useState(false);
  const [positionOverviewError, setPositionOverviewError] = useState("");
  const [chartRange, setChartRange] = useState<30 | 90>(90);
  const [chartView, setChartView] = useState<"portfolio" | "holdings">("portfolio");
  const [chartHoldingSymbols, setChartHoldingSymbols] = useState<string[]>(DEFAULT_SYMBOLS.slice(0, 3));
  const holdings = useMemo(() => portfolioLedger ? holdingsFromLedger(portfolioLedger) : DEFAULT_HOLDINGS, [portfolioLedger]);
  const portfolioCapital = portfolioLedger?.startingCapital ?? NAV;
  const cashBalance = portfolioLedger?.cashBalance ?? 0;
  const settingsRef = useRef<HTMLDivElement>(null);
  const firstMarketLoad = useRef(true);
  const workspaceHydrated = useRef(false);
  const portfolioCapitalRef = useRef(NAV);
  const positionOverviewRequestRef = useRef(0);
  const positionOverviewCacheRef = useRef(new Map<string, PositionOverviewCacheEntry>());
  const positionOverviewInflightRef = useRef(new Map<string, Promise<PositionOverviewResponse>>());
  const orderBookRequestRef = useRef(0);
  const orderBookRef = useRef<BitgetOrderBook | null>(null);

  const assets = useMemo(() => market?.assets ?? [], [market]);
  const analytics = useMemo(() => assets.length ? calculatePortfolio(holdings, assets, portfolioCapital, portfolioLedger ? cashBalance : undefined) : null, [assets, cashBalance, holdings, portfolioCapital, portfolioLedger]);
  const ledgerValue = useMemo(() => portfolioLedger && assets.length ? calculateLedgerValue(portfolioLedger, assets) : null, [assets, portfolioLedger]);
  const riskExposure = useMemo(() => assets.length ? calculateRiskExposure(holdings, assets, portfolioCapital, chartRange, portfolioLedger ? cashBalance : undefined) : null, [assets, cashBalance, chartRange, holdings, portfolioCapital, portfolioLedger]);
  const selectedAsset = selectedSymbol ? assets.find((asset) => asset.symbol === selectedSymbol) : undefined;
  const selectedPosition = selectedSymbol ? portfolioLedger?.positions.find((position) => position.symbol === selectedSymbol) : undefined;
  const addableInstruments = useMemo(() => {
    const query = normalizeSearch(universeQuery);
    if (query.length < 2) return [];
    return (market?.availableInstruments ?? [])
      .filter((instrument) => !bookSymbols.includes(instrument.symbol))
      .map((instrument) => {
        const token = normalizeSearch(instrument.token);
        const symbol = normalizeSearch(instrument.symbol);
        const underlying = normalizeSearch(instrument.underlyingSymbol ?? "");
        const name = normalizeSearch(instrument.name);
        const fields = [token, symbol, underlying, name];
        if (!fields.some((field) => field.includes(query))) return null;
        const exact = [token, symbol, underlying].includes(query);
        const startsWith = [token, symbol, underlying, name].some((field) => field.startsWith(query));
        return { instrument, score: exact ? 0 : startsWith ? 1 : name.includes(query) ? 2 : 3 };
      })
      .filter((result): result is { instrument: MarketSnapshot["availableInstruments"][number]; score: number } => result !== null)
      .sort((left, right) => left.score - right.score || left.instrument.token.localeCompare(right.instrument.token))
      .slice(0, 8)
      .map(({ instrument }) => instrument);
  }, [bookSymbols, market, universeQuery]);
  const chartPerformance = useMemo(() => calculatePerformance(holdings, assets, chartRange, portfolioCapital, portfolioLedger ? cashBalance : undefined), [assets, cashBalance, chartRange, holdings, portfolioCapital, portfolioLedger]);
  const availableChartHoldings = [...chartPerformance.holdingSeries].sort((left, right) => (analytics?.assets.find((asset) => asset.symbol === right.key)?.weight ?? 0) - (analytics?.assets.find((asset) => asset.symbol === left.key)?.weight ?? 0));
  const activeChartSymbols = chartHoldingSymbols.filter((symbol) => availableChartHoldings.some((series) => series.key === symbol));
  const chartSelection = activeChartSymbols.length ? activeChartSymbols : availableChartHoldings.slice(0, 3).map((series) => series.key);
  const chartLines: ChartLine[] = chartView === "portfolio"
    ? [
      { key: "portfolio", label: "Current portfolio", color: "#8a78ff", values: chartPerformance.points.map((point) => point.portfolio) },
      { key: "benchmark", label: `${tokenLabel(analytics?.benchmarkSymbol ?? "RSPYUSDT")} benchmark`, color: "#5de2ff", dashed: true, values: chartPerformance.points.map((point) => point.benchmark) },
    ]
    : availableChartHoldings.filter((series) => chartSelection.includes(series.key));
  const portfolioAnalysisContext = useMemo<PortfolioAnalysisContext>(() => ({
    asOf: market?.asOf ?? new Date().toISOString(),
    source: market?.source ?? "Bitget public Reality market API",
    warnings: market?.warnings ?? [],
    selectedSymbol,
    portfolio: {
      startingCapital: portfolioCapital,
      cashBalance,
      nav: ledgerValue?.nav ?? analytics?.nav ?? 0,
      totalPnl: ledgerValue?.totalPnl ?? 0,
      unrealizedPnl: ledgerValue?.unrealizedPnl ?? 0,
      realizedPnl: ledgerValue?.realizedPnl ?? 0,
      positions: (analytics?.assets ?? []).map((asset) => {
        const marketAsset = assets.find((candidate) => candidate.symbol === asset.symbol);
        const position = portfolioLedger?.positions.find((candidate) => candidate.symbol === asset.symbol);
        return {
          symbol: asset.symbol,
          token: marketAsset?.token ?? tokenLabel(asset.symbol),
          name: marketAsset?.name ?? asset.symbol,
          sector: asset.sector,
          color: marketAsset?.color ?? "#8a78ff",
          quantity: position?.quantity ?? asset.quantity,
          weight: asset.weight,
          value: asset.value,
          price: asset.price,
          dayChange: asset.dayChange,
        };
      }),
      recentTrades: (portfolioLedger?.trades ?? []).slice(-24).map((trade) => ({
        id: trade.id,
        side: trade.side,
        symbol: trade.symbol,
        quantity: trade.quantity,
        executionPrice: trade.executionPrice,
        grossValue: trade.grossValue,
        fee: trade.fee,
        timestamp: trade.timestamp,
      })),
    },
    analytics,
    riskExposure,
    assets: assets.map((asset) => ({
      symbol: asset.symbol,
      token: asset.token,
      name: asset.name,
      sector: asset.sector,
      color: asset.color,
      price: Number(asset.ticker.lastPrice),
      dayChange: Number(asset.ticker.price24hPcnt),
      candles: asset.candles.map((candle) => ({ timestamp: Number(candle[0]), close: Number(candle[4]) })).filter((candle) => Number.isFinite(candle.timestamp) && Number.isFinite(candle.close)),
    })),
  }), [analytics, assets, cashBalance, ledgerValue, market, portfolioCapital, portfolioLedger, riskExposure, selectedSymbol]);
  function focusView(view: WorkspaceView) {
    setActiveView(view);
    document.getElementById(WORKSPACE_TARGETS[view])?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function focusPositionOverview() {
    setActiveView("Portfolio");
    requestAnimationFrame(() => positionOverviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function focusAsset(symbol: string) {
    setSelectedSymbol(symbol);
    setPositionTab("trade");
    setPositionOverviewMode("position");
    setPositionOverviewData(null);
    setPositionOverviewError("");
    setTradeQuantityDraft("");
    setTradeError("");
    setTradeNotice("");
    setOrderBook(null);
    setActiveView("Portfolio");
    requestAnimationFrame(() => positionOverviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function applyPortfolioCapital() {
    const parsed = Number(capitalInput.replace(/[$,]/g, ""));
    const nextCapital = Math.round(parsed);
    const inputError = capitalInputError(capitalInput);
    if (!capitalInput.trim() || inputError || !isValidCapital(nextCapital)) {
      setCapitalError(inputError || portfolioCapitalRangeMessage());
      return;
    }
    if (portfolioLedger) {
      const investedValue = calculateLedgerValue(portfolioLedger, assets).investedValue;
      if (nextCapital + Number.EPSILON < investedValue) {
        setCapitalError(`Starting capital cannot be below current invested value of ${money(investedValue)}.`);
        return;
      }
      setPortfolioLedger((current) => current ? { ...current, startingCapital: nextCapital, cashBalance: current.cashBalance + nextCapital - current.startingCapital } : current);
    }
    setCapitalInput(formatCapitalInput(nextCapital));
    setCapitalError("");
    setTradeQuantityDraft("");
    setSettingsOpen(false);
  }

  function resetWorkspace() {
    if (!window.confirm("Reset EquityTrace to the default capital, holdings, charts, and portfolio workspace?")) return;
    const allowedSymbols = [...new Set([...assets.map((asset) => asset.symbol), ...DEFAULT_SYMBOLS])];
    const defaultHoldings = assets.length ? normalizeHoldings(DEFAULT_HOLDINGS, allowedSymbols, assets, NAV) : DEFAULT_HOLDINGS;
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY_V2);
    window.localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY_V1);
    setPortfolioLedger(assets.length ? createOpeningLedger(defaultHoldings, assets, NAV) : null);
    setCapitalInput(formatCapitalInput(NAV));
    setCapitalError("");
    setPositionTab("trade");
    setPositionOverviewMode("position");
    setTradeSide("BUY");
    setTradeQuantityDraft("");
    setTradeError("");
    setTradeNotice("");
    setOrderBook(null);
    setBookSymbols(DEFAULT_SYMBOLS);
    setSelectedSymbol(DEFAULT_SYMBOLS[0]);
    setActiveView("Overview");
    setUniverseQuery("");
    setHoldingSort(null);
    setHoldingPage(1);
    setHoldingManager(null);
    setRemoveSymbols([]);
    setPositionOverviewData(null);
    setPositionOverviewError("");
    setChartRange(90);
    setChartView("portfolio");
    setChartHoldingSymbols(DEFAULT_SYMBOLS.slice(0, 3));
    positionOverviewRequestRef.current += 1;
    setSettingsOpen(false);
  }

  function toggleChartHolding(symbol: string) {
    setChartHoldingSymbols((current) => {
      const available = new Set(availableChartHoldings.map((series) => series.key));
      const active = current.filter((item) => available.has(item));
      if (active.includes(symbol)) return active.filter((item) => item !== symbol);
      return active.length >= 3 ? [...active.slice(1), symbol] : [...active, symbol];
    });
  }

  const loadMarket = useCallback(async (requestedSymbols?: string[], options: { classifyDynamic?: boolean } = {}) => {
    const classifyDynamic = options.classifyDynamic !== false;
    const initialLoad = firstMarketLoad.current;
    if (initialLoad) setLoadState("loading");
    else setMarketRefreshing(true);
    setLoadError("");
    let saved: SavedWorkspace = {};
    if (typeof window !== "undefined") {
      try {
        const stored = [WORKSPACE_STORAGE_KEY, LEGACY_WORKSPACE_STORAGE_KEY_V2, LEGACY_WORKSPACE_STORAGE_KEY_V1].map((key) => window.localStorage.getItem(key)).find((value): value is string => Boolean(value));
        if (stored) saved = JSON.parse(stored) as SavedWorkspace;
      } catch {
        saved = {};
      }
    }
    const restoredLedger = savedPortfolioLedger(saved.ledger);
    const savedCapital = isValidCapital(restoredLedger?.startingCapital) ? restoredLedger.startingCapital : isValidCapital(saved.capital) ? saved.capital : NAV;
    const activeCapital = firstMarketLoad.current ? savedCapital : portfolioCapitalRef.current;
    try {
      const savedPortfolioSymbols = [...new Set([
        ...(Array.isArray(saved.bookSymbols) ? saved.bookSymbols : []),
        ...(Array.isArray(saved.holdings) ? saved.holdings.map((holding) => holding.symbol) : []),
      ])];
      const bootstrapSymbols = savedPortfolioSymbols.length ? [...new Set([...DEFAULT_SYMBOLS, ...savedPortfolioSymbols])] : undefined;
      const symbolsToLoad = requestedSymbols?.length ? requestedSymbols : bootstrapSymbols;
      const params = new URLSearchParams();
      if (symbolsToLoad?.length) params.set("symbols", symbolsToLoad.join(","));
      if (!classifyDynamic) params.set("classify", "0");
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/market${query}`, { cache: "no-store" });
      const body = await response.json() as MarketSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load live Bitget data.");
      const available = body.availableSymbols?.length ? body.availableSymbols : body.assets.map((asset) => asset.symbol);
      const defaultBook = normalizeHoldings(DEFAULT_HOLDINGS, available, body.assets, activeCapital).length
        ? normalizeHoldings(DEFAULT_HOLDINGS, available, body.assets, activeCapital)
        : normalizeHoldings(body.assets.slice(0, 5).map((asset, index) => ({ symbol: asset.symbol, weight: index === 0 ? 25 : 15 })), available, body.assets, activeCapital);
      setMarket((current) => {
        if (!current || firstMarketLoad.current) return body;
        const currentAssets = new Map(current.assets.map((asset) => [asset.symbol, asset]));
        const refreshedAssets = body.assets.map((fresh) => {
          const previous = currentAssets.get(fresh.symbol);
          if (!classifyDynamic && previous && previous.sector !== "Unclassified") return { ...fresh, sector: previous.sector, color: previous.color, role: previous.role };
          return fresh;
        });
        const mergedAssets = [...refreshedAssets, ...current.assets.filter((asset) => !body.assets.some((fresh) => fresh.symbol === asset.symbol))];
        return { ...body, assets: mergedAssets, availableInstruments: classifyDynamic ? body.availableInstruments : current.availableInstruments };
      });
      if (firstMarketLoad.current) {
        const savedBookSymbols = Array.isArray(saved.bookSymbols) ? saved.bookSymbols : (Array.isArray(saved.holdings) ? saved.holdings.map((holding) => holding.symbol) : DEFAULT_SYMBOLS);
        const openingHoldings = Array.isArray(saved.holdings) ? saved.holdings : defaultBook;
        let initialLedger = restoredLedger;
        if (!initialLedger) {
          try {
            initialLedger = createOpeningLedger(openingHoldings, body.assets, activeCapital);
          } catch {
            initialLedger = createOpeningLedger(defaultBook, body.assets, activeCapital);
          }
        }
        setBookSymbols([...new Set(savedBookSymbols.length ? savedBookSymbols : DEFAULT_SYMBOLS)]);
        portfolioCapitalRef.current = activeCapital;
        setPortfolioLedger(initialLedger);
        setCapitalInput(formatCapitalInput(activeCapital));
        setCapitalError("");
        setSelectedSymbol(typeof saved.selectedSymbol === "string" && body.assets.some((asset) => asset.symbol === saved.selectedSymbol)
          ? saved.selectedSymbol
          : body.assets.find((asset) => asset.symbol === DEFAULT_SYMBOLS[0])?.symbol ?? body.assets[0]?.symbol);
        setChartRange(saved.chartRange === 30 ? 30 : 90);
        setChartView(saved.chartView === "holdings" ? "holdings" : "portfolio");
        const restoredChartSymbols = savedSymbols(saved.chartHoldingSymbols);
        setChartHoldingSymbols(restoredChartSymbols.length ? restoredChartSymbols : DEFAULT_SYMBOLS.slice(0, 3));
        setHoldingSort(savedHoldingSort(saved.holdingSort));
        setHoldingPage(savedPage(saved.holdingPage));
        firstMarketLoad.current = false;
        workspaceHydrated.current = true;
      }
      setLoadState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load live Bitget data.";
      if (initialLoad) setLoadState("error");
      else setLoadState("ready");
      setLoadError(initialLoad ? message : `Live refresh failed; showing the last known data. ${message}`);
    } finally {
      if (!initialLoad) setMarketRefreshing(false);
    }
  }, []);

  const loadOrderBook = useCallback(async (symbol: string) => {
    const requestId = ++orderBookRequestRef.current;
    const hasCurrentOrderBook = orderBookRef.current?.symbol === symbol;
    if (!hasCurrentOrderBook) {
      orderBookRef.current = null;
      setOrderBook(null);
      setOrderBookLoading(true);
    }
    setOrderBookError("");
    try {
      const response = await fetch(`/api/orderbook?symbol=${encodeURIComponent(symbol)}&limit=20`, { cache: "no-store" });
      const body = await response.json() as BitgetOrderBook & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load the live order book.");
      if (requestId !== orderBookRequestRef.current) return;
      orderBookRef.current = body;
      setOrderBook(body);
    } catch (error) {
      if (requestId !== orderBookRequestRef.current) return;
      setOrderBookError(error instanceof Error ? error.message : "Could not load the live order book.");
    } finally {
      if (requestId === orderBookRequestRef.current) setOrderBookLoading(false);
    }
  }, []);

  const loadPositionOverview = useCallback(async (symbol: string, mode: "asset" | "news") => {
    const requestId = ++positionOverviewRequestRef.current;
    const cacheKey = positionOverviewCacheKey(symbol, mode);
    const cached = positionOverviewCacheRef.current.get(cacheKey);
    if (cached) {
      setPositionOverviewData(cached.data);
      setPositionOverviewError("");
      setPositionOverviewLoading(false);
      if (isPositionOverviewCacheFresh(cached)) return;
    } else {
      setPositionOverviewLoading(true);
    }
    setPositionOverviewError("");
    let request = positionOverviewInflightRef.current.get(cacheKey);
    if (!request) {
      request = (async () => {
        const response = await fetch("/api/position-overview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, mode }), cache: "no-store" });
        const body = await response.json() as PositionOverviewResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? body.warnings?.[0] ?? "Could not load Position Overview data.");
        return body;
      })();
      positionOverviewInflightRef.current.set(cacheKey, request);
    }
    try {
      const body = await request;
      positionOverviewCacheRef.current.set(cacheKey, { data: body, fetchedAt: Date.now() });
      if (requestId !== positionOverviewRequestRef.current) return;
      setPositionOverviewData(body);
      setPositionOverviewError("");
    } catch (error) {
      if (requestId !== positionOverviewRequestRef.current) return;
      if (!cached) setPositionOverviewError(error instanceof Error ? error.message : "Could not load Position Overview data.");
    } finally {
      if (positionOverviewInflightRef.current.get(cacheKey) === request) positionOverviewInflightRef.current.delete(cacheKey);
      if (requestId === positionOverviewRequestRef.current) setPositionOverviewLoading(false);
    }
  }, []);

  // Network bootstrap is an intentional external synchronization, not derived state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadMarket(); }, [loadMarket]);

  useEffect(() => {
    portfolioCapitalRef.current = portfolioCapital;
  }, [portfolioCapital]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!assets.length) return;
    const timer = window.setInterval(() => void loadMarket(assets.map((asset) => asset.symbol), { classifyDynamic: false }), 60_000);
    return () => window.clearInterval(timer);
  }, [assets, loadMarket]);

  useEffect(() => {
    if (positionTab !== "trade" || !selectedSymbol) return;
    // Order-book polling intentionally synchronizes the active trade tab with an external market source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOrderBook(selectedSymbol);
    const timer = window.setInterval(() => void loadOrderBook(selectedSymbol), 5_000);
    return () => window.clearInterval(timer);
  }, [loadOrderBook, positionTab, selectedSymbol]);

  useEffect(() => {
    if (positionTab !== "overview" || !["asset", "news"].includes(positionOverviewMode) || !selectedSymbol) return;
    const timer = window.setTimeout(() => void loadPositionOverview(selectedSymbol, positionOverviewMode === "news" ? "news" : "asset"), 0);
    return () => window.clearTimeout(timer);
  }, [positionOverviewMode, loadPositionOverview, positionTab, selectedSymbol]);

  useEffect(() => {
    if (!workspaceHydrated.current || typeof window === "undefined") return;
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      ledger: portfolioLedger ?? undefined,
      capital: portfolioCapital,
      holdings,
      bookSymbols,
      selectedSymbol,
      chartRange,
      chartView,
      chartHoldingSymbols,
      holdingSort,
      holdingPage,
    } satisfies SavedWorkspace));
  }, [bookSymbols, chartHoldingSymbols, chartRange, chartView, holdingPage, holdingSort, holdings, portfolioCapital, portfolioLedger, selectedSymbol]);

  function executeTrade() {
    setTradeError("");
    setTradeNotice("");
    if (!portfolioLedger || !selectedAsset || !tradeQuoteState.quote) {
      setTradeError(tradeValidationError || "Select a token and enter a valid quantity.");
      return;
    }
    if (tradeSide === "SELL" && tradeQuoteState.quote.filledQuantity > selectedHoldingQuantity + Number.EPSILON) {
      setTradeError(`You can sell up to ${formatTradeQuantity(selectedHoldingQuantity)} ${selectedAsset.token}.`);
      return;
    }
    if (tradeSide === "BUY" && tradeQuoteState.quote.cashImpact > cashBalance + Number.EPSILON) {
      setTradeError(`Not enough cash. You need ${money(tradeQuoteState.quote.cashImpact)} including the estimated fee.`);
      return;
    }
    try {
      const nextLedger = applyTradeExecution(portfolioLedger, {
        symbol: selectedAsset.symbol,
        side: tradeSide,
        quantity: tradeQuoteState.quote.filledQuantity,
        executionPrice: tradeQuoteState.quote.executionPrice,
        grossValue: tradeQuoteState.quote.grossValue,
        fee: tradeQuoteState.quote.fee,
        feeRate: tradeQuoteState.quote.feeRate,
        feeCurrency: tradeQuoteState.quote.feeCurrency,
        slippageBps: tradeQuoteState.quote.slippageBps,
        orderType: "MARKET",
        source: tradeQuoteState.quote.source,
      });
      setPortfolioLedger(nextLedger);
      setBookSymbols((current) => current.includes(selectedAsset.symbol) ? current : [...current, selectedAsset.symbol]);
      setTradeQuantityDraft("");
      setTradeNotice(`${tradeSide === "BUY" ? "Bought" : "Sold"} ${formatTradeQuantity(tradeQuoteState.quote.filledQuantity)} ${selectedAsset.token} at ${money(tradeQuoteState.quote.executionPrice)}${tradeQuoteState.quote.source === "LAST_PRICE_FALLBACK" ? " using the last-price estimate" : ""}.`);
    } catch (error) {
      setTradeError(error instanceof Error ? error.message : "The trade could not be recorded.");
    }
  }

  function toggleHoldingManager(mode: "add" | "remove") {
    setHoldingManager((current) => current === mode ? null : mode);
    setUniverseQuery("");
    setRemoveSymbols([]);
  }

  async function addInstrument(symbol: string) {
    if (!symbol || (portfolioTokenLimitReached && !bookSymbols.includes(symbol))) return;
    setUniverseQuery("");
    setBookSymbols((current) => current.includes(symbol) ? current : [...current, symbol]);
    setPortfolioLedger((current) => {
      if (!current || current.positions.some((position) => position.symbol === symbol)) return current;
      return { ...current, positions: [...current.positions, { symbol, quantity: 0, averageEntryPrice: 0, costBasis: 0, realizedPnl: 0 }] };
    });
    setHoldingManager(null);
    if (!assets.some((asset) => asset.symbol === symbol)) {
      await loadMarket([...assets.map((asset) => asset.symbol), symbol]);
    }
  }

  function toggleRemoveSymbol(symbol: string) {
    setRemoveSymbols((current) => current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol]);
  }

  function removeSelectedHoldings() {
    if (!removeSymbols.length) return;
    const removed = new Set(removeSymbols);
    const selectedNames = removeSymbols.map((symbol) => assets.find((asset) => asset.symbol === symbol)?.token ?? symbol.replace(/USDT$/, "")).join(", ");
    if (!window.confirm(`Remove ${selectedNames || "the selected tokens"} from your portfolio? Their position value will return to available cash; total capital stays unchanged.`)) return;
    const remainingSymbols = bookSymbols.filter((symbol) => !removed.has(symbol));
    setBookSymbols(remainingSymbols);
    setPortfolioLedger((current) => {
      if (!current) return current;
      let next = current;
      for (const symbol of removed) {
        const position = next.positions.find((candidate) => candidate.symbol === symbol);
        const price = Number(assets.find((asset) => asset.symbol === symbol)?.ticker.lastPrice);
        if (position && position.quantity > 0 && Number.isFinite(price) && price > 0) {
          try {
            next = applyQuantityAdjustment(next, symbol, 0, price);
          } catch {
            continue;
          }
        }
      }
      return next;
    });
    setChartHoldingSymbols((current) => current.filter((symbol) => !removed.has(symbol)));
    setSelectedSymbol((current) => current && !removed.has(current) ? current : remainingSymbols[0]);
    setRemoveSymbols([]);
    setHoldingManager(null);
  }

  const activeHolding = (symbol: string) => analytics?.assets.find((asset) => asset.symbol === symbol)?.weight ?? holdingWeight(holdings, symbol);
  const activeQuantity = (symbol: string) => analytics?.assets.find((asset) => asset.symbol === symbol)?.quantity ?? holdingQuantity(holdings, symbol);
  const navChange = analytics?.dayChange ?? 0;
  const hhiScore = (analytics?.concentration ?? 0) * 100;
  const allocationCashWeight = Math.min(100, Math.max(0, analytics?.cashWeight ?? 0));
  const allocationInvestedWeight = Math.max(0, 100 - allocationCashWeight);
  const allocationRailSegments = (analytics?.sectorWeights ?? []).filter((sector) => sector.value > 0).sort((left, right) => {
    const leftIsCash = left.label === "Cash";
    const rightIsCash = right.label === "Cash";
    if (leftIsCash !== rightIsCash) return leftIsCash ? 1 : -1;
    return right.value - left.value;
  });
  const largestInvestedSector = allocationRailSegments.find((sector) => sector.label !== "Cash");
  const allocationRailDescription = largestInvestedSector
    ? `Your portfolio leans toward ${largestInvestedSector.label} at ${largestInvestedSector.value.toFixed(1)}%; ${allocationCashWeight.toFixed(1)}% stays liquid in cash.`
    : `Your portfolio is ${allocationCashWeight.toFixed(1)}% cash, ready for your next move.`;
  const allocationRailLabel = allocationRailSegments.map((sector) => `${sector.label} ${sector.value.toFixed(1)}%`).join(", ");
  const selectedHoldingQuantity = selectedAsset ? activeQuantity(selectedAsset.symbol) : 0;
  const selectedPrice = Number(selectedAsset?.ticker.lastPrice ?? 0);
  const selectedUnrealizedPnl = selectedPosition && selectedPrice > 0 ? (selectedPrice - selectedPosition.averageEntryPrice) * selectedHoldingQuantity : 0;
  const tradeQuantityValue = Number(tradeQuantityDraft);
  const tradeQuantityError = tradeQuantityInputError(tradeQuantityDraft);
  const tradeFeeRate = Number(selectedAsset?.instrument.takerFeeRate ?? DEFAULT_TAKER_FEE_RATE);
  const tradeQuantityStep = precisionStep(selectedAsset?.instrument.quantityPrecision);
  const liveOrderBook = orderBook && orderBook.asks.length > 0 && orderBook.bids.length > 0 ? orderBook : null;
  const useLastPriceFallback = Boolean(orderBook && !liveOrderBook && !orderBookLoading && selectedPrice > 0);
  const tradeQuantityLimitValue = liveOrderBook
    ? tradeQuantityLimit(liveOrderBook, tradeSide, cashBalance, selectedHoldingQuantity, tradeFeeRate)
    : useLastPriceFallback
      ? lastPriceTradeQuantityLimit(selectedPrice, tradeSide, cashBalance, selectedHoldingQuantity, tradeFeeRate)
      : 0;
  const tradeSizePercent = tradeQuantityLimitValue > 0 && tradeQuantityValue > 0 ? Math.min(100, Math.max(0, Math.round((tradeQuantityValue / tradeQuantityLimitValue) * 100))) : 0;
  const tradeQuoteState = (() => {
    if (tradeQuantityError) return { quote: null, error: tradeQuantityError };
    if (!tradeQuantityDraft || !Number.isFinite(tradeQuantityValue) || tradeQuantityValue <= 0) return { quote: null, error: "" };
    if (liveOrderBook) {
      try {
        return { quote: simulateMarketOrder(liveOrderBook, tradeSide, tradeQuantityValue, tradeFeeRate), error: "" };
      } catch (error) {
        return { quote: null, error: error instanceof Error ? error.message : "This trade cannot be quoted." };
      }
    }
    if (useLastPriceFallback) {
      try {
        return { quote: simulateLastPriceOrder(selectedPrice, tradeSide, tradeQuantityValue, tradeFeeRate), error: "" };
      } catch (error) {
        return { quote: null, error: error instanceof Error ? error.message : "This trade cannot be quoted." };
      }
    }
    if (!orderBook) return { quote: null, error: orderBookLoading ? "Loading the live order book…" : orderBookError || "The live order book is unavailable." };
    return { quote: null, error: "The last price is unavailable." };
  })();
  const tradeInsufficientCash = Boolean(tradeQuoteState.quote && tradeSide === "BUY" && tradeQuoteState.quote.cashImpact > cashBalance + Number.EPSILON);
  const tradeBalanceAfter = tradeQuoteState.quote
    ? tradeSide === "BUY"
      ? tradeInsufficientCash ? "Insufficient balance" : money(Math.max(0, cashBalance - tradeQuoteState.quote.cashImpact))
      : money(Math.max(0, tradeQuoteState.quote.cashImpact))
    : "—";
  const tradeValidationError = tradeNotice ? "" : tradeError || tradeQuoteState.error || (tradeQuoteState.quote && tradeSide === "BUY" && tradeQuoteState.quote.cashImpact > cashBalance + Number.EPSILON
    ? `Not enough cash. You need ${money(tradeQuoteState.quote.cashImpact)} including the estimated fee.`
    : tradeQuoteState.quote && tradeSide === "SELL" && tradeQuoteState.quote.filledQuantity > selectedHoldingQuantity + Number.EPSILON
      ? `You can sell up to ${formatTradeQuantity(selectedHoldingQuantity)} ${selectedAsset?.token ?? "units"}.`
      : "");
  const historyTrades = useMemo(() => (portfolioLedger?.trades ?? []).slice().reverse().filter((trade) => historyFilter === "all" || !selectedSymbol || trade.symbol === selectedSymbol), [historyFilter, portfolioLedger, selectedSymbol]);
  const portfolioTokenLimitReached = bookSymbols.length >= MAX_PORTFOLIO_HOLDINGS;
  const holdingRows = useMemo(() => bookSymbols.map((symbol) => {
    const asset = assets.find((candidate) => candidate.symbol === symbol);
    if (!asset) return null;
    const computed = analytics?.assets.find((holding) => holding.symbol === symbol);
    const stateHolding = holdings.find((holding) => holding.symbol === symbol);
    return { asset, holding: computed ?? { symbol, quantity: Number(stateHolding?.quantity ?? 0), weight: 0, value: 0, price: Number(asset.ticker.lastPrice), dayChange: Number(asset.ticker.price24hPcnt), sector: asset.sector } };
  }).filter((row): row is NonNullable<typeof row> => row !== null), [analytics, assets, bookSymbols, holdings]);
  const allSortedHoldingRows = useMemo(() => {
    if (!holdingSort) return holdingRows;
    const valueFor = (row: (typeof holdingRows)[number]) => {
      switch (holdingSort.key) {
        case "quantity": return row.holding.quantity;
        case "weight": return row.holding.weight;
        case "last": return Number(row.asset.ticker.lastPrice);
        case "change24h": return Number(row.asset.ticker.price24hPcnt);
        case "value": return row.holding.value;
      }
    };
    return [...holdingRows].sort((left, right) => {
      const difference = valueFor(left) - valueFor(right);
      if (difference === 0) return left.asset.token.localeCompare(right.asset.token);
      return holdingSort.direction === "desc" ? -difference : difference;
    });
  }, [holdingRows, holdingSort]);

  const holdingTotalPages = Math.max(1, Math.ceil(allSortedHoldingRows.length / HOLDINGS_PAGE_SIZE));
  const currentHoldingPage = Math.min(holdingPage, holdingTotalPages);
  const sortedHoldingRows = useMemo(() => {
    const start = (currentHoldingPage - 1) * HOLDINGS_PAGE_SIZE;
    return allSortedHoldingRows.slice(start, start + HOLDINGS_PAGE_SIZE);
  }, [allSortedHoldingRows, currentHoldingPage]);

  function toggleHoldingSort(key: HoldingSortKey) {
    setHoldingPage(1);
    setHoldingSort((current) => current?.key === key
      ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
      : { key, direction: "desc" });
  }

  function goToHoldingPage(page: number) {
    const nextPage = Math.max(1, Math.min(holdingTotalPages, page));
    setHoldingPage(nextPage);
    requestAnimationFrame(() => holdingsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function sortableHeader(label: string, key: HoldingSortKey) {
    const active = holdingSort?.key === key;
    const direction = active ? holdingSort.direction : undefined;
    return <button className="table-sort-button" type="button" onClick={() => toggleHoldingSort(key)} aria-label={`${label}, sort ${direction === "asc" ? "lowest to highest" : "highest to lowest"}`} title={active ? `Sorted ${direction === "asc" ? "lowest to highest" : "highest to lowest"}` : "Sort highest to lowest"}>{label}{active && <span className="table-sort-indicator" aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>}</button>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-lockup" type="button" aria-label="Go to Overview" onClick={() => focusView("Overview")}><Image className="brand-mark" src="/equitytrace-logo.png" width={36} height={36} alt="" preload /><span><span className="brand-name">EquityTrace</span><span className="brand-subtitle">Live Portfolio Insights Desk</span></span></button>
        <nav className="nav-tabs" aria-label="Workspace views">
          {(Object.keys(WORKSPACE_TARGETS) as WorkspaceView[]).map((view) => <button className={`nav-tab ${activeView === view ? "active" : ""}`} aria-current={activeView === view ? "page" : undefined} key={view} onClick={() => focusView(view)}>{view}</button>)}
        </nav>
        <div className="topbar-meta">
          <span className="live-pill"><span className={`live-dot ${loadState !== "ready" || marketRefreshing ? "muted" : ""}`} /> {marketRefreshing ? "Updating" : loadState === "ready" ? "Bitget live" : loadState}</span>
          <div className="settings-menu" ref={settingsRef}>
            <button className="icon-button settings-trigger" type="button" aria-label="Open portfolio settings" title="Portfolio settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((current) => !current)}><Settings size={18} /></button>
            {settingsOpen && <div className="settings-popover" role="dialog" aria-label="Portfolio settings">
              <div className="holding-popover-header">
                <div><strong>Portfolio settings</strong><span>Configure your read-only portfolio model.</span></div>
                <button className="icon-button" type="button" aria-label="Close portfolio settings" onClick={() => setSettingsOpen(false)}><X size={17} /></button>
              </div>
              <form className="settings-form" onSubmit={(event) => { event.preventDefault(); applyPortfolioCapital(); }}>
                <label className="settings-field"><span>Starting Capital</span><input type="text" inputMode="numeric" pattern="[0-9,]*" value={capitalInput} onChange={(event) => { const rawDigits = event.target.value.replace(/\D/g, ""); if (rawDigits.length > MAX_CAPITAL_DIGITS) return; const formatted = formatCapitalInput(rawDigits); setCapitalInput(formatted); setCapitalError(capitalInputError(formatted)); }} aria-invalid={Boolean(capitalError)} /></label>
                {capitalError && <small className="settings-error">{capitalError}</small>}
                <div className="settings-current"><span>Current {formatCapital(portfolioCapital)}</span><button className="button primary" type="submit">Apply</button></div>
                <div className="settings-divider" />
                <div className="settings-reset"><div><strong>Workspace</strong><span>Restore capital, holdings, charts, and portfolio settings.</span></div><button className="button danger" type="button" onClick={resetWorkspace}>Reset to default</button></div>
              </form>
            </div>}
          </div>
        </div>
      </header>

      <main className="page-wrap" id="desk">
        <div className="action-strip" id="action-strip" aria-label="Quick actions">
          <button className="action-card" type="button" onClick={() => focusView("Portfolio")}><span className="action-icon violet"><SlidersHorizontal size={20} /></span><span><strong>Manage Holdings</strong><small>Add, remove, or resize rTokens</small></span><ArrowUpRight size={17} /></button>
          <button className="action-card" type="button" onClick={focusPositionOverview}><span className="action-icon cyan"><Search size={20} /></span><span><strong>Inspect Position</strong><small>View position details and trading tools</small></span><ArrowUpRight size={17} /></button>
          <button className="action-card" type="button" onClick={() => focusView("Analysis")}><span className="action-icon amber"><Sparkles size={20} /></span><span><strong>Analyze Portfolio</strong><small>Ask about risk, performance, or scenarios</small></span><ArrowUpRight size={17} /></button>
        </div>

        {loadError && <div className="alert" role="alert"><CircleAlert size={17} /><span>{loadError}</span><button className="button ghost" onClick={() => void loadMarket(assets.map((asset) => asset.symbol))}>Retry</button></div>}

        {analytics ? <>
          <div className="metric-strip">
            <MetricCard label="Portfolio Value" value={money(analytics.nav)} detail={`${money(analytics.cashValue)} cash balance`} />
            <MetricCard label="Total P&L" value={money(ledgerValue?.totalPnl ?? 0, 2)} detail="since inception" tone={metricClass(ledgerValue?.totalPnl ?? 0)} />
            <MetricCard label="24h portfolio" value={pct(analytics.dayChange)} detail={analytics.dayChange >= 0 ? "up today" : "down today"} tone={metricClass(analytics.dayChange)} />
            <MetricCard label="Annualized vol" value={pct(analytics.volatility)} detail={`beta ${analytics.beta.toFixed(2)} vs ${tokenLabel(analytics.benchmarkSymbol)}`} tone={analytics.volatility > 0.3 ? "warn" : ""} />
            <MetricCard label="Return / Risk" value={analytics.sharpe.toFixed(2)} detail="90D realized returns" tone={analytics.sharpe >= 1 ? "" : "warn"} />
            <MetricCard label="Max drawdown" value={pct(analytics.maxDrawdown)} detail="Historical period" tone="danger" />
          </div>

          <div className="workbench-grid">
            <section className="panel chart-panel">
              <div className="panel-header chart-header">
                <div>
                  <div className="panel-title">Portfolio Performance</div>
                </div>
                <div className="chart-header-actions">
                  <div className="chart-control-group" aria-label="Performance window">
                    {[30, 90].map((days) => <button className={`chart-toggle ${chartRange === days ? "active" : ""}`} key={days} type="button" onClick={() => setChartRange(days as 30 | 90)}>{days}D</button>)}
                  </div>
                  <div className="chart-control-group" aria-label="Chart view">
                    <button className={`chart-toggle ${chartView === "portfolio" ? "active" : ""}`} type="button" onClick={() => setChartView("portfolio")}>Portfolio</button>
                    <button className={`chart-toggle ${chartView === "holdings" ? "active" : ""}`} type="button" onClick={() => setChartView("holdings")}>Tokens</button>
                  </div>
                  <span className="tiny-pill"><Activity size={14} /> {market ? timeLabel(market.asOf) : "loading"}</span>
                </div>
              </div>
              {chartView === "holdings" && availableChartHoldings.length > 0 && <div className="chart-holding-picker" aria-label="Choose tokens to compare"><span className="chart-picker-label">Compare tokens</span>{availableChartHoldings.map((series) => <button className={`chart-chip ${chartSelection.includes(series.key) ? "active" : ""}`} key={series.key} type="button" aria-pressed={chartSelection.includes(series.key)} onClick={() => toggleChartHolding(series.key)}><span className="legend-dot" style={{ background: series.color }} />{series.label}</button>)}</div>}
              <div className="panel-body">
                <div className="chart-legend">{chartLines.map((line) => <span className="legend-item" key={line.key}><span className="legend-dot" style={{ background: line.color }} /> {line.label}</span>)}<span className={`legend-item ${metricClass(navChange)}`}>{navChange >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />} {pct(navChange)} today</span></div>
                <LineChart performance={chartPerformance} lines={chartLines} />
              </div>
            </section>
            <section className="panel allocation-panel">
              <div className="panel-header"><div><div className="panel-title">Portfolio Allocation</div></div></div>
              <div className="panel-body"><div className="allocation-grid"><div className="allocation-ring" style={{ background: allocationGradient(analytics.sectorWeights) }}><div className="allocation-center hhi-tooltip-trigger" tabIndex={0} aria-describedby="hhi-score-tooltip"><strong>{hhiScore.toFixed(0)}</strong><span className="allocation-label">HHI score</span><span className="hhi-tooltip" id="hhi-score-tooltip" role="tooltip"><span className="hhi-tooltip-title">HHI concentration: {hhiScore.toFixed(0)}</span><span className="hhi-tooltip-copy">Higher means fewer, larger positions. Lower means your allocation is more spread out. Includes cash and does not predict returns.</span></span></div></div><div className="allocation-list">{analytics.sectorWeights.filter((sector) => sector.value > 0).sort((left, right) => right.value - left.value).map((sector) => <div className="allocation-item" key={sector.label}><span className="allocation-color" style={{ background: sector.color }} /><span>{sector.label}</span><strong>{sector.value.toFixed(1)}%</strong></div>)}</div><div className="allocation-rail" role="img" aria-label={`Portfolio allocation breakdown: ${allocationRailLabel}`}><div className="allocation-rail-labels"><span>Invested <strong>{allocationInvestedWeight.toFixed(1)}%</strong></span><span>Cash <strong>{allocationCashWeight.toFixed(1)}%</strong></span></div><div className="allocation-rail-track" aria-hidden="true">{allocationRailSegments.map((sector) => <span className="allocation-rail-segment" key={sector.label} style={{ background: sector.color, width: `${sector.value}%` }} />)}</div><p className="allocation-rail-note">{allocationRailDescription}</p></div></div></div>
            </section>

            <section className="panel full holdings-panel" id="portfolio" ref={holdingsPanelRef}>
              <div className="panel-header"><div><div className="eyebrow">PORTFOLIO / CLICK TO INSPECT</div><div className="panel-title">Portfolio Holdings</div></div><div className="portfolio-header-actions"><span className="tiny-pill"><WalletCards size={14} /> Available cash {money(analytics.cashValue)}</span><span className="tiny-pill"><span className="live-dot" /> {(market?.availableInstruments.length ?? assets.length).toLocaleString("en-US")} available tokens</span><div className="holding-manager"><button className="button manager-button primary" type="button" aria-expanded={holdingManager === "add"} disabled={portfolioTokenLimitReached} title={portfolioTokenLimitReached ? "You’ve reached 25 tokens. Remove one to add another holding." : undefined} onClick={() => toggleHoldingManager("add")}><Plus size={16} /> Add Token</button><button className={`button manager-button ${holdingManager === "remove" ? "danger" : "ghost"}`} type="button" aria-pressed={holdingManager === "remove"} onClick={() => toggleHoldingManager("remove")}><Trash2 size={16} /> Remove Token</button>{holdingManager === "add" && <div className="holding-popover add-holding-popover" role="dialog" aria-label="Add a token"><div className="holding-popover-header"><div><strong>Add a Token</strong><span>Search tokens by ticker or company name</span></div><button className="icon-button" type="button" aria-label="Close add token search" onClick={() => toggleHoldingManager("add")}><X size={17} /></button></div><label className="holding-search"><Search size={16} /><span className="sr-only">Search tokens by ticker</span><input autoFocus aria-label="Search tokens by ticker" placeholder="Search tokens by ticker" value={universeQuery} onChange={(event) => setUniverseQuery(event.target.value)} /></label>{normalizeSearch(universeQuery).length < 2 ? <div className="holding-search-hint"><Search size={16} /><span>Type at least 2 characters to find matching tokens.</span></div> : addableInstruments.length ? <div className="holding-results">{addableInstruments.map((instrument) => <button className="holding-result" type="button" key={instrument.symbol} onClick={() => void addInstrument(instrument.symbol)}><span className="holding-result-orb" style={{ background: instrument.color }} /><span className="holding-result-copy"><strong>{instrument.token}</strong><span>{instrument.name}</span></span><span className="holding-result-meta"><small>{instrument.sector}</small><Plus size={16} /></span></button>)}</div> : <div className="holding-search-hint"><Search size={16} /><span>No matching available tokens found.</span></div>}</div>}</div></div></div>
              <div className="panel-body table-scroll"><table className="holdings-table"><thead><tr>{holdingManager === "remove" && <th className="holding-select-heading"><span className="sr-only">Select token</span></th>}<th>Token</th><th aria-sort={holdingSort?.key === "quantity" ? holdingSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Quantity", "quantity")}</th><th aria-sort={holdingSort?.key === "last" ? holdingSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Last", "last")}</th><th aria-sort={holdingSort?.key === "change24h" ? holdingSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("24h", "change24h")}</th><th>Category</th><th aria-sort={holdingSort?.key === "value" ? holdingSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Value", "value")}</th><th aria-sort={holdingSort?.key === "weight" ? holdingSort.direction === "asc" ? "ascending" : "descending" : "none"}>{sortableHeader("Weight", "weight")}</th></tr></thead><tbody>{sortedHoldingRows.map(({ asset, holding }) => <tr className={`${selectedAsset?.symbol === asset.symbol ? "selected" : ""} ${holdingManager === "remove" ? "" : "row-selectable"}`} key={asset.symbol} tabIndex={holdingManager === "remove" ? undefined : 0} aria-selected={selectedAsset?.symbol === asset.symbol} onClick={holdingManager === "remove" ? undefined : () => focusAsset(asset.symbol)} onKeyDown={holdingManager === "remove" ? undefined : (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusAsset(asset.symbol); } }}>{holdingManager === "remove" && <td className="holding-select-cell"><input type="checkbox" checked={removeSymbols.includes(asset.symbol)} onChange={() => toggleRemoveSymbol(asset.symbol)} aria-label={`Select ${asset.token} to remove`} /></td>}<td><div className="asset-cell"><span className="asset-orb">{asset.token.replace("r", "").slice(0, 2)}</span><span className="asset-name"><strong>{asset.token}</strong><span>{asset.name}</span></span></div></td><td>{formatQuantity(holding.quantity)}</td><td>${Number(asset.ticker.lastPrice).toFixed(2)}</td><td className={metricClass(Number(asset.ticker.price24hPcnt))}>{pct(Number(asset.ticker.price24hPcnt))}</td><td>{asset.sector}</td><td>{money(holding.value)}</td><td><strong>{holding.weight.toFixed(1)}%</strong></td></tr>)}</tbody></table>{holdingManager === "remove" && <div className="holding-selection-bar"><span>{removeSymbols.length ? `${removeSymbols.length} selected · position value returns to cash` : "Select one or more tokens to remove"}</span><div><button className="button ghost" type="button" onClick={() => toggleHoldingManager("remove")}>Cancel</button><button className="button danger" type="button" disabled={!removeSymbols.length} onClick={removeSelectedHoldings}><Trash2 size={16} /> Remove selected{removeSymbols.length ? ` (${removeSymbols.length})` : ""}</button></div></div>}{holdingTotalPages > 1 && <div className="holdings-pagination" aria-label="Holdings pagination"><button className="button ghost" type="button" onClick={() => goToHoldingPage(currentHoldingPage - 1)} disabled={currentHoldingPage === 1}>Previous</button><span aria-live="polite">Page {currentHoldingPage} of {holdingTotalPages}</span><button className="button ghost" type="button" onClick={() => goToHoldingPage(currentHoldingPage + 1)} disabled={currentHoldingPage === holdingTotalPages}>Next</button></div>}</div>
            </section>

            <section className="panel position-overview-panel" id="position-overview" ref={positionOverviewRef}>
              <div className="panel-header"><div><div className="eyebrow">SELECTED POSITION / OVERVIEW</div><div className="panel-title">Position Overview</div></div><div className="position-header-actions"><label className="asset-filter"><Filter size={16} /><span className="sr-only">Select token to inspect</span><select aria-label="Select token to inspect" value={selectedAsset?.symbol ?? ""} onChange={(event) => { setSelectedSymbol(event.target.value || undefined); setPositionTab("trade"); setPositionOverviewMode("position"); setPositionOverviewData(null); setPositionOverviewError(""); setTradeQuantityDraft(""); setTradeError(""); setTradeNotice(""); setOrderBook(null); }}><option value="">Select a token…</option>{holdingRows.map(({ asset }) => <option value={asset.symbol} key={asset.symbol}>{asset.token}</option>)}</select></label></div></div>
              <div className="position-tab-list" role="tablist" aria-label="Position overview">
                {(["trade", "overview", "history"] as PositionTab[]).map((tab) => <button className={`position-tab ${positionTab === tab ? "active" : ""}`} key={tab} type="button" role="tab" aria-selected={positionTab === tab} aria-controls={`position-tabpanel-${tab}`} onClick={() => { setPositionTab(tab); setTradeError(""); setTradeNotice(""); }}>{tab === "trade" ? "Trade" : tab === "overview" ? "Overview" : "History"}</button>)}
              </div>
              <div className="panel-body position-tab-body" id={`position-tabpanel-${positionTab}`} role="tabpanel" aria-label={`${positionTab} position view`}>
                {!selectedAsset ? <div className="asset-empty"><Filter size={23} /><div><strong>Select a token to inspect</strong><span>Choose a token from the filter above to view its position and trading workspace.</span></div></div> : positionTab === "overview" ? <><div className="position-overview-mode-list" role="tablist" aria-label="Position Overview scope"><button className={positionOverviewMode === "position" ? "position-overview-mode active" : "position-overview-mode"} type="button" role="tab" aria-selected={positionOverviewMode === "position"} onClick={() => setPositionOverviewMode("position")}>Position</button><button className={positionOverviewMode === "asset" ? "position-overview-mode active" : "position-overview-mode"} type="button" role="tab" aria-selected={positionOverviewMode === "asset"} onClick={() => setPositionOverviewMode("asset")}>Asset</button><button className={positionOverviewMode === "news" ? "position-overview-mode active" : "position-overview-mode"} type="button" role="tab" aria-selected={positionOverviewMode === "news"} onClick={() => setPositionOverviewMode("news")}>News/Events</button></div>{positionOverviewMode === "position" ? <div className="position-summary"><div className="position-summary-hero"><div><div className="position-summary-symbol">{selectedAsset.token}</div><div className="position-summary-name">{selectedAsset.name}</div></div><div className="price-block"><strong>${Number(selectedAsset.ticker.lastPrice).toFixed(2)}</strong><span className={metricClass(Number(selectedAsset.ticker.price24hPcnt))}>{pct(Number(selectedAsset.ticker.price24hPcnt))} / 24h</span></div></div><div className="position-summary-facts"><div className="fact"><span>Quantity</span><strong>{formatQuantity(selectedHoldingQuantity)}</strong></div><div className="fact"><span>Position value</span><strong>{money(selectedHoldingQuantity * selectedPrice)}</strong></div><div className="fact"><span>Portfolio weight</span><strong>{activeHolding(selectedAsset.symbol).toFixed(1)}%</strong></div><div className="fact"><span>Unrealized P&amp;L</span><strong className={metricClass(selectedUnrealizedPnl)}>{money(selectedUnrealizedPnl)}</strong></div></div><div className="position-summary-facts position-summary-facts-secondary"><div className="fact"><span>Category</span><strong>{selectedAsset.sector}</strong></div><div className="fact"><span>Average entry</span><strong>{selectedPosition?.averageEntryPrice ? money(selectedPosition.averageEntryPrice) : "—"}</strong></div></div></div> : <PositionOverviewDataView data={positionOverviewData} loading={positionOverviewLoading} error={positionOverviewError} mode={positionOverviewMode === "news" ? "news" : "asset"} />}</> : positionTab === "trade" ? <div className="trade-workspace"><div className="trade-side-switch" role="group" aria-label="Trade side"><button className={tradeSide === "BUY" ? "active buy" : ""} type="button" onClick={() => { setTradeSide("BUY"); setTradeError(""); setTradeNotice(""); }}>Buy</button><button className={tradeSide === "SELL" ? "active sell" : ""} type="button" onClick={() => { setTradeSide("SELL"); setTradeError(""); setTradeNotice(""); }}>Sell</button><div className="trade-market-context" aria-label={`${selectedAsset.token} market price`}><strong>{"$"}{Number(selectedAsset.ticker.lastPrice).toFixed(2)}</strong><span className={metricClass(Number(selectedAsset.ticker.price24hPcnt))}>{pct(Number(selectedAsset.ticker.price24hPcnt))} / 24h</span></div></div><div className="trade-layout"><div className="trade-form"><div className="trade-form-heading"><div><strong>{tradeSide === "BUY" ? "Buy" : "Sell"} {selectedAsset.token}</strong></div></div><div className="trade-field"><label className="trade-input-label" htmlFor="trade-quantity-input">Quantity</label><span className="trade-input-wrap"><span className="trade-quantity-input"><input id="trade-quantity-input" type="number" min="0" max={MAX_TRADE_QUANTITY} step={TRADE_QUANTITY_INCREMENT} inputMode="decimal" value={tradeQuantityDraft} onChange={(event) => { const nextValue = event.target.value; if (!isTradeQuantityDraft(nextValue)) { setTradeError(tradeQuantityInputError(nextValue)); setTradeNotice(""); return; } setTradeQuantityDraft(nextValue); setTradeError(""); setTradeNotice(""); }} placeholder="Enter quantity" aria-invalid={Boolean(tradeError || tradeQuantityError)} /></span><span className="trade-size-slider"><span className="trade-size-control"><span className="trade-size-ticks" aria-hidden="true"><i className="trade-size-tick" style={{ left: "0%" }} /><i className="trade-size-tick" style={{ left: "25%" }} /><i className="trade-size-tick" style={{ left: "50%" }} /><i className="trade-size-tick" style={{ left: "75%" }} /><i className="trade-size-tick" style={{ left: "100%" }} /></span><input type="range" min="0" max="100" step="1" value={tradeSizePercent} onChange={(event) => { const nextPercent = Number(event.target.value); const nextQuantity = snapTradeQuantity(tradeQuantityLimitValue * nextPercent / 100, tradeQuantityStep); setTradeQuantityDraft(formatTradeQuantityInput(nextQuantity)); setTradeError(""); setTradeNotice(""); }} disabled={!tradeQuantityLimitValue} aria-label="Order size" /><span className="trade-size-tooltip" style={{ left: String(tradeSizePercent) + "%" }} aria-hidden="true">{tradeSizePercent}%</span></span></span></span></div><div className="trade-quote-grid"><div><span>Estimated fill</span><strong>{tradeQuoteState.quote ? money(tradeQuoteState.quote.executionPrice) : "—"}</strong></div><div><span>Order value</span><strong>{tradeQuoteState.quote ? money(tradeQuoteState.quote.grossValue) : "—"}</strong></div><div><span>Estimated fee</span><strong>{tradeQuoteState.quote ? money(tradeQuoteState.quote.fee) : "—"}</strong></div><div><span>{tradeSide === "BUY" ? "Balance after" : "Amount received"}</span><strong>{tradeBalanceAfter}</strong></div></div><div className="trade-estimate-note">Taker Fee: {(tradeFeeRate * 100).toFixed(2)}%</div>{tradeNotice && <div className="trade-success" role="status"><Check size={15} /> {tradeNotice}</div>}<button className="button primary trade-submit" type="button" disabled={Boolean(tradeValidationError) || !tradeQuoteState.quote} onClick={executeTrade}>{tradeSide === "BUY" ? "Buy" : "Sell"}</button><div className="trade-balance-note">{tradeSide === "SELL" ? `Available balance: ${formatTradeBalanceQuantity(selectedHoldingQuantity)} ${selectedAsset.token}` : `Available balance: ${money(cashBalance)}`}</div></div><div className="trade-orderbook"><div className="trade-orderbook-heading"><strong>{liveOrderBook ? "Order book" : useLastPriceFallback ? "Estimated execution" : "Order book"}</strong>{orderBookError && <span className="warn" aria-live="polite" title={orderBookError}>Last update unavailable</span>}</div>{liveOrderBook ? <div className="trade-book-levels"><div className="trade-book-header"><span>Ask price</span><span>Size</span></div>{[...liveOrderBook.asks.slice(0, 5)].reverse().map((level, index) => <div className="trade-book-row ask" key={`ask-${level.price}-${index}`}><span>{formatTradePrice(level.price)}</span><span>{formatTradeQuantity(level.quantity)}</span></div>)}<div className="trade-book-spread"><span>Spread</span><strong>{liveOrderBook.asks[0] && liveOrderBook.bids[0] ? `${formatTradePrice(liveOrderBook.asks[0].price - liveOrderBook.bids[0].price)} · ${(((liveOrderBook.asks[0].price - liveOrderBook.bids[0].price) / ((liveOrderBook.asks[0].price + liveOrderBook.bids[0].price) / 2)) * 10_000).toFixed(1)} bps` : "—"}</strong></div>{liveOrderBook.bids.slice(0, 5).map((level, index) => <div className="trade-book-row bid" key={`bid-${level.price}-${index}`}><span>{formatTradePrice(level.price)}</span><span>{formatTradeQuantity(level.quantity)}</span></div>)}<div className="trade-book-header"><span>Bid price</span><span>Size</span></div></div> : useLastPriceFallback ? <div className="trade-book-empty"><strong>No live depth available</strong><p>Buy and sell quotes use the last price, which is {formatTradePrice(selectedPrice)}.</p><p>Enter a quantity or use the size slider to enable Buy or Sell.</p></div> : <div className="trade-book-empty">{orderBookError || "Loading live depth…"}</div>}</div></div></div> : <div className="trade-history-workspace"><div className="history-toolbar"><div><strong>Recent trade activity</strong><span>{selectedAsset.token} history stays inside this panel</span></div><div className="history-filter" role="group" aria-label="Trade history scope"><button className={historyFilter === "selected" ? "active" : ""} type="button" onClick={() => setHistoryFilter("selected")}>Selected token</button><button className={historyFilter === "all" ? "active" : ""} type="button" onClick={() => setHistoryFilter("all")}>All positions</button></div></div>{historyTrades.length ? <div className="trade-history-scroll"><div className="trade-history-table" role="table" aria-label="Recent trade activity"><div className="trade-history-head" role="row"><span>Side</span><span>Token</span><span>Quantity</span><span>Fill</span><span>Fee</span><span>P&amp;L</span><span>Time</span></div>{historyTrades.map((trade) => <div className="trade-history-row" role="row" key={trade.id}><span className={`trade-side-label ${trade.side.toLowerCase()}`}>{trade.side === "BUY" ? "Buy" : "Sell"}</span><strong>{tokenLabel(trade.symbol)}</strong><span>{formatTradeQuantity(trade.quantity)}</span><span>{money(trade.executionPrice)}</span><span>{trade.fee ? money(trade.fee) : "—"}</span><span className={metricClass(trade.realizedPnl ?? 0)}>{trade.realizedPnl ? money(trade.realizedPnl) : "—"}</span><span>{tradeTimeLabel(trade.timestamp)}</span></div>)}</div></div> : <div className="trade-history-empty"><Activity size={22} /><strong>No trade activity yet</strong><span>Completed simulated buys and sells will appear here.</span></div>}</div>}
              </div>
            </section>

            <section className="panel" id="portfolio-signals">
              <div className="panel-header"><div><div className="eyebrow">PORTFOLIO / SIGNALS · 0–100 SCALE</div><div className="panel-title">Portfolio Signals</div></div></div>
              <div className="panel-body"><PortfolioHealthGauge health={riskExposure?.health ?? null} /><FactorMap analytics={analytics} /><p className="factor-help">Each bar shows the current intensity of a portfolio condition on a 0–100 scale; hover over a bar for more information.</p></div>
            </section>

            <PortfolioAnalysis context={portfolioAnalysisContext} onSelectSymbol={focusAsset} />

            {riskExposure && <PortfolioRiskExposurePanel exposure={riskExposure} benchmarkLabel={tokenLabel(analytics.benchmarkSymbol)} />}

          </div>
        </> : <div className="workbench-grid"><section className="panel full"><div className="panel-body loading-body"><div className="skeleton" /></div></section></div>}

        <footer className="source-footer"><span><Database size={14} /> Live read-only data · {market?.source ?? "Bitget Reality market API"}</span></footer>
      </main>

    </div>
  );
}
