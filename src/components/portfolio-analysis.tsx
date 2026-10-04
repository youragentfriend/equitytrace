"use client";

import { FormEvent, RefObject, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChartPie,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Database,
  ExternalLink,
  GitCompareArrows,
  LineChart,
  LoaderCircle,
  Newspaper,
  PanelRight,
  RotateCcw,
  Scale,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
  Target,
  X,
} from "lucide-react";
import { DefaultChatTransport } from "ai";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  availableChartWindows,
  applyResearchCanvasEvent,
  filterHoldingsBySector,
  workspaceFromCanvas,
  type AnalysisPosition,
  type EvidencePacket,
  type PortfolioAnalysisContext,
  type ResearchBlock,
  type ResearchBlockKind,
  type ResearchCanvasEvent,
  type ResearchCanvasState,
  type ResearchProgressEvent,
} from "@/lib/portfolio-analysis";

type ResearchUIMessage = UIMessage<unknown, {
  "research-canvas": ResearchCanvasEvent;
  "research-progress": ResearchProgressEvent;
}>;

const starters = [
  {
    label: "Review my portfolio",
    detail: "Performance, risk, concentration & flags",
    question: "Review my current holdings. Summarize performance and risk, identify my biggest concentration, and flag what needs attention.",
    tone: "blue",
    icon: ChartPie,
  },
  {
    label: "Check a trade idea",
    detail: "Portfolio impact & Bitget evidence",
    question: "What would adding RNVDA mean for my portfolio? Use current Bitget market data and relevant events to explain how the trade could affect my existing positions.",
    tone: "green",
    icon: ChartNoAxesCombined,
  },
  {
    label: "Stress-test my portfolio",
    detail: "Scenario risk & hedge ideas",
    question: "How could my portfolio respond to a market selloff, a sharp move in interest rates, or a shock to one of my largest sectors? Identify the main drivers, and suggest possible hedges.",
    tone: "red",
    icon: Scale,
  },
] as const;

function money(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
}

function percent(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function shortDate(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function freshnessLabel(value: string) {
  const age = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(age) || age < 0) return "timestamp unavailable";
  if (age < 60_000) return "live";
  if (age < 5 * 60_000) return `${Math.max(1, Math.round(age / 60_000))}m old`;
  if (age < 60 * 60_000) return `${Math.round(age / 60_000)}m old`;
  return shortDate(value);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function packet(block: ResearchBlock, kind?: string) {
  return (kind ? block.evidence.find((item) => item.kind === kind) : block.evidence[0]);
}

function linePath(values: number[], width: number, height: number, padding = 14) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.0001);
  return values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = padding + ((max - value) / span) * (height - padding * 2);
    return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function scaledLinePath(values: number[], min: number, max: number, width: number, height: number, padding = 14) {
  const span = Math.max(max - min, 0.0001);
  return values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = padding + ((max - value) / span) * (height - padding * 2);
    return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function canvasFromMessages(messages: ResearchUIMessage[]) {
  let canvas: ResearchCanvasState | null = null;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-research-canvas") canvas = applyResearchCanvasEvent(canvas, part.data);
    }
  }
  return canvas;
}

function progressFromMessages(messages: ResearchUIMessage[]) {
  const steps = new Map<string, ResearchProgressEvent>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-research-progress") steps.set(part.data.id, part.data);
    }
  }
  return [...steps.values()];
}

function iconFor(kind: ResearchBlockKind) {
  if (kind === "position-snapshot" || kind === "metric-strip") return <Target size={15} />;
  if (kind === "price-chart") return <LineChart size={15} />;
  if (kind === "holdings-table" || kind === "comparison-table") return <Table2 size={15} />;
  if (kind === "allocation-view") return <BarChart3 size={15} />;
  if (kind === "risk-map" || kind === "scenario-lab") return <ShieldCheck size={15} />;
  if (kind === "event-timeline") return <CalendarDays size={15} />;
  if (kind === "news-feed") return <Newspaper size={15} />;
  if (kind === "market-depth") return <BarChart3 size={15} />;
  if (kind === "sentiment-gauge") return <Activity size={15} />;
  if (kind === "correlation-chart") return <GitCompareArrows size={15} />;
  return <BookOpen size={15} />;
}

function evidenceTone(provider: EvidencePacket["provider"]) {
  if (provider === "bitget" || provider === "bitget-mcp") return "bitget";
  if (provider === "agentkey") return "agentkey";
  if (provider === "portfolio") return "portfolio";
  return "derived";
}

function EvidenceFooter({ evidence }: { evidence: EvidencePacket[] }) {
  const [open, setOpen] = useState(false);
  if (!evidence.length) return null;
  return <div className="ai-evidence-footer">
    <button type="button" onClick={() => setOpen((value) => !value)}><Database size={12} /><span>{evidence.length} source{evidence.length === 1 ? "" : "s"}</span><ChevronDown size={12} className={open ? "open" : ""} /></button>
    {open && <div className="ai-evidence-list">{evidence.map((item) => <div key={item.id}><i className={evidenceTone(item.provider)} /><span><strong>{item.label}</strong><small>{item.provider} · {freshnessLabel(item.asOf)}{item.confidence ? ` · ${item.confidence} confidence` : ""}</small>{item.sources?.length ? <small>Source: {item.sources.map((source) => source.label).join(", ")}</small> : null}{item.limitations?.length ? <small>Limit: {item.limitations.join(" ")}</small> : null}</span></div>)}</div>}
  </div>;
}

function PositionSnapshot({ block, onSelectSymbol }: { block: ResearchBlock; onSelectSymbol?: (symbol: string) => void }) {
  const source = packet(block, "portfolio-position") ?? packet(block, "reality-market") ?? packet(block);
  const data = object(source?.data);
  const position = object(data.position);
  const market = object(data.market);
  const asset = Object.keys(position).length ? position : data;
  const price = number(market.price) ?? number(data.price) ?? number(asset.price);
  const dayChange = number(market.dayChange) ?? number(data.dayChange) ?? number(asset.dayChange);
  const symbol = string(asset.symbol) ?? string(data.symbol);
  const token = string(asset.token) ?? string(data.token) ?? block.title;
  return <div className="ai-position">
    <div className="ai-position-identity"><span className="ai-token-mark">{token.slice(0, 2)}</span><div><strong>{token}</strong><span>{string(asset.name) ?? string(data.name) ?? symbol ?? "Market instrument"}</span></div></div>
    <div className="ai-position-price"><strong>{price === undefined ? "—" : money(price)}</strong><span className={(dayChange ?? 0) >= 0 ? "positive" : "negative"}>{dayChange === undefined ? "Move unavailable" : `${percent(dayChange)} today`}</span></div>
    {Object.keys(position).length > 0 && <div className="ai-metric-row">
      <div><span>Quantity</span><strong>{number(position.quantity)?.toLocaleString("en-US", { maximumFractionDigits: 6 }) ?? "—"}</strong></div>
      <div><span>Position value</span><strong>{money(number(position.value) ?? 0)}</strong></div>
      <div><span>Portfolio weight</span><strong>{number(position.weight) === undefined ? "—" : `${number(position.weight)!.toFixed(1)}%`}</strong></div>
    </div>}
    {symbol && onSelectSymbol && <button className="ai-inline-action" type="button" onClick={() => onSelectSymbol(symbol)}>Open position workspace <ArrowUpRight size={13} /></button>}
  </div>;
}

function metricsFromEvidence(evidence: EvidencePacket[]) {
  const metrics: Array<{ label: string; value: string; detail?: string; tone?: string }> = [];
  for (const item of evidence) {
    const data = object(item.data);
    if (item.kind === "portfolio-summary") {
      metrics.push(
        { label: "Portfolio NAV", value: money(number(data.nav) ?? 0), detail: "Current modeled value" },
        { label: "Cash", value: money(number(data.cashBalance) ?? 0), detail: "Available balance" },
        { label: "Total P&L", value: money(number(data.totalPnl) ?? 0), tone: (number(data.totalPnl) ?? 0) >= 0 ? "positive" : "negative" },
      );
    }
    if (item.kind === "reality-market") {
      metrics.push(
        { label: "Current mark", value: money(number(data.price) ?? 0), detail: string(data.token) },
        { label: "Daily move", value: percent(number(data.dayChange) ?? 0), tone: (number(data.dayChange) ?? 0) >= 0 ? "positive" : "negative" },
      );
    }
    if (item.kind === "technical-analysis") {
      metrics.push(
        { label: "Window return", value: percent(number(data.change) ?? 0), tone: (number(data.change) ?? 0) >= 0 ? "positive" : "negative" },
        { label: "Annualized vol", value: percent(number(data.annualizedVolatility) ?? 0), detail: `${number(data.window) ?? 0} observations` },
        { label: "Max drawdown", value: percent(number(data.maxDrawdown) ?? 0), tone: "negative" },
        { label: "20D average", value: money(number(data.sma20) ?? 0) },
        { label: "RSI (14)", value: number(data.rsi14)?.toFixed(1) ?? "—", detail: string(data.trend) ?? "Momentum" },
        { label: "MACD", value: number(data.macd)?.toFixed(2) ?? "—", tone: (number(data.macd) ?? 0) >= (number(data.macdSignal) ?? 0) ? "positive" : "negative" },
        { label: "Support (20D)", value: money(number(data.support20) ?? 0) },
        { label: "Resistance (20D)", value: money(number(data.resistance20) ?? 0) },
      );
    }
    if (item.kind === "portfolio-risk") {
      const risk = object(data.riskExposure);
      metrics.push(
        { label: "Volatility", value: percent(number(risk.volatility) ?? 0), detail: "Annualized", tone: "negative" },
        { label: "Beta", value: (number(risk.beta) ?? 0).toFixed(2), detail: "Market sensitivity" },
        { label: "Max drawdown", value: percent(number(risk.maxDrawdown) ?? 0), tone: "negative" },
      );
    }
    if (item.kind === "stress-scenario") {
      metrics.push(
        { label: "Scenario NAV", value: money(number(data.stressedNav) ?? 0) },
        { label: "Modeled impact", value: money(number(data.impact) ?? 0), tone: (number(data.impact) ?? 0) >= 0 ? "positive" : "negative" },
      );
    }
  }
  return metrics.slice(0, 8);
}

function MetricStrip({ block }: { block: ResearchBlock }) {
  const metrics = metricsFromEvidence(block.evidence);
  return <div className="ai-metrics">{metrics.length ? metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong className={metric.tone}>{metric.value}</strong>{metric.detail && <small>{metric.detail}</small>}</div>) : <EmptyBlock text="This evidence does not expose compatible summary metrics." />}</div>;
}

function candleEvidence(block: ResearchBlock) {
  for (const item of [...block.evidence].sort((left, right) => Number(right.kind === "technical-analysis") - Number(left.kind === "technical-analysis"))) {
    const data = object(item.data);
    const candles = Array.isArray(data.candles) ? data.candles : [];
    if (candles.length) return { item, data, candles };
  }
  return undefined;
}

function PriceChart({ block }: { block: ResearchBlock }) {
  const evidence = candleEvidence(block);
  const [windowSize, setWindowSize] = useState<30 | 90 | 365 | 0>(0);
  const [overlay, setOverlay] = useState<"price" | "averages" | "bands">("price");
  if (!evidence) return <EmptyBlock text="No compatible price history was returned for this view." />;
  const allPoints = evidence.candles.map(object).map((point) => ({ timestamp: number(point.timestamp) ?? 0, close: number(point.close) })).filter((point): point is { timestamp: number; close: number } => point.close !== undefined).sort((left, right) => left.timestamp - right.timestamp);
  const availableWindows = availableChartWindows(allPoints.map((point) => point.timestamp));
  const chartWindows: Array<30 | 90 | 365 | 0> = [...availableWindows, 0];
  const effectiveWindow = windowSize === 0 || availableWindows.includes(windowSize as 30 | 90 | 365) ? windowSize : 0;
  const cutoff = effectiveWindow && allPoints.length ? allPoints.at(-1)!.timestamp - effectiveWindow * 86_400_000 : 0;
  const points = effectiveWindow ? allPoints.filter((point) => point.timestamp >= cutoff) : allPoints;
  const values = points.map((point) => point.close);
  const indicatorRows = (Array.isArray(evidence.data.indicators) ? evidence.data.indicators : []).map(object).filter((row) => number(row.timestamp) !== undefined);
  const indicatorByTimestamp = new Map(indicatorRows.map((row) => [number(row.timestamp)!, row]));
  const overlays = points.map((point) => indicatorByTimestamp.get(point.timestamp));
  const sma20 = overlays.map((row) => number(row?.sma20)).filter((value): value is number => value !== undefined);
  const sma50 = overlays.map((row) => number(row?.sma50)).filter((value): value is number => value !== undefined);
  const upperBand = overlays.map((row) => number(row?.upperBand)).filter((value): value is number => value !== undefined);
  const lowerBand = overlays.map((row) => number(row?.lowerBand)).filter((value): value is number => value !== undefined);
  const scaleValues = [...values, ...(overlay === "averages" ? [...sma20, ...sma50] : overlay === "bands" ? [...upperBand, ...lowerBand] : [])];
  const scaleMin = Math.min(...scaleValues);
  const scaleMax = Math.max(...scaleValues);
  const change = values.length > 1 ? values.at(-1)! / values[0] - 1 : 0;
  return <div className="ai-chart">
    <div className="ai-chart-toolbar"><div><strong>{money(values.at(-1) ?? 0)}</strong><span>Last candle close · {percent(change)} in view</span></div><div>{chartWindows.map((value) => <button type="button" className={effectiveWindow === value ? "active" : ""} onClick={() => setWindowSize(value)} key={value}>{value === 365 ? "1Y" : value === 0 ? "MAX" : `${value}D`}</button>)}</div></div>
    {indicatorRows.length > 0 && <div className="ai-chart-overlays">{(["price", "averages", "bands"] as const).map((value) => <button type="button" className={overlay === value ? "active" : ""} onClick={() => setOverlay(value)} key={value}>{value === "averages" ? "MA 20 / 50" : value === "bands" ? "Volatility bands" : "Price"}</button>)}</div>}
    <svg viewBox="0 0 720 230" role="img" aria-label={`${block.title} price history`}><defs><linearGradient id={`fill-${block.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--violet)" stopOpacity=".22" /><stop offset="1" stopColor="var(--violet)" stopOpacity="0" /></linearGradient></defs><path className="fill" d={`${scaledLinePath(values, scaleMin, scaleMax, 720, 230)} L 706 216 L 14 216 Z`} fill={`url(#fill-${block.id})`} /><path className="line" d={scaledLinePath(values, scaleMin, scaleMax, 720, 230)} />{overlay === "averages" && sma20.length === values.length && <><path className="overlay-one" d={scaledLinePath(sma20, scaleMin, scaleMax, 720, 230)} /><path className="overlay-two" d={scaledLinePath(sma50, scaleMin, scaleMax, 720, 230)} /></>}{overlay === "bands" && upperBand.length === values.length && <><path className="overlay-one" d={scaledLinePath(upperBand, scaleMin, scaleMax, 720, 230)} /><path className="overlay-two" d={scaledLinePath(lowerBand, scaleMin, scaleMax, 720, 230)} /></>}</svg>
    <div className="ai-chart-range"><span>{points[0] ? shortDate(points[0].timestamp) : "—"}</span><span>{points.at(-1) ? shortDate(points.at(-1)!.timestamp) : "—"}</span></div>
    {number(object(evidence.data.asset).price) !== undefined && <div className="ai-chart-range"><span>{points.length} candles in view</span><span>Live quote {money(number(object(evidence.data.asset).price)!)}</span></div>}
    {(number(evidence.data.support20) !== undefined || number(evidence.data.resistance20) !== undefined) && <div className="ai-chart-levels"><div><span>Observed 20D support</span><strong>{number(evidence.data.support20) === undefined ? "—" : money(number(evidence.data.support20)!)}</strong></div><div><span>Observed 20D resistance</span><strong>{number(evidence.data.resistance20) === undefined ? "—" : money(number(evidence.data.resistance20)!)}</strong></div><div><span>RSI (14)</span><strong>{number(evidence.data.rsi14)?.toFixed(1) ?? "—"}</strong></div></div>}
  </div>;
}

function positionsFromBlock(block: ResearchBlock) {
  const item = packet(block, "portfolio-holdings");
  const positions = Array.isArray(item?.data) ? item.data as AnalysisPosition[] : [];
  return filterHoldingsBySector(positions, block.sectorFilter);
}

function HoldingsTable({ block, onSelectSymbol }: { block: ResearchBlock; onSelectSymbol?: (symbol: string) => void }) {
  const [query, setQuery] = useState("");
  const positions = positionsFromBlock(block).filter((position) => [position.token, position.name, position.symbol].some((value) => value.toLowerCase().includes(query.toLowerCase())));
  if (block.sectorFilter && positions.length === 0) return <EmptyBlock text={`No ${block.sectorFilter} holdings match this request.`} />;
  return <div className="ai-table-shell">
    <label className="ai-table-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter positions" /></label>
    <div className="ai-table-scroll"><table><thead><tr><th>Position</th><th>Weight</th><th>Value</th><th>Day</th></tr></thead><tbody>{positions.map((position) => <tr key={position.symbol} onClick={() => onSelectSymbol?.(position.symbol)}><td><strong>{position.token}</strong><span>{position.name}</span></td><td>{position.weight.toFixed(1)}%</td><td>{money(position.value)}</td><td className={position.dayChange >= 0 ? "positive" : "negative"}>{percent(position.dayChange)}</td></tr>)}</tbody></table></div>
  </div>;
}

function AllocationView({ block, onSelectSymbol }: { block: ResearchBlock; onSelectSymbol?: (symbol: string) => void }) {
  const positions = positionsFromBlock(block).sort((left, right) => right.weight - left.weight);
  if (block.sectorFilter && positions.length === 0) return <EmptyBlock text={`No ${block.sectorFilter} holdings match this request.`} />;
  return <div className="ai-allocation"><div className="ai-allocation-overview"><strong>{positions.length} positions</strong><span>Largest: {positions[0]?.token ?? "—"} · {positions[0]?.weight.toFixed(1) ?? "0"}%</span><div role="img" aria-label="Portfolio position allocation">{positions.map((position) => <i key={position.symbol} title={`${position.token} ${position.weight.toFixed(1)}%`} style={{ width: `${Math.max(0, position.weight)}%`, background: position.color }} />)}</div></div>{positions.map((position) => <button type="button" key={position.symbol} onClick={() => onSelectSymbol?.(position.symbol)}><span><i style={{ background: position.color }} /><strong>{position.token}</strong></span><em><i style={{ width: `${Math.min(100, position.weight)}%`, background: position.color }} /></em><b>{position.weight.toFixed(1)}%</b></button>)}</div>;
}

function RiskMap({ block }: { block: ResearchBlock }) {
  const source = packet(block, "portfolio-risk") ?? packet(block);
  const data = object(source?.data);
  const risk = object(data.riskExposure);
  const analytics = object(data.analytics);
  const metrics = [
    ["Volatility", number(risk.volatility), "percent"],
    ["Beta", number(risk.beta), "number"],
    ["Max drawdown", number(risk.maxDrawdown), "percent"],
    ["Diversification ratio", number(risk.diversificationRatio), "ratio"],
  ] as const;
  const sectors = (Array.isArray(analytics.sectorWeights) ? analytics.sectorWeights : []).map(object).filter((item) => string(item.label) && number(item.value) !== undefined).sort((left, right) => (number(right.value) ?? 0) - (number(left.value) ?? 0));
  const factors = (Array.isArray(analytics.factorScores) ? analytics.factorScores : []).map(object).filter((item) => string(item.label) && number(item.value) !== undefined);
  const correlation = object(risk.correlation);
  const correlationValues = Array.isArray(correlation.values) ? correlation.values : [];
  const correlationCount = correlationValues.reduce<number>((count, row, rowIndex) => count + (Array.isArray(row) ? row.filter((value, columnIndex) => columnIndex > rowIndex && typeof value === "number" && Number.isFinite(value)).length : 0), 0);
  return <div className="ai-risk">
    <div className="ai-risk-metrics">{metrics.map(([label, value, format]) => <div key={label}><span>{label}</span><strong>{value === undefined ? "—" : format === "percent" ? percent(value) : format === "ratio" ? `${value.toFixed(2)}×` : value.toFixed(2)}</strong></div>)}</div>
    {sectors.length > 0 && <div className="ai-risk-composition"><div><strong>Exposure composition</strong><span>{sectors.length} sectors · largest {string(sectors[0]?.label) ?? "—"} {number(sectors[0]?.value)?.toFixed(1) ?? "—"}%</span></div><div className="ai-risk-stack" role="img" aria-label="Portfolio sector exposure composition">{sectors.map((sector) => <i key={string(sector.label)} title={`${string(sector.label)} ${number(sector.value)?.toFixed(1)}%`} style={{ width: `${Math.max(0, number(sector.value) ?? 0)}%`, background: string(sector.color) ?? "var(--violet)" }} />)}</div></div>}
    {(sectors.length > 0 || factors.length > 0) && <div className="ai-exposure-grid">
      {sectors.length > 0 && <div className="ai-exposure-group"><strong>Sector exposure</strong>{sectors.slice(0, 6).map((sector) => { const value = number(sector.value) ?? 0; return <div className="ai-exposure-row" key={string(sector.label)}><span>{string(sector.label)}</span><em><i style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: string(sector.color) ?? "var(--violet)" }} /></em><b>{value.toFixed(1)}%</b></div>; })}</div>}
      {factors.length > 0 && <div className="ai-exposure-group"><strong>Factor signals</strong>{factors.slice(0, 6).map((factor) => { const value = number(factor.value) ?? 0; return <div className="ai-exposure-row" key={string(factor.label)}><span>{string(factor.label)}</span><em><i style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: string(factor.color) ?? "var(--cyan)" }} /></em><b>{string(factor.status) ?? value.toFixed(0)}</b></div>; })}</div>}
    </div>}
    {correlationCount > 0 && <div className="ai-correlation"><span>Correlation evidence available</span><strong>{correlationCount} relationships</strong></div>}
  </div>;
}

function ScenarioLab({ block }: { block: ResearchBlock }) {
  const source = packet(block, "stress-scenario") ?? packet(block);
  const data = object(source?.data);
  const initial = number(data.shock) ?? -0.2;
  const [shock, setShock] = useState(initial);
  const baseNav = number(data.baseNav) ?? 0;
  const exposure = number(data.exposure) ?? 0;
  const impact = exposure * shock;
  const scope = string(data.scope) ?? "portfolio";
  const label = string(data.label) ?? "Portfolio";
  const positions = (Array.isArray(data.positions) ? data.positions : data.position ? [data.position] : []).map(object)
    .map((position) => ({ token: string(position.token) ?? "Position", value: number(position.value) ?? 0 }))
    .filter((position) => position.value > 0).sort((left, right) => right.value - left.value);
  const steps = [-1, -0.6, -0.3, -0.1, 0, 0.1, 0.4];
  const sliderMax = Math.max(0.4, Math.ceil(initial * 10) / 10);
  return <div className="ai-scenario">
    <div className="ai-scenario-context"><strong>{label} {scope} stress</strong><span>Invested exposure {money(exposure)} · Baseline NAV {money(baseNav)}</span></div>
    <div className="ai-scenario-readout"><div><span>Price shock</span><strong className={shock >= 0 ? "positive" : "negative"}>{percent(shock, 0)}</strong></div><div><span>Modeled NAV change</span><strong className={impact >= 0 ? "positive" : "negative"}>{money(impact)}</strong></div><div><span>Scenario NAV</span><strong>{money(baseNav + impact)}</strong></div></div>
    <div className="ai-scenario-nav"><span>Baseline <b>{money(baseNav)}</b></span><span>After shock <b>{money(baseNav + impact)}</b></span><div><i style={{ width: `${baseNav > 0 ? Math.min(100, Math.max(0, (baseNav + impact) / baseNav * 100)) : 0}%` }} /></div></div>
    <label><span>Adjust {label} price shock</span><input type="range" min="-1" max={sliderMax} step="0.01" value={shock} onChange={(event) => setShock(Number(event.target.value))} /><div><small>-100%</small><small>0</small><small>+{(sliderMax * 100).toFixed(0)}%</small></div></label>
    <div className="ai-scenario-presets">{steps.map((value) => <button type="button" className={shock === value ? "active" : ""} key={value} onClick={() => setShock(value)}>{percent(value, 0)}</button>)}</div>
    <div className="ai-scenario-ladder"><strong>Scenario ladder</strong><div>{steps.filter((value) => value !== 0).map((value) => <button type="button" key={value} onClick={() => setShock(value)}><span>{percent(value, 0)}</span><b className={value < 0 ? "negative" : "positive"}>{money(baseNav + exposure * value)}</b></button>)}</div></div>
    {positions.length > 0 && <div className="ai-scenario-contributors"><strong>Position contributions at {percent(shock, 0)}</strong>{positions.slice(0, 6).map((position) => <div key={position.token}><span>{position.token}</span><em><i style={{ width: `${exposure > 0 ? Math.min(100, position.value / exposure * 100) : 0}%` }} /></em><b className={shock >= 0 ? "positive" : "negative"}>{money(position.value * shock)}</b></div>)}</div>}
    <p><CircleAlert size={13} /> Isolated linear price sensitivity, not a forecast. Cash is unchanged; gaps, liquidity and correlation shifts are not modeled.</p>
  </div>;
}

function ThesisBoard({ block, onAsk }: { block: ResearchBlock; onAsk: (question: string) => void }) {
  const synthesis = block.synthesis;
  if (!synthesis) return <EmptyBlock text="The model did not provide a thesis synthesis for this block." />;
  return <div className="ai-thesis">
    <p className="ai-thesis-headline">{synthesis.headline}</p>
    <div className="ai-thesis-grid"><div><strong><Check size={14} /> Evidence supporting</strong>{synthesis.supports.map((item) => <p key={item}>{item}</p>)}</div><div><strong><CircleAlert size={14} /> Risks and limits</strong>{synthesis.risks.map((item) => <p key={item}>{item}</p>)}</div></div>
    {synthesis.invalidation.length > 0 && <div className="ai-invalidation"><span>What would invalidate this</span>{synthesis.invalidation.map((item) => <button key={item} type="button" onClick={() => onAsk(`Investigate this invalidation condition: ${item}`)}>{item}<ChevronRight size={12} /></button>)}</div>}
  </div>;
}

function findDisplayItems(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    const objects = value.map(object).filter((item) => Object.keys(item).length > 0);
    if (objects.length) return objects.slice(0, 12);
    return value.flatMap((item) => findDisplayItems(item, depth + 1)).slice(0, 12);
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      const found = findDisplayItems(child, depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

function itemCopy(item: Record<string, unknown>) {
  return {
    title: string(item.title) ?? string(item.headline) ?? string(item.name) ?? string(item.event) ?? string(item.label) ?? "Research result",
    detail: string(item.summary) ?? string(item.description) ?? string(item.snippet) ?? string(item.detail) ?? string(item.text),
    source: string(item.source) ?? string(item.publisher) ?? string(item.provider),
    date: string(item.date) ?? string(item.published_at) ?? string(item.publishedAt) ?? string(item.time),
    url: string(item.url) ?? string(item.link),
  };
}

function EvidenceFeed({ block, timeline = false }: { block: ResearchBlock; timeline?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = block.evidence.flatMap((item) => findDisplayItems(item.data)).map(itemCopy).slice(0, 10);
  if (!items.length) return <EmptyBlock text="The selected evidence did not contain displayable feed items." />;
  return <div className={timeline ? "ai-timeline" : "ai-feed"}>{items.map((item, index) => <article key={`${item.title}-${index}`} className={expanded === `${index}` ? "expanded" : ""}>
    {timeline && <i />}
    <button type="button" onClick={() => setExpanded((value) => value === `${index}` ? null : `${index}`)}><span>{item.date ? shortDate(item.date) : item.source ?? "Evidence"}</span><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}</button>
    {item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open source for ${item.title}`}><ExternalLink size={13} /></a>}
  </article>)}</div>;
}

function ComparisonTable({ block }: { block: ResearchBlock }) {
  const trades = block.evidence.filter((item) => item.kind === "proposed-trade-impact");
  if (trades.length) {
    return <div className="ai-table-shell"><div className="ai-table-scroll"><table><thead><tr><th>Instrument</th><th>Funding</th><th>Position weight</th><th>Sector weight</th><th>Cash after</th><th>NAV after</th></tr></thead><tbody>{trades.flatMap((trade) => {
      const data = object(trade.data);
      const token = string(data.token) ?? trade.label;
      const alternatives = (Array.isArray(data.alternatives) ? data.alternatives : []).map(object);
      return [<tr key={`${trade.id}-before`}><td><strong>{token}</strong></td><td>Before</td><td>{(number(data.beforePositionWeight) ?? 0).toFixed(1)}%</td><td>{(number(data.beforeSectorWeight) ?? 0).toFixed(1)}%</td><td>—</td><td>{money(number(data.beforeNav) ?? 0)}</td></tr>, ...alternatives.map((row) => <tr key={`${trade.id}-${string(row.funding) ?? "funding"}`}><td><strong>{token}</strong></td><td>{string(row.funding) ?? "Funding"}</td><td>{(number(row.afterPositionWeight) ?? 0).toFixed(1)}%</td><td>{(number(row.afterSectorWeight) ?? 0).toFixed(1)}%</td><td>{money(number(row.afterCash) ?? 0)}</td><td>{money(number(row.afterNav) ?? 0)}</td></tr>)];
    })}</tbody></table></div></div>;
  }
  const depthPackets = block.evidence.filter((item) => item.kind === "market-depth");
  if (depthPackets.length) return <div className="ai-table-shell"><div className="ai-table-scroll"><table><thead><tr><th>Instrument</th><th>Spread</th><th>Bid depth</th><th>Ask depth</th><th>Book imbalance</th></tr></thead><tbody>{depthPackets.map((item) => {
    const data = object(item.data);
    return <tr key={item.id}><td><strong>{string(data.symbol)?.replace(/USDT$/i, "") ?? item.label}</strong></td><td>{number(data.spreadBps) === undefined ? "—" : `${number(data.spreadBps)!.toFixed(1)} bps`}</td><td>{number(data.bidNotional) === undefined ? "—" : compactMoney(number(data.bidNotional)!)}</td><td>{number(data.askNotional) === undefined ? "—" : compactMoney(number(data.askNotional)!)}</td><td>{number(data.imbalance) === undefined ? "—" : percent(number(data.imbalance)!)}</td></tr>;
  })}</tbody></table></div></div>;
  const holdings = block.evidence.find((item) => item.kind === "portfolio-holdings");
  const fundamentalsPackets = block.evidence.filter((item) => item.kind === "reality-fundamentals");
  if (holdings && fundamentalsPackets.length === 0) {
    const positions = Array.isArray(holdings.data) ? holdings.data as AnalysisPosition[] : [];
    const sectors = [...new Set(positions.map((position) => position.sector))].filter((sector) => !block.comparisonSectors || block.comparisonSectors.includes(sector)).map((sector) => {
      const members = positions.filter((position) => position.sector === sector);
      return { sector, members, weight: members.reduce((sum, position) => sum + position.weight, 0), value: members.reduce((sum, position) => sum + position.value, 0) };
    }).sort((left, right) => right.weight - left.weight);
    return <div className="ai-table-shell"><div className="ai-table-scroll"><table><thead><tr><th>Sector</th><th>Weight</th><th>Value</th><th>Holdings</th><th>Largest positions</th></tr></thead><tbody>{sectors.map((row) => <tr key={row.sector}><td><strong>{row.sector}</strong></td><td>{row.weight.toFixed(1)}%</td><td>{money(row.value)}</td><td>{row.members.length}</td><td>{row.members.sort((a, b) => b.value - a.value).slice(0, 3).map((position) => position.token).join(", ")}</td></tr>)}</tbody></table></div></div>;
  }
  if (fundamentalsPackets.length > 1) return <div className="ai-table-shell"><div className="ai-table-scroll"><table><thead><tr><th>Instrument</th><th>Forward P/E</th><th>TTM P/E</th><th>Price / book</th><th>Dividend</th></tr></thead><tbody>{fundamentalsPackets.map((item) => { const data = object(item.data); const valuation = object(data.valuation); const asset = object(data.asset); return <tr key={item.id}><td><strong>{string(asset.token) ?? item.label}</strong></td><td>{number(valuation.pe)?.toFixed(2) ?? "—"}</td><td>{number(valuation.peTtm)?.toFixed(2) ?? "—"}</td><td>{number(valuation.pb)?.toFixed(2) ?? "—"}</td><td>{number(valuation.dividendYield) === undefined ? "—" : `${number(valuation.dividendYield)!.toFixed(2)}%`}</td></tr>; })}</tbody></table></div></div>;
  const fundamentals = fundamentalsPackets[0];
  if (fundamentals) {
    const data = object(fundamentals.data);
    const valuation = object(data.valuation);
    const report = object(data.report);
    const metrics = [
      { label: "Forward P/E", value: number(valuation.pe), format: "multiple" },
      { label: "TTM P/E", value: number(valuation.peTtm), format: "multiple" },
      { label: "Price / book", value: number(valuation.pb), format: "multiple" },
      { label: "Price / sales", value: number(valuation.ps), format: "multiple" },
      { label: "EV / EBITDA", value: number(valuation.evEbitda), format: "multiple" },
      { label: "Dividend yield", value: number(valuation.dividendYield), format: "percent-points" },
      { label: "Market cap", value: number(valuation.marketCap), format: "money" },
      { label: "Expected EPS", value: number(report.eps), format: "currency" },
    ].filter((metric) => metric.value !== undefined);
    if (!metrics.length) return <EmptyBlock text="Bitget returned the instrument, but no valuation metrics were available." />;
    return <div className="ai-fundamentals-grid">{metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.format === "percent-points" ? `${(metric.value as number).toFixed(2)}%` : metric.format === "money" ? compactMoney(metric.value as number) : metric.format === "currency" ? money(metric.value as number) : `${(metric.value as number).toFixed(2)}×`}</strong></div>)}</div>;
  }
  const rows = block.evidence.map((item) => {
    const data = object(item.data);
    const asset = object(data.asset);
    const position = object(data.position);
    return {
      label: string(asset.token) ?? string(position.token) ?? string(data.token) ?? item.label,
      price: number(asset.price) ?? number(data.price) ?? number(position.price),
      move: number(asset.dayChange) ?? number(data.dayChange) ?? number(position.dayChange),
      change: number(data.change),
      volatility: number(data.annualizedVolatility),
    };
  });
  return <div className="ai-table-shell"><div className="ai-table-scroll"><table><thead><tr><th>Evidence</th><th>Price</th><th>Day</th><th>Window</th><th>Volatility</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.price === undefined ? "—" : money(row.price)}</td><td className={(row.move ?? 0) >= 0 ? "positive" : "negative"}>{row.move === undefined ? "—" : percent(row.move)}</td><td>{row.change === undefined ? "—" : percent(row.change)}</td><td>{row.volatility === undefined ? "—" : percent(row.volatility)}</td></tr>)}</tbody></table></div></div>;
}

function MarketDepth({ block }: { block: ResearchBlock }) {
  const depthPackets = block.evidence.filter((item) => item.kind === "market-depth");
  const [selectedId, setSelectedId] = useState(depthPackets[0]?.id ?? "");
  const selected = depthPackets.find((item) => item.id === selectedId) ?? depthPackets[0];
  const data = object(selected?.data);
  const [levels, setLevels] = useState(5);
  const bids = (Array.isArray(data.bids) ? data.bids : []).map(object).slice(0, levels);
  const asks = (Array.isArray(data.asks) ? data.asks : []).map(object).slice(0, levels);
  const maxNotional = Math.max(1, ...[...bids, ...asks].map((level) => (number(level.price) ?? 0) * (number(level.quantity) ?? 0)));
  if (!bids.length || !asks.length) return <EmptyBlock text="Bitget returned no displayable market depth." />;
  const rows = Math.max(bids.length, asks.length);
  return <div className="ai-depth">
    {depthPackets.length > 1 && <div className="ai-sentiment-tabs">{depthPackets.map((item) => <button className={selected?.id === item.id ? "active" : ""} type="button" key={item.id} onClick={() => setSelectedId(item.id)}>{string(object(item.data).symbol)?.replace(/USDT$/i, "") ?? item.label}</button>)}</div>}
    <div className="ai-depth-summary"><div><span>Spread</span><strong>{(number(data.spreadBps) ?? 0).toFixed(1)} bps</strong></div><div><span>Book imbalance</span><strong className={(number(data.imbalance) ?? 0) >= 0 ? "positive" : "negative"}>{percent(number(data.imbalance) ?? 0, 0)}</strong></div><div className="ai-depth-controls">{[5, 10, 15].map((value) => <button className={levels === value ? "active" : ""} type="button" key={value} onClick={() => setLevels(value)}>{value}</button>)}</div></div>
    <div className="ai-depth-head"><span>Bid depth</span><span>Ask depth</span></div>
    <div className="ai-depth-book">{Array.from({ length: rows }, (_, index) => {
      const bid = bids[index]; const ask = asks[index];
      const bidNotional = (number(bid?.price) ?? 0) * (number(bid?.quantity) ?? 0);
      const askNotional = (number(ask?.price) ?? 0) * (number(ask?.quantity) ?? 0);
      return <div className="ai-depth-row" key={index}><div><i style={{ width: `${bidNotional / maxNotional * 100}%` }} /><span>{bid ? money(number(bid.price) ?? 0) : "—"}</span></div><div><i style={{ width: `${askNotional / maxNotional * 100}%` }} /><span>{ask ? money(number(ask.price) ?? 0) : "—"}</span></div></div>;
    })}</div>
  </div>;
}

function SentimentGauge({ block }: { block: ResearchBlock }) {
  const data = object(packet(block, "crypto-market-structure")?.data);
  const [metric, setMetric] = useState<"positioning" | "funding">("positioning");
  const longRatio = number(data.longRatio);
  const shortRatio = number(data.shortRatio);
  const funding = number(data.fundingRate);
  const positioningScore = longRatio !== undefined && shortRatio !== undefined ? Math.max(-1, Math.min(1, longRatio - shortRatio)) : 0;
  const fundingScore = funding === undefined ? 0 : Math.max(-1, Math.min(1, funding / 0.001));
  const score = metric === "positioning" ? positioningScore : fundingScore;
  const label = score > 0.18 ? "Risk-on bias" : score < -0.18 ? "Risk-off bias" : "Balanced";
  const angle = -90 + (score + 1) / 2 * 180;
  return <div className="ai-sentiment">
    <div className="ai-sentiment-tabs"><button className={metric === "positioning" ? "active" : ""} type="button" onClick={() => setMetric("positioning")}>Positioning</button><button className={metric === "funding" ? "active" : ""} type="button" onClick={() => setMetric("funding")}>Funding</button></div>
    <div className="ai-gauge"><svg viewBox="0 0 220 126" role="img" aria-label={`${string(data.symbol) ?? "Crypto"} ${label}`}><path d="M 28 108 A 82 82 0 0 1 192 108" /><line x1="110" y1="108" x2="110" y2="39" transform={`rotate(${angle} 110 108)`} /><circle cx="110" cy="108" r="7" /></svg><strong>{label}</strong><span>{metric === "funding" ? funding === undefined ? "Funding unavailable" : `${percent(funding, 3)} / interval` : longRatio === undefined ? "Positioning unavailable" : `${percent(longRatio, 0)} long · ${percent(shortRatio ?? 0, 0)} short`}</span></div>
    <div className="ai-sentiment-metrics"><div><span>24h move</span><strong className={(number(data.change24h) ?? 0) >= 0 ? "positive" : "negative"}>{percent(number(data.change24h) ?? 0)}</strong></div><div><span>Open interest</span><strong>{number(data.openInterest) === undefined ? "—" : compactMoney(number(data.openInterest)!)}</strong></div><div><span>Long / short</span><strong>{number(data.longShortRatio)?.toFixed(2) ?? "—"}</strong></div></div>
  </div>;
}

function CorrelationChart({ block }: { block: ResearchBlock }) {
  const data = object(packet(block, "cross-asset-analysis")?.data);
  const series = (Array.isArray(data.series) ? data.series : []).map(object).map((point) => ({ timestamp: number(point.timestamp) ?? 0, primary: number(point.primary), benchmark: number(point.benchmark) })).filter((point): point is { timestamp: number; primary: number; benchmark: number } => point.primary !== undefined && point.benchmark !== undefined);
  const [windowSize, setWindowSize] = useState<30 | 90 | 0>(90);
  const points = windowSize ? series.slice(-windowSize) : series;
  if (points.length < 2) return <EmptyBlock text="There is not enough aligned history for this cross-asset view." />;
  return <div className="ai-cross-asset">
    <div className="ai-cross-toolbar"><div><span>Return correlation</span><strong>{number(data.returnCorrelation)?.toFixed(2) ?? "—"}</strong></div><div>{([30, 90, 0] as const).map((value) => <button className={windowSize === value ? "active" : ""} type="button" key={value} onClick={() => setWindowSize(value)}>{value || "MAX"}</button>)}</div></div>
    <div className="ai-cross-legend"><span><i />{string(data.primaryLabel) ?? "Asset"}</span><span><i />{string(data.benchmarkLabel) ?? "Benchmark"}</span></div>
    <svg viewBox="0 0 720 230" role="img" aria-label={`${string(data.primaryLabel) ?? "Asset"} and ${string(data.benchmarkLabel) ?? "benchmark"} normalized performance`}><path className="primary" d={linePath(points.map((point) => point.primary), 720, 230)} /><path className="benchmark" d={linePath(points.map((point) => point.benchmark), 720, 230)} /></svg>
    <p>Indexed to 100 at the start of the selected view. Correlation describes co-movement, not causation.</p>
  </div>;
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="ai-block-empty"><CircleAlert size={17} /><span>{text}</span></div>;
}

function BlockBody({ block, onAsk, onSelectSymbol }: { block: ResearchBlock; onAsk: (question: string) => void; onSelectSymbol?: (symbol: string) => void }) {
  if (block.kind === "position-snapshot") return <PositionSnapshot block={block} onSelectSymbol={onSelectSymbol} />;
  if (block.kind === "metric-strip") return <MetricStrip block={block} />;
  if (block.kind === "price-chart") return <PriceChart block={block} />;
  if (block.kind === "holdings-table") return <HoldingsTable block={block} onSelectSymbol={onSelectSymbol} />;
  if (block.kind === "allocation-view") return <AllocationView block={block} onSelectSymbol={onSelectSymbol} />;
  if (block.kind === "risk-map") return <RiskMap block={block} />;
  if (block.kind === "scenario-lab") return <ScenarioLab block={block} />;
  if (block.kind === "thesis-board") return <ThesisBoard block={block} onAsk={onAsk} />;
  if (block.kind === "event-timeline") return <EvidenceFeed block={block} timeline />;
  if (block.kind === "news-feed") return <EvidenceFeed block={block} />;
  if (block.kind === "market-depth") return <MarketDepth block={block} />;
  if (block.kind === "sentiment-gauge") return <SentimentGauge block={block} />;
  if (block.kind === "correlation-chart") return <CorrelationChart block={block} />;
  return <ComparisonTable block={block} />;
}

function ResearchBlockView({ block, onAsk, onSelectSymbol }: { block: ResearchBlock; onAsk: (question: string) => void; onSelectSymbol?: (symbol: string) => void }) {
  return <article className={`ai-research-block span-${block.span} kind-${block.kind}`}>
    <header><div className="ai-block-title"><span>{iconFor(block.kind)}</span><div><strong>{block.title}</strong>{block.subtitle && <small>{block.subtitle}</small>}</div></div></header>
    <BlockBody block={block} onAsk={onAsk} onSelectSymbol={onSelectSymbol} />
    <EvidenceFooter evidence={block.evidence} />
  </article>;
}

function CanvasEmpty() {
  return <div className="ai-canvas-empty">
    <div className="ai-canvas-orbit" aria-hidden="true"><Sparkles size={22} /><i className="orbit-cyan" /><i className="orbit-amber" /><i className="orbit-pink" /><i className="orbit-green" /></div>
    <span className="ai-canvas-kicker">READY WHEN YOU ARE</span>
    <strong className="ai-canvas-title">Ask a question about your portfolio</strong>
    <p className="ai-canvas-description">Try performance, risk, news, or a what-if scenario. Your answer will appear here with useful charts and evidence.</p>
    <div className="ai-canvas-capabilities">
      <span className="capability-charts"><ChartNoAxesCombined size={14} /> Charts</span>
      <span className="capability-tables"><Table2 size={14} /> Tables</span>
      <span className="capability-scenarios"><Activity size={14} /> Scenarios</span>
      <span className="capability-evidence"><Newspaper size={14} /> Evidence</span>
    </div>
  </div>;
}

function CanvasLoading({ progress }: { progress: ResearchProgressEvent[] }) {
  const active = progress.filter((step) => step.id !== "research-start").slice(-4);
  return <div className="ai-canvas-loading"><div className="ai-loading-hero"><span><LoaderCircle size={18} className="animate-spin" /></span><div><strong>Building the research surface</strong><p>Qwen is deciding what evidence and visuals this question needs.</p></div></div><div className="ai-loading-steps">{active.length ? active.map((step) => <div key={step.id} className={step.state}><i>{step.state === "complete" ? <Check size={11} /> : <LoaderCircle size={11} className="animate-spin" />}</i><span>{step.label}</span></div>) : <div><i><LoaderCircle size={11} className="animate-spin" /></i><span>Understanding your question</span></div>}</div><div className="ai-loading-grid"><i /><i /><i /></div></div>;
}

function CanvasError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="ai-canvas-error"><CircleAlert size={24} /><strong>Research did not complete</strong><p>{message}</p><button type="button" onClick={onRetry}>Try again</button></div>;
}

function MessageThread({ messages, busy, progress, threadRef }: { messages: ResearchUIMessage[]; busy: boolean; progress: ResearchProgressEvent[]; threadRef: RefObject<HTMLDivElement | null> }) {
  const visible = messages.flatMap((message) => {
    const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
    return text ? [{ id: message.id, role: message.role, text }] : [];
  });
  return <div ref={threadRef} className={`ai-thread${visible.length ? "" : " is-empty"}`} aria-live="polite">
    {!visible.length && <div className="ai-thread-intro"><span className="ai-thread-intro-icon" aria-hidden="true"><Sparkles size={28} strokeWidth={1.8} /></span><strong>Start a research thread.</strong><p>Ask what you want to know. Find out what you need.</p></div>}
    {visible.map((message) => <div className={`ai-message ${message.role}`} key={message.id}>{message.role === "assistant" && <span className="ai-message-avatar"><Image src="/equitytrace-assistant.png" width={34} height={34} alt="" /></span>}<div className={message.role === "assistant" ? "ai-answer" : undefined}>{message.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{message.text}</ReactMarkdown> : message.text}</div></div>)}
    {busy && visible.at(-1)?.role !== "assistant" && <div className="ai-message assistant pending"><span className="ai-message-avatar"><Image src="/equitytrace-assistant.png" width={34} height={34} alt="" /></span><div><span className="ai-typing"><i /><i /><i /></span><small>{progress.findLast((step) => step.state === "running")?.label ?? "Researching"}</small></div></div>}
  </div>;
}

export function PortfolioAnalysis({ context, onSelectSymbol }: { context: PortfolioAnalysisContext; onSelectSymbol?: (symbol: string) => void }) {
  const [input, setInput] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const transport = useMemo(() => new DefaultChatTransport<ResearchUIMessage>({ api: "/api/portfolio-analysis" }), []);
  const { messages, sendMessage, setMessages, status, stop, error } = useChat<ResearchUIMessage>({ transport });
  const canvas = useMemo(() => canvasFromMessages(messages), [messages]);
  const progress = useMemo(() => progressFromMessages(messages), [messages]);
  const busy = status === "submitted" || status === "streaming";
  const activeProgress = progress.findLast((step) => step.state === "running");
  const busyLabel = activeProgress?.label ?? "Replying";
  const updatingCanvas = busy && canvas?.status === "ready";
  const gridRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const revealAfterCountRef = useRef<number | null>(null);
  const followReplyRef = useRef(false);
  const revealTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const onScroll = () => {
      if (revealTimerRef.current === null) {
        followReplyRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
      }
    };
    const stopFollowing = () => {
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
      followReplyRef.current = false;
    };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) stopFollowing(); };
    thread.addEventListener("scroll", onScroll, { passive: true });
    thread.addEventListener("wheel", onWheel, { passive: true });
    thread.addEventListener("touchstart", stopFollowing, { passive: true });
    return () => {
      thread.removeEventListener("scroll", onScroll);
      thread.removeEventListener("wheel", onWheel);
      thread.removeEventListener("touchstart", stopFollowing);
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    if (revealAfterCountRef.current !== null && messages.length > revealAfterCountRef.current) {
      revealAfterCountRef.current = null;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = reduceMotion ? "instant" : "smooth";
      // Align both panels in the viewport; only the conversation scrolls to the reply.
      gridRef.current?.scrollIntoView({ behavior, block: "start" });
      thread.scrollTo({ top: thread.scrollHeight, behavior });
      if (reduceMotion) {
        thread.scrollTop = thread.scrollHeight;
      } else {
        revealTimerRef.current = window.setTimeout(() => {
          revealTimerRef.current = null;
          if (followReplyRef.current) thread.scrollTop = thread.scrollHeight;
        }, 700);
      }
      return;
    }
    if (followReplyRef.current && revealTimerRef.current === null) thread.scrollTop = thread.scrollHeight;
  }, [messages, busy]);

  function ask(question: string) {
    const value = question.trim();
    if (!value || busy) return;
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    revealAfterCountRef.current = messages.length;
    followReplyRef.current = true;
    setInput("");
    setLastQuestion(value);
    void sendMessage({ text: value }, { body: { analysisContext: context, canvas, workspace: workspaceFromCanvas(canvas) } });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(input);
  }

  function reset() {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    revealAfterCountRef.current = null;
    followReplyRef.current = false;
    stop();
    setMessages([]);
    setInput("");
    setLastQuestion("");
  }

  return <section className="panel full ai-workbench" id="portfolio-analysis">
    <header className="panel-header"><div><div className="eyebrow">AI TRADING DESK / READ-ONLY</div><div className="panel-title">Portfolio Research</div></div><div className="ai-workbench-state"><i className={busy ? "busy" : ""} /><span>{busy ? busyLabel : "Ready"}</span></div></header>
    <div ref={gridRef} className="ai-workbench-grid">
      <aside className="ai-conversation">
        <div className="ai-conversation-head"><div><span className="ai-agent-avatar"><Image src="/equitytrace-assistant.png" width={34} height={34} alt="" /></span><div><strong>EquityTrace Assistant</strong><small>Evidence-backed insights.</small></div></div>{messages.length > 0 && <button type="button" onClick={reset}><RotateCcw size={13} /> New thread</button>}</div>
        <MessageThread messages={messages} busy={busy} progress={progress} threadRef={threadRef} />
        {!messages.length && <div className="ai-starters">{starters.map((starter) => { const Icon = starter.icon; return <button className={`ai-starter tone-${starter.tone}`} type="button" key={starter.question} onClick={() => ask(starter.question)}><span className="ai-starter-icon"><Icon size={16} strokeWidth={1.9} /></span><span className="ai-starter-copy"><strong>{starter.label}</strong><span>{starter.detail}</span></span><ChevronRight size={14} /></button>; })}</div>}
        <form className="ai-composer" onSubmit={submit}><textarea rows={3} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(input); } }} placeholder="Ask about an rToken, your portfolio, a thesis, risk, news, or a scenario…" aria-label="Ask Portfolio Research" /><div><span className="ai-composer-hint">Enter to send · Shift+Enter for a new line</span><button type={busy ? "button" : "submit"} onClick={busy ? stop : undefined} disabled={!busy && !input.trim()} aria-label={busy ? "Stop research" : "Send question"}>{busy ? <X size={15} /> : <Send size={15} />}</button></div></form>
        {error && <div className="ai-inline-error"><CircleAlert size={13} />{error.message}</div>}
      </aside>

      <main className={`ai-canvas${updatingCanvas ? " is-updating" : ""}`}>
        <div className="ai-canvas-head"><div><span className="ai-canvas-icon"><PanelRight size={15} /></span><div><strong>{canvas?.status === "ready" ? canvas.title : "Research workspace"}</strong><small>{canvas?.subject?.label ?? "Ask a question to get started"}</small></div></div>{canvas?.status === "ready" && <div className="ai-canvas-meta"><span>{canvas.blocks.length} view{canvas.blocks.length === 1 ? "" : "s"}</span><span>{canvas.evidence.length} source{canvas.evidence.length === 1 ? "" : "s"}</span>{canvas.confidence && <span className={`confidence-${canvas.confidence}`}>{canvas.confidence} confidence</span>}</div>}</div>
        {!canvas && <CanvasEmpty />}
        {canvas?.status === "loading" && <CanvasLoading progress={progress} />}
        {canvas?.status === "error" && <CanvasError message={canvas.summary} onRetry={() => lastQuestion && ask(lastQuestion)} />}
        {updatingCanvas && <div className="ai-canvas-update" role="status"><LoaderCircle size={15} strokeWidth={1.6} className="animate-spin" aria-hidden="true" /><span>Updating canvas</span></div>}
        {canvas?.status === "ready" && <div className="ai-canvas-scroll"><div className="ai-canvas-brief"><span>RESEARCH BRIEF</span><p>{canvas.summary}</p></div><div className="ai-block-grid">{canvas.blocks.map((block) => <ResearchBlockView key={block.id} block={block} onAsk={ask} onSelectSymbol={onSelectSymbol} />)}</div>{canvas.followups.length > 0 && <div className="ai-followups"><span>Continue the research</span><div>{canvas.followups.map((followup) => <button type="button" key={followup} onClick={() => ask(followup)}>{followup}<ChevronRight size={12} /></button>)}</div></div>}{canvas.warnings.length > 0 && <div className="ai-canvas-warning"><CircleAlert size={13} /><span>{canvas.warnings.join(" ")}</span><button type="button" onClick={() => ask(`Retry only the unavailable evidence from the previous answer. Reuse every successful source and keep the current subject: ${canvas.subject?.label ?? "the current research"}.`)}>Retry missing source</button></div>}</div>}
      </main>
    </div>
  </section>;
}
