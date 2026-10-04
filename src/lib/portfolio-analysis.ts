import type { PortfolioAnalytics, PortfolioRiskExposure } from "./types";

export type CanvasOperation = "preserve" | "update" | "append" | "replace";
export type ResearchStatus = "loading" | "streaming" | "ready" | "error";
export type EvidenceProvider = "portfolio" | "bitget" | "bitget-mcp" | "derived" | "agentkey";

export const researchBlockKinds = [
  "position-snapshot",
  "metric-strip",
  "price-chart",
  "holdings-table",
  "allocation-view",
  "risk-map",
  "scenario-lab",
  "comparison-table",
  "thesis-board",
  "event-timeline",
  "news-feed",
  "market-depth",
  "sentiment-gauge",
  "correlation-chart",
] as const;

export type ResearchBlockKind = typeof researchBlockKinds[number];
export type ResearchBlockSpan = "full" | "half";

export type AnalysisPosition = {
  symbol: string;
  token: string;
  name: string;
  sector: string;
  color: string;
  quantity: number;
  weight: number;
  value: number;
  price: number;
  dayChange: number;
};

export type AnalysisTrade = {
  id: string;
  side: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  executionPrice: number;
  grossValue: number;
  fee: number;
  timestamp: string;
};

export type AnalysisAsset = {
  symbol: string;
  token: string;
  name: string;
  sector: string;
  color: string;
  price: number;
  dayChange: number;
  candles: Array<{ timestamp: number; close: number }>;
};

export type PortfolioAnalysisContext = {
  asOf: string;
  source: string;
  warnings: string[];
  selectedSymbol?: string;
  portfolio: {
    startingCapital: number;
    cashBalance: number;
    nav: number;
    totalPnl: number;
    unrealizedPnl: number;
    realizedPnl: number;
    positions: AnalysisPosition[];
    recentTrades: AnalysisTrade[];
  };
  analytics: PortfolioAnalytics | null;
  riskExposure: PortfolioRiskExposure | null;
  assets: AnalysisAsset[];
};

export type ResearchSubject = {
  label: string;
  symbol?: string;
  token?: string;
  scope: "position" | "portfolio" | "market" | "comparison";
};

export type EvidencePacket = {
  id: string;
  kind: string;
  label: string;
  provider: EvidenceProvider;
  asOf: string;
  data: unknown;
  capability?: ResearchCapability;
  confidence?: "low" | "medium" | "high";
  limitations?: string[];
  sources?: Array<{ label: string; url?: string }>;
};

export const researchCapabilities = [
  "portfolio-intelligence",
  "rtoken-market",
  "company-intelligence",
  "technical-intelligence",
  "event-intelligence",
  "crypto-market-structure",
  "macro-cross-asset",
  "external-news",
  "scenario-intelligence",
] as const;

export type ResearchCapability = typeof researchCapabilities[number];
export type ResearchDepth = "lookup" | "focused" | "comprehensive";

export type TurnMode = "conversation" | "education" | "clarification" | "research";
export type ResearchAnswerShape = "collection" | "snapshot" | "analysis" | "decision" | "comparison" | "technical" | "scenario" | "timeline";

export type TurnRoute = {
  mode: TurnMode;
  response: string;
  canvasAction: "preserve" | "research";
  needsFreshEvidence: boolean;
  answerShape?: ResearchAnswerShape;
  plan?: ResearchPlan;
};

export type ResearchPlan = {
  subject: string;
  questionType: "portfolio" | "position" | "decision" | "technical" | "events" | "comparison" | "scenario" | "cross-asset" | "market";
  depth: ResearchDepth;
  capabilities: ResearchCapability[];
  researchQuestions: string[];
};

export type PresentationEvidenceIndexItem = Pick<EvidencePacket, "id" | "kind" | "label" | "provider" | "asOf" | "capability" | "confidence" | "limitations"> & {
  dataPreview: string;
  compatibleViews: ResearchBlockKind[];
};

export type ThesisSynthesis = {
  headline: string;
  supports: string[];
  risks: string[];
  invalidation: string[];
};

export type ResearchBlock = {
  id: string;
  kind: ResearchBlockKind;
  title: string;
  subtitle?: string;
  span: ResearchBlockSpan;
  sectorFilter?: string;
  comparisonSectors?: string[];
  evidenceIds: string[];
  evidence: EvidencePacket[];
  synthesis?: ThesisSynthesis;
};

export type ResearchCanvasEvent = {
  operation: CanvasOperation;
  status: ResearchStatus;
  title: string;
  summary: string;
  subject?: ResearchSubject;
  confidence?: "low" | "medium" | "high";
  blocks: ResearchBlock[];
  evidence: EvidencePacket[];
  followups: string[];
  warnings: string[];
};

export type ResearchCanvasState = ResearchCanvasEvent;

export type ResearchProgressEvent = {
  id: string;
  label: string;
  phase: "thinking" | "tool" | "composing";
  state: "running" | "complete" | "error";
  tool?: string;
};

export type ResearchWorkspaceState = {
  subject?: ResearchSubject;
  title?: string;
  blockKinds: ResearchBlockKind[];
  evidenceIds: string[];
};

export type PresentationBlockPlan = {
  id: string;
  kind: ResearchBlockKind;
  title: string;
  subtitle?: string;
  span: ResearchBlockSpan;
  evidenceIds: string[];
  synthesis?: ThesisSynthesis;
};

export type PresentationPlan = {
  operation: CanvasOperation;
  title: string;
  summary: string;
  subject?: ResearchSubject;
  confidence: "low" | "medium" | "high";
  blocks: PresentationBlockPlan[];
  followups: string[];
  narrative?: string;
};

export type StressScenarioScope = "portfolio" | "sector" | "position";

export type StressScenarioResult = {
  scope: StressScenarioScope;
  label: string;
  shock: number;
  baseNav: number;
  exposure: number;
  impact: number;
  stressedNav: number;
  position?: AnalysisPosition;
  positions?: AnalysisPosition[];
};

export type ProposedBuyImpact = {
  token: string;
  sector: string;
  amount: number;
  beforeNav: number;
  beforePositionWeight: number;
  beforeSectorWeight: number;
  alternatives: Array<{
    funding: "portfolio cash" | "new capital";
    afterNav: number;
    afterCash: number;
    afterPositionWeight: number;
    afterSectorWeight: number;
  }>;
  limitations: string[];
};

export function calculateProposedBuyImpact(context: PortfolioAnalysisContext, query: string, amount: number): ProposedBuyImpact | null {
  const normalized = query.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^r(?=[a-z])/, "");
  const matches = (values: string[]) => values.some((value) => value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^r(?=[a-z])/, "") === normalized);
  const position = context.portfolio.positions.find((item) => matches([item.symbol, item.token, item.name]));
  const asset = context.assets.find((item) => matches([item.symbol, item.token, item.name]));
  const nav = context.portfolio.nav;
  if ((!position && !asset) || !Number.isFinite(nav) || nav <= 0 || !Number.isFinite(amount) || amount <= 0) return null;
  const sector = position?.sector ?? asset!.sector;
  const beforeValue = position?.value ?? 0;
  const beforeSectorValue = context.portfolio.positions.filter((item) => item.sector === sector).reduce((total, item) => total + item.value, 0);
  const alternative = (funding: "portfolio cash" | "new capital") => {
    const afterNav = nav + (funding === "new capital" ? amount : 0);
    return {
      funding,
      afterNav,
      afterCash: context.portfolio.cashBalance - (funding === "portfolio cash" ? amount : 0),
      afterPositionWeight: (beforeValue + amount) / afterNav * 100,
      afterSectorWeight: (beforeSectorValue + amount) / afterNav * 100,
    };
  };
  return {
    token: position?.token ?? asset!.token,
    sector,
    amount,
    beforeNav: nav,
    beforePositionWeight: beforeValue / nav * 100,
    beforeSectorWeight: beforeSectorValue / nav * 100,
    alternatives: [
      ...(context.portfolio.cashBalance >= amount ? [alternative("portfolio cash")] : []),
      alternative("new capital"),
    ],
    limitations: ["Static weight arithmetic only; excludes price movement, fees, slippage, taxes, and execution. No other holdings are sold."],
  };
}

const compatibleEvidenceKinds: Record<ResearchBlockKind, readonly string[] | "any"> = {
  "position-snapshot": ["portfolio-position", "reality-market"],
  "metric-strip": ["portfolio-summary", "portfolio-risk", "reality-market", "technical-analysis", "stress-scenario"],
  "price-chart": ["technical-analysis", "reality-market"],
  "holdings-table": ["portfolio-holdings"],
  "allocation-view": ["portfolio-holdings"],
  "risk-map": ["portfolio-risk"],
  "scenario-lab": ["stress-scenario"],
  "comparison-table": ["portfolio-position", "portfolio-holdings", "proposed-trade-impact", "reality-market", "reality-fundamentals", "technical-analysis", "market-depth"],
  "thesis-board": "any",
  "event-timeline": ["corporate-events"],
  "news-feed": ["external-research", "bitget-research"],
  "market-depth": ["market-depth"],
  "sentiment-gauge": ["crypto-market-structure"],
  "correlation-chart": ["cross-asset-analysis"],
};

export function pearsonCorrelation(left: number[], right: number[]) {
  const count = Math.min(left.length, right.length);
  if (count < 3) return undefined;
  const a = left.slice(-count);
  const b = right.slice(-count);
  const meanA = a.reduce((sum, value) => sum + value, 0) / count;
  const meanB = b.reduce((sum, value) => sum + value, 0) / count;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < count; index += 1) {
    const deltaA = a[index]! - meanA;
    const deltaB = b[index]! - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA ** 2;
    varianceB += deltaB ** 2;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator > 0 ? covariance / denominator : undefined;
}

export function crossAssetAnalysis(primary: Array<{ timestamp: number; close: number }>, benchmark: Array<{ timestamp: number; close: number }>, primaryLabel: string, benchmarkLabel: string) {
  const benchmarkByDay = new Map(benchmark.map((point) => [new Date(point.timestamp).toISOString().slice(0, 10), point.close]));
  const aligned = primary.flatMap((point) => {
    const peer = benchmarkByDay.get(new Date(point.timestamp).toISOString().slice(0, 10));
    return peer === undefined ? [] : [{ timestamp: point.timestamp, primary: point.close, benchmark: peer }];
  });
  const primaryReturns = aligned.slice(1).map((point, index) => point.primary / aligned[index]!.primary - 1);
  const benchmarkReturns = aligned.slice(1).map((point, index) => point.benchmark / aligned[index]!.benchmark - 1);
  const normalize = (values: number[]) => values.length ? values.map((value) => value / values[0]! * 100) : [];
  const normalizedPrimary = normalize(aligned.map((point) => point.primary));
  const normalizedBenchmark = normalize(aligned.map((point) => point.benchmark));
  return {
    primaryLabel,
    benchmarkLabel,
    observations: aligned.length,
    returnCorrelation: pearsonCorrelation(primaryReturns, benchmarkReturns),
    series: aligned.map((point, index) => ({ timestamp: point.timestamp, primary: normalizedPrimary[index], benchmark: normalizedBenchmark[index] })),
  };
}

function normalizeResearchQuery(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^r(?=[a-z])/, "");
}

export function calculateStressScenario({ scope, query, shock, baseNav, positions }: {
  scope: StressScenarioScope;
  query?: string;
  shock: number;
  baseNav: number;
  positions: AnalysisPosition[];
}): StressScenarioResult {
  if (!Number.isFinite(shock) || shock < -1) throw new Error("A price-loss shock must be between -100% and 0%; a price cannot fall more than 100%.");
  if (scope === "portfolio") {
    const exposure = positions.reduce((sum, position) => sum + position.value, 0);
    return { scope, label: "Portfolio", shock, baseNav, exposure, impact: exposure * shock, stressedNav: baseNav + exposure * shock, positions };
  }

  const needle = normalizeResearchQuery(query ?? "");
  if (scope === "position") {
    const position = positions.find((item) => [item.symbol, item.token, item.name].some((value) => normalizeResearchQuery(value) === needle));
    if (!position) throw new Error("The requested position is not present in the supplied portfolio.");
    const exposure = position.value;
    return { scope, label: position.token, shock, baseNav, exposure, impact: exposure * shock, stressedNav: baseNav + exposure * shock, position };
  }

  const matching = positions.filter((item) => normalizeResearchQuery(item.sector) === needle);
  if (!matching.length) throw new Error("The requested sector is not present in the supplied portfolio.");
  const exposure = matching.reduce((sum, item) => sum + item.value, 0);
  const label = matching[0]!.sector;
  return { scope, label, shock, baseNav, exposure, impact: exposure * shock, stressedNav: baseNav + exposure * shock, positions: matching };
}

export function normalizeStressShock(question: string, shock: number) {
  const magnitude = Math.abs(shock);
  if (/\b(upside|rise|rises|increase|increases|gain|gains|rally|appreciat(?:e|es|ion)|positive)\b/i.test(question)) return magnitude;
  if (/\b(stress(?:-test)?|downside|decline|declines|drop|drops|fall|falls|fell|loss|decrease|decreases|crash|negative)\b/i.test(question) || /-\s*\d/.test(question)) return -magnitude;
  return shock;
}

export function isInvestmentDecisionQuestion(question: string) {
  return /\b(?:should|would|could)\s+i\s+(?:buy|sell|hold|trim|add|exit|reduce|increase|rebalance)\b|\b(?:buy|sell|hold|trim|add\s+to|exit|reduce|increase|rebalance(?:\s+(?:out|away|into))?)\s+(?:my\s+)?(?:position|holding|exposure|r[A-Z0-9.-]+|[A-Z]{2,8})\b|\bis it time to\s+(?:buy|sell|hold|trim|add|exit|reduce|increase|rebalance)\b/i.test(question);
}

export function inferStressScenarioInput(question: string, positions: AnalysisPosition[]): { scope: StressScenarioScope; query?: string; shock: number } {
  const percent = question.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  const requestedShock = percent ? Number(percent[1]) / 100 : 0.2;
  const shock = normalizeStressShock(question, Number.isFinite(requestedShock) ? requestedShock : 0.2);
  const normalizedQuestion = question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  if (/\b(largest|biggest|top|highest[- ]weight(?:ed)?)\s+(?:portfolio\s+)?(?:holding|position)\b/i.test(question)) {
    const largest = largestPortfolioPositions(positions, 1)[0];
    return largest ? { scope: "position", query: largest.token, shock } : { scope: "portfolio", shock };
  }

  const position = positions.find((item) => {
    const candidates = [item.token, item.symbol, item.name]
      .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .filter((value) => value.length > 1);
    return candidates.some((value) => new RegExp(`(?:^|\\s)${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i").test(normalizedQuestion));
  });
  if (position) return { scope: "position", query: position.token, shock };

  const sector = positions.map((item) => item.sector).find((value, index, values) => {
    if (values.indexOf(value) !== index) return false;
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return normalized.length > 1 && new RegExp(`(?:^|\\s)${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i").test(normalizedQuestion);
  });
  if (sector) return { scope: "sector", query: sector, shock };

  const namedToken = question.match(/\br[A-Z][A-Z0-9.-]{1,12}\b/i)?.[0];
  if (namedToken) return { scope: "position", query: `r${namedToken.slice(1).toUpperCase()}`, shock };
  return { scope: "portfolio", shock };
}

export function largestPortfolioPositions(positions: AnalysisPosition[], count: number) {
  const limit = Math.max(0, Math.min(positions.length, Math.trunc(count)));
  return [...positions]
    .sort((left, right) => right.weight - left.weight || right.value - left.value || left.symbol.localeCompare(right.symbol))
    .slice(0, limit);
}

function normalizedSector(value: string) {
  return value.toLowerCase().replace(/\b(sector|category)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function sectorLinkedToHoldings(question: string, sector: string) {
  const name = normalizedSector(sector).split(" ").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (!name) return false;
  const category = `(?:\\s+(?:sector|category))?`;
  const beforeHoldings = new RegExp(`\\b${name}${category}\\s+\\b(?:holdings?|positions?|allocation)\\b`, "i");
  const afterHoldings = new RegExp(`\\b(?:holdings?|positions?|allocation)\\b.{0,60}\\b(?:in|from|within|under|for)\\s+(?:the\\s+)?${name}\\b`, "i");
  return beforeHoldings.test(question) || afterHoldings.test(question);
}

export function requestedHoldingsSector(question: string, availableSectors: string[]) {
  const value = question.toLowerCase();
  if (/\b(?:all|full|whole|entire)\b.{0,30}\b(?:portfolio|holdings?|positions?)\b/i.test(value)) return undefined;
  if (!/\b(?:holdings?|positions?|allocation)\b/i.test(value)) return undefined;

  const exclusive = /\b(?:only|just|filter)\b/i.test(value);
  const listRequest = /\b(?:show|list|display|view|give me|what are|which are)\b/i.test(value);
  if (!exclusive && !listRequest) return undefined;

  const normalizedQuestion = ` ${normalizedSector(question)} `;
  const mentionedSectors = availableSectors.filter((sector) => {
    const normalized = normalizedSector(sector);
    return normalized && normalizedQuestion.includes(` ${normalized} `);
  });
  if (mentionedSectors.length > 1) return undefined;

  const matches = [...new Set(availableSectors.filter((sector) => {
    const normalized = normalizedSector(sector);
    return normalized && sectorLinkedToHoldings(question, sector);
  }))];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 || !exclusive) return undefined;

  // Preserve an explicitly requested but currently empty category so the UI can show
  // an empty result instead of silently falling back to the complete portfolio.
  const categoryMatch = question.match(/\b(?:in|from|within|under|for)\s+(?:the\s+)?([a-z][a-z0-9 &/-]*?)\s+(?:sector|category)\b/i)
    ?? question.match(/\b([a-z][a-z0-9 &/-]*?)\s+(?:sector|category)\s+(?:holdings?|positions?)\b/i);
  const category = categoryMatch?.[1]?.replace(/\b(?:only|just|show|list|display|view|want|my|the|portfolio|holdings?|positions?)\b/gi, " ").replace(/\s+/g, " ").trim();
  return category || undefined;
}

export function filterHoldingsBySector(positions: AnalysisPosition[], sector?: string) {
  if (!sector) return positions;
  const target = normalizedSector(sector);
  return positions.filter((position) => normalizedSector(position.sector) === target);
}

export function scopeHoldingsBlocks(canvas: ResearchCanvasEvent, question: string) {
  const holdings = canvas.blocks
    .filter((block) => block.kind === "holdings-table" || block.kind === "allocation-view" || block.kind === "comparison-table")
    .flatMap((block) => block.evidence)
    .find((packet) => packet.kind === "portfolio-holdings" && Array.isArray(packet.data));
  if (!holdings || !Array.isArray(holdings.data)) return canvas;
  const sectors = unique((holdings.data as AnalysisPosition[]).map((position) => position.sector).filter(Boolean));
  const sectorFilter = requestedHoldingsSector(question, sectors);
  const normalizedQuestion = ` ${normalizedSector(question)} `;
  const comparisonSectors = /\b(compare|versus|vs)\b/i.test(question)
    ? sectors.filter((sector) => normalizedQuestion.includes(` ${normalizedSector(sector)} `))
    : [];
  if (!sectorFilter && comparisonSectors.length < 2) return canvas;
  return {
    ...canvas,
    blocks: canvas.blocks.map((block) =>
      block.kind === "holdings-table" || block.kind === "allocation-view"
        ? { ...block, ...(sectorFilter ? { sectorFilter } : {}) }
        : block.kind === "comparison-table" && comparisonSectors.length >= 2
          ? { ...block, comparisonSectors }
          : block,
    ),
  };
}

export function portfolioEvidenceBundle(context: PortfolioAnalysisContext): EvidencePacket[] {
  const summary: EvidencePacket = {
    id: "portfolio-summary-current",
    kind: "portfolio-summary",
    label: "Current portfolio summary",
    provider: "portfolio",
    asOf: context.asOf,
    capability: "portfolio-intelligence",
    confidence: "high",
    data: {
      startingCapital: context.portfolio.startingCapital,
      cashBalance: context.portfolio.cashBalance,
      nav: context.portfolio.nav,
      totalPnl: context.portfolio.totalPnl,
      unrealizedPnl: context.portfolio.unrealizedPnl,
      realizedPnl: context.portfolio.realizedPnl,
      positionCount: context.portfolio.positions.length,
      investedValue: context.portfolio.positions.reduce((sum, position) => sum + position.value, 0),
    },
  };
  const holdings: EvidencePacket = {
    id: "portfolio-holdings-current",
    kind: "portfolio-holdings",
    label: "Current portfolio holdings",
    provider: "portfolio",
    asOf: context.asOf,
    capability: "portfolio-intelligence",
    confidence: "high",
    data: context.portfolio.positions,
  };
  return [summary, holdings];
}

const evidenceFreshnessMs: Record<string, number> = {
  "market-depth": 5_000,
  "reality-market": 30_000,
  "crypto-market-structure": 60_000,
  "technical-analysis": 5 * 60_000,
  "cross-asset-analysis": 5 * 60_000,
  "external-research": 3 * 60_000,
  "bitget-research": 3 * 60_000,
  "reality-fundamentals": 15 * 60_000,
  "corporate-events": 15 * 60_000,
};

export function reusableEvidencePackets(canvas: ResearchCanvasState | null | undefined, context: PortfolioAnalysisContext, now = Date.now()) {
  if (!canvas) return [];
  return canvas.evidence.filter((packet) => {
    if (packet.provider === "portfolio" || packet.provider === "derived") return packet.asOf === context.asOf;
    const timestamp = new Date(packet.asOf).getTime();
    const ttl = evidenceFreshnessMs[packet.kind] ?? 2 * 60_000;
    return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= ttl;
  });
}

export function researchFailureKind(error: unknown) {
  if (!error || typeof error !== "object") return "unknown" as const;
  const value = error as { name?: unknown; message?: unknown };
  const name = typeof value.name === "string" ? value.name : "";
  const message = typeof value.message === "string" ? value.message : "";
  if (name === "AbortError" || /timed out|aborted/i.test(message)) return "timeout" as const;
  if (name === "SyntaxError") return "invalid-json" as const;
  if (name === "ZodError") return "validation" as const;
  if (/proposed-trade impact calculation requires/i.test(message)) return "missing-trade-impact-view" as const;
  if (/technical research with candles requires/i.test(message)) return "missing-technical-views" as const;
  if (/compatible evidence/i.test(message)) return "incompatible-evidence" as const;
  if (/did not return the required presentation function/i.test(message)) return "missing-tool" as const;
  if (/request failed \(\d+\)/i.test(message)) return "provider-http" as const;
  return "unknown" as const;
}

export function compactResearchValue(value: unknown, depth = 0, field = ""): unknown {
  if (depth > 6) return "[nested data omitted]";
  if (typeof value === "string") return value.length > 4_000 ? value.slice(0, 4_000) + "…" : value;
  if (Array.isArray(value)) {
    const observations = ["candles", "indicators", "series"].includes(field) ? value.slice(-365) : value.slice(0, 60);
    return observations.map((item) => compactResearchValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, item]) => [key, compactResearchValue(item, depth + 1, key)]));
  }
  return value;
}

type MessageLike = { role?: unknown; parts?: unknown };

export function latestUserQuestion(messages: MessageLike[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || !Array.isArray(message.parts)) continue;
    return message.parts.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    }).join(" ").trim();
  }
  return "";
}

function presentationPreviewValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[nested data omitted]";
  if (typeof value === "string") return value.length > 1_000 ? `${value.slice(0, 1_000)}…` : value;
  if (Array.isArray(value)) {
    if (value.length > 12) {
      return {
        count: value.length,
        first: value.slice(0, 2).map((item) => presentationPreviewValue(item, depth + 1)),
        last: value.slice(-2).map((item) => presentationPreviewValue(item, depth + 1)),
      };
    }
    return value.map((item) => presentationPreviewValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, item]) => [key, presentationPreviewValue(item, depth + 1)]));
  }
  return value;
}

export function availableChartWindows(timestamps: number[]) {
  const ordered = timestamps.filter(Number.isFinite).sort((left, right) => left - right);
  const coverageDays = ordered.length > 1 ? (ordered.at(-1)! - ordered[0]) / 86_400_000 : 0;
  return ([30, 90, 365] as const).filter((days) => coverageDays >= days);
}

export function presentationEvidenceIndex(evidence: EvidencePacket[]): PresentationEvidenceIndexItem[] {
  return evidence.slice(-12).map((packet) => {
    const { id, kind, label, provider, asOf, capability, confidence, limitations, data } = packet;
    let serialized: string;
    try {
      const preview = kind === "portfolio-holdings" && Array.isArray(data)
        ? { count: data.length, positions: data.slice(0, 12).map((value) => {
          const position = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return { token: position.token, sector: position.sector, weight: position.weight, value: position.value };
        }) }
        : presentationPreviewValue(data);
      serialized = JSON.stringify(preview);
    } catch {
      serialized = "[unserializable evidence]";
    }
    const compatibleViews = researchBlockKinds.filter((view) => {
      const accepted = compatibleEvidenceKinds[view];
      if (accepted !== "any" && !accepted.includes(kind)) return false;
      if (view === "price-chart" && !evidenceHasCandles(packet)) return false;
      if ((view === "holdings-table" || view === "allocation-view") && !Array.isArray(data)) return false;
      if (view === "risk-map" && !evidenceHasRiskContent(packet)) return false;
      return true;
    });
    return { id, kind, label, provider, asOf, capability, confidence, limitations, compatibleViews, dataPreview: serialized.slice(0, 1_200) };
  });
}

export function comparisonFactSheet(evidence: EvidencePacket[]) {
  const rows = new Map<string, {
    token: string;
    window?: number;
    returnInWindow?: number;
    dayChange?: number;
    annualizedVolatility?: number;
    maxDrawdown?: number;
    spreadBps?: number;
    bidNotional?: number;
    askNotional?: number;
    imbalance?: number;
    portfolioWeight?: number;
  }>();
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  for (const packet of evidence) {
    const data = evidenceRecord(packet.data);
    if (packet.kind === "technical-analysis") {
      const asset = evidenceRecord(data.asset);
      const token = typeof asset.token === "string" ? asset.token : undefined;
      if (!token) continue;
      rows.set(token, { ...rows.get(token), token, window: finite(data.window), returnInWindow: finite(data.change), dayChange: finite(asset.dayChange), annualizedVolatility: finite(data.annualizedVolatility), maxDrawdown: finite(data.maxDrawdown) });
    }
    if (packet.kind === "portfolio-position") {
      const position = evidenceRecord(data.position);
      const token = typeof position.token === "string" ? position.token : undefined;
      if (token) rows.set(token, { ...rows.get(token), token, portfolioWeight: finite(position.weight) });
    }
  }
  const hasComparedAssets = rows.size > 0;
  for (const packet of evidence) {
    if (packet.kind !== "portfolio-holdings" || !Array.isArray(packet.data)) continue;
    for (const item of packet.data) {
      const position = evidenceRecord(item);
      const token = typeof position.token === "string" ? position.token : undefined;
      if (token && (!hasComparedAssets || rows.has(token))) rows.set(token, { ...rows.get(token), token, portfolioWeight: finite(position.weight) });
    }
  }
  for (const packet of evidence) {
    if (packet.kind !== "market-depth") continue;
    const data = evidenceRecord(packet.data);
    const symbol = typeof data.symbol === "string" ? data.symbol : "";
    const row = [...rows.values()].find((item) => symbol.toUpperCase() === `${item.token.toUpperCase()}USDT`);
    if (row) {
      row.spreadBps = finite(data.spreadBps);
      row.bidNotional = finite(data.bidNotional);
      row.askNotional = finite(data.askNotional);
      row.imbalance = finite(data.imbalance);
    }
  }
  const values = [...rows.values()];
  const rank = (field: "returnInWindow" | "dayChange" | "annualizedVolatility" | "maxDrawdown" | "spreadBps" | "portfolioWeight", direction: "higher" | "lower") => {
    const observed = values.filter((item) => item[field] !== undefined);
    if (observed.length < 2) return undefined;
    return observed.sort((left, right) => direction === "higher" ? right[field]! - left[field]! : left[field]! - right[field]!)[0]?.token;
  };
  const comparableWindow = values.length >= 2 && values.every((item) => item.window === values[0]?.window);
  return {
    rows: values,
    rankings: {
      higherWindowReturn: comparableWindow ? rank("returnInWindow", "higher") : undefined,
      higherDayChange: rank("dayChange", "higher"),
      higherAnnualizedVolatility: rank("annualizedVolatility", "higher"),
      deeperHistoricalDrawdown: rank("maxDrawdown", "lower"),
      widerSpread: rank("spreadBps", "higher"),
      higherPortfolioWeight: rank("portfolioWeight", "higher"),
    },
  };
}

export function comparisonVerifiedSummary(facts: ReturnType<typeof comparisonFactSheet>) {
  const percent = (value: number, signed = false) => `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  const rows = facts.rows.slice(0, 3).map((row) => [
    `${row.token}:`,
    row.returnInWindow === undefined ? "" : `${percent(row.returnInWindow, true)} window return`,
    row.annualizedVolatility === undefined ? "" : `${percent(row.annualizedVolatility)} annualized volatility`,
    row.maxDrawdown === undefined ? "" : `${percent(row.maxDrawdown)} max drawdown`,
    row.spreadBps === undefined ? "" : `${row.spreadBps.toFixed(1)} bps spread`,
    row.portfolioWeight === undefined ? "" : `${row.portfolioWeight.toFixed(1)}% portfolio weight`,
  ].filter(Boolean).join(" "));
  return `Measured comparison: ${rows.join("; ")}${facts.rows.length > rows.length ? "; see the full answer for other assets" : ""}.`;
}

export function selectResearchNarrative(primary: string, recovery: string, summary: string, usedRecovery: boolean) {
  const primaryText = primary.trim();
  const narrative = usedRecovery
    ? recovery.trim() || summary.trim()
    : primaryText || summary.trim();
  return narrative.replace(/\n{3,}/g, "\n\n").trim();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function materializePresentation(plan: PresentationPlan, evidenceStore: Map<string, EvidencePacket>): ResearchCanvasEvent {
  const blocks = plan.blocks.flatMap((block) => {
    const requestedIds = unique(block.evidenceIds).filter((id) => evidenceStore.has(id));
    const acceptedKinds = compatibleEvidenceKinds[block.kind];
    const evidenceIds = requestedIds.filter((id) => {
      const packet = evidenceStore.get(id);
      if (!packet) return false;
      if (acceptedKinds !== "any" && !acceptedKinds.includes(packet.kind)) return false;
      if (block.kind === "price-chart" && !evidenceHasCandles(packet)) return false;
      if ((block.kind === "holdings-table" || block.kind === "allocation-view") && !Array.isArray(packet.data)) return false;
      if (block.kind === "risk-map" && !evidenceHasRiskContent(packet)) return false;
      return true;
    });
    const evidence = evidenceIds.map((id) => evidenceStore.get(id)).filter((item): item is EvidencePacket => Boolean(item));
    if (!evidence.length) return [];
    return [{
      ...block,
      evidenceIds,
      evidence,
    } satisfies ResearchBlock];
  });

  const evidence = unique(blocks.flatMap((block) => block.evidenceIds))
    .map((id) => evidenceStore.get(id))
    .filter((item): item is EvidencePacket => Boolean(item));

  return {
    operation: plan.operation,
    status: "ready",
    title: plan.title,
    summary: plan.summary,
    subject: plan.subject,
    confidence: plan.confidence,
    blocks,
    evidence,
    followups: unique(plan.followups).slice(0, 3),
    warnings: blocks.length === plan.blocks.length ? [] : ["One or more requested views were omitted because their evidence was unavailable or incompatible."],
  };
}

export function presentationNeedsFallback(plan: PresentationPlan, canvas: ResearchCanvasEvent, evidenceStore: Map<string, EvidencePacket>) {
  if (canvas.blocks.length !== plan.blocks.length) return true;
  const requestedKnownIds = unique(plan.blocks.flatMap((block) => block.evidenceIds)).filter((id) => evidenceStore.has(id));
  const renderedIds = new Set(canvas.evidence.map((item) => item.id));
  return requestedKnownIds.some((id) => !renderedIds.has(id));
}

export function enrichResearchCanvas(canvas: ResearchCanvasEvent, evidence: EvidencePacket[]) {
  if (canvas.status !== "ready" || canvas.blocks.length >= 6 || !evidence.length) return canvas;
  const store = new Map(evidence.map((packet) => [packet.id, packet]));
  const candidates: PresentationBlockPlan[] = [];
  const add = (kind: ResearchBlockKind, title: string, packets: EvidencePacket[], span: ResearchBlockSpan = "full") => {
    if (!packets.length || candidates.some((block) => block.kind === kind)) return;
    candidates.push({ id: `evidence-${kind}`, kind, title, span, evidenceIds: unique(packets.map((packet) => packet.id)).slice(0, 8) });
  };
  const packets = (...kinds: string[]) => evidence.filter((packet) => kinds.includes(packet.kind));
  const position = packets("portfolio-position");
  const market = packets("reality-market");
  const technical = packets("technical-analysis");
  const stress = packets("stress-scenario");

  add("position-snapshot", "Position and market context", position.length ? position : market, "half");
  add("scenario-lab", "Interactive stress scenario", stress);
  add("price-chart", "Interactive price history", [...technical, ...market].filter(evidenceHasCandles));
  add("metric-strip", "Key evidence metrics", packets("stress-scenario", "portfolio-summary", "portfolio-risk", "technical-analysis", "reality-market"), "half");
  add("risk-map", "Risk, sector, and factor exposure", packets("portfolio-risk"));
  add("allocation-view", "Portfolio allocation context", packets("portfolio-holdings"));
  add("comparison-table", "Fundamentals and valuation", packets("reality-fundamentals"));
  add("event-timeline", "Corporate event timeline", packets("corporate-events"));
  add("news-feed", "Current external evidence", packets("external-research", "bitget-research"));
  add("market-depth", "Live market depth", packets("market-depth"), "half");
  add("sentiment-gauge", "Crypto positioning", packets("crypto-market-structure"), "half");
  add("correlation-chart", "Cross-asset relationship", packets("cross-asset-analysis"));

  const enriched = materializePresentation({
    operation: canvas.operation,
    title: canvas.title,
    summary: canvas.summary,
    subject: canvas.subject,
    confidence: canvas.confidence ?? "low",
    blocks: candidates,
    followups: canvas.followups,
  }, store);
  const existingKinds = new Set(canvas.blocks.map((block) => block.kind));
  const additions = enriched.blocks.filter((block) => !existingKinds.has(block.kind)).slice(0, 6 - canvas.blocks.length);
  if (!additions.length) return canvas;
  const combinedEvidence = new Map(canvas.evidence.map((packet) => [packet.id, packet]));
  for (const block of additions) for (const packet of block.evidence) combinedEvidence.set(packet.id, packet);
  return { ...canvas, blocks: [...canvas.blocks, ...additions], evidence: [...combinedEvidence.values()] };
}

function decisionSynthesis(evidence: EvidencePacket[], question: string): ThesisSynthesis {
  const positionPacket = evidence.find((packet) => packet.kind === "portfolio-position");
  const position = evidenceRecord(evidenceRecord(positionPacket?.data).position);
  const technical = evidenceRecord(evidence.find((packet) => packet.kind === "technical-analysis")?.data);
  const token = typeof position.token === "string" ? position.token : "This position";
  const weight = typeof position.weight === "number" ? position.weight : undefined;
  const trend = typeof technical.trend === "string" ? technical.trend : undefined;
  const change = typeof technical.change === "number" ? technical.change : undefined;
  const volatility = typeof technical.annualizedVolatility === "number" ? technical.annualizedVolatility : undefined;
  const drawdown = typeof technical.maxDrawdown === "number" ? technical.maxDrawdown : undefined;
  const support = typeof technical.support20 === "number" ? technical.support20 : undefined;
  const action = /\b(?:sell|exit)\b/i.test(question) ? "sell"
    : /\b(?:trim|reduce)\b/i.test(question) ? "trim"
      : /\b(?:buy|add|increase)\b/i.test(question) ? "add"
        : "hold";
  const headline = action === "sell"
    ? `The verified evidence does not support an automatic full exit from ${token}; a sale is more defensible if the thesis or portfolio role has changed.`
    : action === "trim"
      ? `A partial trim in ${token} is most defensible when concentration or downside tolerance has changed, not from price movement alone.`
      : action === "add"
        ? `Adding to ${token} is conditional on the current thesis remaining intact and the resulting portfolio weight staying inside the risk budget.`
        : `Holding ${token} remains reasonable while its thesis, trend, and portfolio role remain intact.`;
  const supports = [
    weight === undefined ? "" : `${token} is ${weight.toFixed(1)}% of portfolio NAV.`,
    trend ? `The observed technical trend is ${trend}.` : "",
    change === undefined ? "" : `The measured price window returned ${(change * 100).toFixed(1)}%.`,
  ].filter(Boolean);
  const risks = [
    weight !== undefined && weight >= 20 ? `The ${weight.toFixed(1)}% weight creates meaningful concentration risk.` : "Market-wide drawdowns can still affect the position even when company-specific evidence is stable.",
    volatility === undefined ? "" : `Observed annualized volatility is ${(volatility * 100).toFixed(1)}%.`,
    drawdown === undefined ? "" : `The measured window includes a ${(drawdown * 100).toFixed(1)}% maximum drawdown.`,
  ].filter(Boolean);
  const invalidation = [
    support === undefined ? "A sustained break in the evidence supporting the current thesis." : `A decisive close below the observed ${currency(support)} support area.`,
    "A change in portfolio role, time horizon, or risk budget.",
    "Material deterioration in fundamentals or a new adverse catalyst.",
  ];
  return { headline, supports, risks, invalidation };
}

export function ensureResearchCoverage(
  canvas: ResearchCanvasEvent,
  evidence: EvidencePacket[],
  route: Pick<ResearchPlan, "questionType" | "depth"> & { answerShape: ResearchAnswerShape; question?: string },
) {
  if (canvas.status !== "ready" || !evidence.length) return canvas;
  const store = new Map(evidence.map((packet) => [packet.id, packet]));
  const existingKinds = new Set(canvas.blocks.map((block) => block.kind));
  const additions: PresentationBlockPlan[] = [];
  const packets = (...kinds: string[]) => evidence.filter((packet) => kinds.includes(packet.kind));
  const requireBlock = (kind: ResearchBlockKind, title: string, matching: EvidencePacket[], span: ResearchBlockSpan = "full") => {
    if (existingKinds.has(kind) || additions.some((block) => block.kind === kind) || !matching.length) return;
    additions.push({ id: `coverage-${kind}`, kind, title, span, evidenceIds: unique(matching.map((packet) => packet.id)).slice(0, 8) });
  };

  if (route.answerShape === "collection") {
    requireBlock("holdings-table", "Portfolio holdings", packets("portfolio-holdings"));
    requireBlock("allocation-view", "Portfolio allocation", packets("portfolio-holdings"));
    requireBlock("metric-strip", "Portfolio overview", packets("portfolio-summary"), "half");
  } else if (route.answerShape === "technical") {
    requireBlock("price-chart", "Price and trend", packets("technical-analysis", "reality-market").filter(evidenceHasCandles));
    requireBlock("metric-strip", "Technical metrics", packets("technical-analysis", "reality-market"), "half");
  } else if (route.answerShape === "scenario") {
    requireBlock("scenario-lab", "Interactive scenario", packets("stress-scenario"));
    requireBlock("metric-strip", "Scenario impact", packets("stress-scenario", "portfolio-summary"), "half");
    requireBlock("price-chart", "Price and technical context", packets("technical-analysis", "reality-market").filter(evidenceHasCandles));
  } else if (route.answerShape === "decision") {
    if (!existingKinds.has("thesis-board")) {
      const decisionEvidence = packets("portfolio-position", "portfolio-summary", "portfolio-risk", "reality-market", "reality-fundamentals", "technical-analysis", "corporate-events");
      if (decisionEvidence.length) additions.push({ id: "coverage-thesis-board", kind: "thesis-board", title: "Decision frame", span: "full", evidenceIds: unique(decisionEvidence.map((packet) => packet.id)).slice(0, 8), synthesis: decisionSynthesis(decisionEvidence, route.question ?? "") });
    }
    requireBlock("position-snapshot", "Position and portfolio fit", packets("portfolio-position", "reality-market"), "half");
    requireBlock("price-chart", "Price and trend context", packets("technical-analysis", "reality-market").filter(evidenceHasCandles));
    requireBlock("metric-strip", "Decision-relevant metrics", packets("portfolio-summary", "portfolio-risk", "technical-analysis", "reality-market"), "half");
    requireBlock("event-timeline", "Upcoming and recent events", packets("corporate-events"));
  } else if (route.answerShape === "comparison") {
    requireBlock("comparison-table", "Evidence comparison", packets("portfolio-position", "portfolio-holdings", "reality-market", "reality-fundamentals", "technical-analysis"));
  } else if (route.answerShape === "timeline") {
    requireBlock("event-timeline", "Dated events", packets("corporate-events"));
    requireBlock("news-feed", "Current news and evidence", packets("external-research", "bitget-research"));
  } else if (route.answerShape === "snapshot") {
    requireBlock("position-snapshot", "Position snapshot", packets("portfolio-position", "reality-market"), "half");
    requireBlock("metric-strip", "Key metrics", packets("portfolio-summary", "reality-market", "technical-analysis"), "half");
  } else if (route.questionType === "portfolio") {
    requireBlock("metric-strip", "Portfolio overview", packets("portfolio-summary"), "half");
    requireBlock("allocation-view", "Portfolio allocation", packets("portfolio-holdings"));
    requireBlock("risk-map", "Risk, sector, and factor exposure", packets("portfolio-risk"));
    if (route.depth === "comprehensive") requireBlock("holdings-table", "Portfolio holdings", packets("portfolio-holdings"));
  }

  if (!additions.length) return canvas;
  const materialized = materializePresentation({
    operation: canvas.operation,
    title: canvas.title,
    summary: canvas.summary,
    subject: canvas.subject,
    confidence: canvas.confidence ?? "low",
    blocks: additions,
    followups: [],
  }, store);
  const room = Math.max(0, 6 - canvas.blocks.length);
  const blocks = materialized.blocks.slice(0, room);
  const combinedEvidence = new Map(canvas.evidence.map((packet) => [packet.id, packet]));
  for (const block of blocks) for (const packet of block.evidence) combinedEvidence.set(packet.id, packet);
  return { ...canvas, blocks: [...canvas.blocks, ...blocks], evidence: [...combinedEvidence.values()] };
}

export function withResearchWarnings(canvas: ResearchCanvasEvent, failedSources: string[], options: { actualFailuresOnly?: boolean } = {}) {
  const failures = unique(failedSources.filter((label) => Boolean(label) && (!options.actualFailuresOnly || (!/\bintelligence$/i.test(label) && !/^Running stress scenario$/i.test(label)))));
  if (!failures.length) return canvas;
  return {
    ...canvas,
    warnings: unique([...canvas.warnings, `Some requested evidence was unavailable: ${failures.join(", ")}.`]),
  };
}

export function recordResearchSourceState(failedSources: Set<string>, label: string, available: boolean) {
  if (available) failedSources.delete(label);
  else failedSources.add(label);
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function applyDeterministicCanvasSummary(canvas: ResearchCanvasEvent) {
  const scenario = canvas.blocks
    .find((block) => block.kind === "scenario-lab")
    ?.evidence.find((packet) => packet.kind === "stress-scenario");
  if (!scenario) return canvas;
  const data = evidenceRecord(scenario.data);
  const shock = typeof data.shock === "number" ? data.shock : undefined;
  const baseNav = typeof data.baseNav === "number" ? data.baseNav : undefined;
  const exposure = typeof data.exposure === "number" ? data.exposure : undefined;
  const impact = typeof data.impact === "number" ? data.impact : undefined;
  const stressedNav = typeof data.stressedNav === "number" ? data.stressedNav : undefined;
  if ([shock, baseNav, exposure, impact, stressedNav].some((value) => value === undefined || !Number.isFinite(value))) return canvas;
  const label = typeof data.label === "string" && data.label ? data.label : "Portfolio";
  const scope = typeof data.scope === "string" && data.scope !== "portfolio" ? ` ${data.scope}` : "";
  return {
    ...canvas,
    summary: `${label}${scope} exposure is ${currency(exposure!)}. A ${(shock! * 100).toFixed(0)}% shock produces a ${currency(impact!)} modeled impact and moves portfolio NAV from ${currency(baseNav!)} to ${currency(stressedNav!)}. This is a linear sensitivity estimate; liquidity and correlation effects are not modeled.`,
  };
}

export function deterministicScenarioNarrative(canvas: ResearchCanvasEvent) {
  const scenario = canvas.blocks.flatMap((block) => block.evidence).find((packet) => packet.kind === "stress-scenario");
  if (!scenario) return canvas.summary;
  const data = evidenceRecord(scenario.data);
  const shock = typeof data.shock === "number" ? data.shock : undefined;
  const baseNav = typeof data.baseNav === "number" ? data.baseNav : undefined;
  const exposure = typeof data.exposure === "number" ? data.exposure : undefined;
  const impact = typeof data.impact === "number" ? data.impact : undefined;
  const stressedNav = typeof data.stressedNav === "number" ? data.stressedNav : undefined;
  if ([shock, baseNav, exposure, impact, stressedNav].some((value) => value === undefined || !Number.isFinite(value))) return canvas.summary;
  const label = typeof data.label === "string" && data.label ? data.label : "Portfolio";
  const scope = typeof data.scope === "string" ? data.scope : "portfolio";
  const exposureShare = baseNav! > 0 ? exposure! / baseNav! : 0;
  const lossShare = baseNav! > 0 ? impact! / baseNav! : 0;
  const riskPacket = canvas.blocks.flatMap((block) => block.evidence).find((packet) => packet.kind === "portfolio-risk");
  const risk = evidenceRecord(evidenceRecord(riskPacket?.data).riskExposure);
  const volatility = typeof risk.volatility === "number" ? risk.volatility : undefined;
  const beta = typeof risk.beta === "number" ? risk.beta : undefined;
  const drawdown = typeof risk.maxDrawdown === "number" ? risk.maxDrawdown : undefined;
  const riskFacts = [
    volatility === undefined ? "" : `${(volatility * 100).toFixed(1)}% annualized volatility`,
    beta === undefined ? "" : `${beta.toFixed(2)} beta`,
    drawdown === undefined ? "" : `${(drawdown * 100).toFixed(1)}% historical max drawdown`,
  ].filter(Boolean);
  const direction = impact! < 0 ? "loss" : "gain";
  const paragraphs = [
    `If ${label} moved ${(shock! * 100).toFixed(0)}%, the model estimates a ${currency(Math.abs(impact!))} ${direction}. Portfolio NAV would move from ${currency(baseNav!)} to ${currency(stressedNav!)}.`,
    `${label} represents ${currency(exposure!)} of ${scope} exposure (${(exposureShare * 100).toFixed(1)}% of NAV), so this isolated shock changes the portfolio by ${Math.abs(lossShare * 100).toFixed(1)}%. ${exposureShare >= 0.25 ? "That concentration is material, making position size the clearest controllable risk." : "The rest of the portfolio absorbs most of the move because the exposure is bounded."}`,
    ...(riskFacts.length ? [`For context, the portfolio currently shows ${riskFacts.join(", ")}; those are historical measures rather than forecasts.`] : []),
    "You can adjust the slider to explore other outcomes. It is a linear estimate, so it does not include changing liquidity, price gaps, contagion, or correlation shifts.",
  ];
  return paragraphs.join("\n\n");
}

export function deterministicDecisionNarrative(canvas: ResearchCanvasEvent, question: string) {
  const position = evidenceRecord(evidenceRecord(canvas.evidence.find((packet) => packet.kind === "portfolio-position")?.data).position);
  const technical = evidenceRecord(canvas.evidence.find((packet) => packet.kind === "technical-analysis")?.data);
  const token = typeof position.token === "string" ? position.token : canvas.subject?.label ?? "the position";
  const weight = typeof position.weight === "number" ? position.weight : undefined;
  const trend = typeof technical.trend === "string" ? technical.trend : undefined;
  const change = typeof technical.change === "number" ? technical.change : undefined;
  const volatility = typeof technical.annualizedVolatility === "number" ? technical.annualizedVolatility : undefined;
  const drawdown = typeof technical.maxDrawdown === "number" ? technical.maxDrawdown : undefined;
  const rsi = typeof technical.rsi14 === "number" ? technical.rsi14 : undefined;
  const support = typeof technical.support20 === "number" ? technical.support20 : undefined;
  const action = /\b(?:sell|exit)\b/i.test(question) ? "sell"
    : /\b(?:trim|reduce)\b/i.test(question) ? "trim"
      : /\b(?:buy|add|increase)\b/i.test(question) ? "add"
        : "hold";
  const opening = action === "sell"
    ? `I wouldn’t treat the current evidence as a reason to sell ${token} outright.`
    : action === "trim"
      ? `A partial trim in ${token} can make sense if your goal is to reduce concentration, but the current evidence does not require one.`
      : action === "add"
        ? `I’d only add to ${token} if its current thesis still fits your risk budget after the larger position size.`
        : `Holding ${token} is reasonable while its thesis and portfolio role remain intact.`;
  const facts = [
    weight === undefined ? "" : `it is ${weight.toFixed(1)}% of portfolio NAV`,
    trend ? `the observed trend is ${trend}` : "",
    change === undefined ? "" : `the measured window returned ${(change * 100).toFixed(1)}%`,
    rsi === undefined ? "" : `RSI is ${rsi.toFixed(1)}`,
  ].filter(Boolean);
  const evidence = facts.length ? `Right now, ${facts.join(", ")}.` : "The available evidence is too limited for a high-conviction portfolio change.";
  const risks = [
    volatility === undefined ? "" : `${(volatility * 100).toFixed(1)}% observed annualized volatility`,
    drawdown === undefined ? "" : `a ${(drawdown * 100).toFixed(1)}% measured maximum drawdown`,
    weight !== undefined && weight >= 20 ? `${weight.toFixed(1)}% concentration` : "",
  ].filter(Boolean);
  const risk = risks.length ? `The main reasons to stay cautious are ${risks.join(" and ")}.` : "Market-wide drawdowns remain the main unresolved risk.";
  const changeView = support === undefined
    ? "I’d reassess if the underlying thesis deteriorates or the position no longer fits your time horizon and risk budget."
    : `I’d reassess if price closes decisively below the observed ${currency(support)} support area, the fundamentals deteriorate, or the position no longer fits your time horizon and risk budget.`;
  return [opening, `${evidence} ${risk}`, changeView].join("\n\n");
}

export function deterministicScenarioCanvas(question: string, context: PortfolioAnalysisContext): ResearchCanvasEvent {
  const input = inferStressScenarioInput(question, context.portfolio.positions);
  const scenario = calculateStressScenario({ ...input, baseNav: context.portfolio.nav, positions: context.portfolio.positions });
  const stress: EvidencePacket = {
    id: "stress-scenario-current",
    kind: "stress-scenario",
    label: `${scenario.label} stress scenario`,
    provider: "derived",
    asOf: context.asOf,
    data: scenario,
    capability: "scenario-intelligence",
    confidence: "high",
    limitations: ["This is a linear sensitivity estimate; liquidity, gaps, contagion, and correlation shifts are not modeled."],
  };
  const portfolio = portfolioEvidenceBundle(context);
  const summary = portfolio.find((packet) => packet.kind === "portfolio-summary")!;
  const holdings = portfolio.find((packet) => packet.kind === "portfolio-holdings")!;
  const position: EvidencePacket | undefined = scenario.position ? {
    id: "scenario-position-current",
    kind: "portfolio-position",
    label: `${scenario.position.token} portfolio position`,
    provider: "portfolio",
    asOf: context.asOf,
    data: { position: scenario.position, market: context.assets.find((asset) => asset.symbol === scenario.position?.symbol) },
    capability: "portfolio-intelligence",
    confidence: "high",
  } : undefined;
  const evidence = [stress, summary, holdings, ...(position ? [position] : [])];
  const blocks: PresentationBlockPlan[] = [
    { id: "scenario", kind: "scenario-lab", title: `${scenario.label} stress test`, span: "full", evidenceIds: [stress.id] },
    ...(position ? [{ id: "position", kind: "position-snapshot" as const, title: `${scenario.label} exposure`, span: "half" as const, evidenceIds: [position.id] }] : []),
    { id: "impact", kind: "metric-strip", title: "Scenario impact", span: "half", evidenceIds: [stress.id, summary.id] },
    { id: "allocation", kind: "allocation-view", title: "Portfolio context", span: "full", evidenceIds: [holdings.id] },
  ];
  const canvas = materializePresentation({
    operation: "replace",
    title: `${scenario.label} stress test`,
    summary: "Scenario calculated from the supplied portfolio ledger.",
    subject: {
      label: scenario.label,
      token: scenario.scope === "position" ? scenario.label : undefined,
      symbol: scenario.position?.symbol,
      scope: scenario.scope === "position" ? "position" : "portfolio",
    },
    confidence: "high",
    blocks,
    followups: [],
  }, new Map(evidence.map((packet) => [packet.id, packet])));
  return applyDeterministicCanvasSummary(canvas);
}

function narrativeEvidenceItems(value: unknown, depth = 0): Array<{ title: string; date?: string; source?: string }> {
  if (depth > 6) return [];
  if (Array.isArray(value)) return value.flatMap((item) => narrativeEvidenceItems(item, depth + 1)).slice(0, 12);
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const title = [item.title, item.headline, item.event, item.name, item.label].find((entry): entry is string => typeof entry === "string" && entry.trim().length > 2);
  const current = title ? [{
    title: title.trim(),
    date: [item.date, item.published_at, item.publishedAt, item.time].find((entry): entry is string => typeof entry === "string"),
    source: [item.source, item.publisher, item.provider].find((entry): entry is string => typeof entry === "string"),
  }] : [];
  return [...current, ...Object.values(item).flatMap((entry) => narrativeEvidenceItems(entry, depth + 1))].slice(0, 12);
}

export function deterministicEvidenceNarrative(canvas: ResearchCanvasEvent) {
  const evidence = unique(canvas.blocks.flatMap((block) => block.evidence));
  const paragraphs: string[] = [canvas.summary.trim()].filter(Boolean);
  const crossAsset = evidence.find((packet) => packet.kind === "cross-asset-analysis");
  const crypto = evidence.find((packet) => packet.kind === "crypto-market-structure");
  const technical = evidence.find((packet) => packet.kind === "technical-analysis");
  const riskPacket = evidence.find((packet) => packet.kind === "portfolio-risk");
  const eventPackets = evidence.filter((packet) => packet.kind === "corporate-events");
  const newsPackets = evidence.filter((packet) => ["external-research", "bitget-research"].includes(packet.kind));

  if (crossAsset) {
    const data = evidenceRecord(crossAsset.data);
    const correlation = typeof data.returnCorrelation === "number" ? data.returnCorrelation : undefined;
    const observations = typeof data.observations === "number" ? data.observations : undefined;
    const strength = correlation === undefined ? "unavailable" : Math.abs(correlation) >= 0.65 ? "strong" : Math.abs(correlation) >= 0.35 ? "moderate" : "weak";
    paragraphs.push(`${String(data.primaryLabel ?? "The position")} and ${String(data.benchmarkLabel ?? "the benchmark")} show ${strength}${correlation === undefined ? "" : ` return correlation (${correlation.toFixed(2)})`}${observations === undefined ? "" : ` across ${observations} aligned daily observations`}. This is co-movement evidence, not proof that one market causes the other.`);
  }
  if (crypto) {
    const data = evidenceRecord(crypto.data);
    const funding = typeof data.fundingRate === "number" ? data.fundingRate : undefined;
    const longShort = typeof data.longShortRatio === "number" ? data.longShortRatio : undefined;
    const move = typeof data.change24h === "number" ? data.change24h : undefined;
    const facts = [
      move === undefined ? "" : `${(move * 100).toFixed(2)}% 24-hour move`,
      funding === undefined ? "" : `${(funding * 100).toFixed(3)}% funding`,
      longShort === undefined ? "" : `${longShort.toFixed(2)} long/short ratio`,
    ].filter(Boolean);
    if (facts.length) paragraphs.push(`${String(data.symbol ?? "The benchmark")} currently shows ${facts.join(", ")}. Positive funding or crowded longs can amplify risk-on sentiment, but can also increase reversal risk.`);
  }
  if (technical) {
    const data = evidenceRecord(technical.data);
    const change = typeof data.change === "number" ? data.change : undefined;
    const volatility = typeof data.annualizedVolatility === "number" ? data.annualizedVolatility : undefined;
    const drawdown = typeof data.maxDrawdown === "number" ? data.maxDrawdown : undefined;
    const rsi = typeof data.rsi14 === "number" ? data.rsi14 : undefined;
    const facts = [
      change === undefined ? "" : `${(change * 100).toFixed(1)}% window return`,
      volatility === undefined ? "" : `${(volatility * 100).toFixed(1)}% annualized volatility`,
      drawdown === undefined ? "" : `${(drawdown * 100).toFixed(1)}% max drawdown`,
      rsi === undefined ? "" : `${rsi.toFixed(1)} RSI`,
    ].filter(Boolean);
    if (facts.length) paragraphs.push(`The observed price series shows ${facts.join(", ")}. These indicators describe recent behavior rather than forecasting the next move.`);
  }
  if (riskPacket) {
    const risk = evidenceRecord(evidenceRecord(riskPacket.data).riskExposure);
    const volatility = typeof risk.volatility === "number" ? risk.volatility : undefined;
    const beta = typeof risk.beta === "number" ? risk.beta : undefined;
    const drawdown = typeof risk.maxDrawdown === "number" ? risk.maxDrawdown : undefined;
    const facts = [
      volatility === undefined ? "" : `${(volatility * 100).toFixed(1)}% portfolio volatility`,
      beta === undefined ? "" : `${beta.toFixed(2)} beta`,
      drawdown === undefined ? "" : `${(drawdown * 100).toFixed(1)}% max drawdown`,
    ].filter(Boolean);
    if (facts.length) paragraphs.push(`At portfolio level, the available risk measures are ${facts.join(", ")}. Position-level evidence matters most when read alongside concentration and diversification.`);
  }
  const events = unique(eventPackets.flatMap((packet) => narrativeEvidenceItems(packet.data)).map((item) => `${item.date ? `${item.date}: ` : ""}${item.title}`));
  if (events.length) paragraphs.push(`The verified calendar includes ${events.slice(0, 4).join("; ")}.`);
  const news = unique(newsPackets.flatMap((packet) => narrativeEvidenceItems(packet.data)).map((item) => `${item.title}${item.source ? ` (${item.source})` : ""}`));
  if (news.length) paragraphs.push(`Current coverage includes ${news.slice(0, 4).join("; ")}. Headlines are potential catalysts, not independently verified financial outcomes.`);
  const limitations = unique(evidence.flatMap((packet) => packet.limitations ?? []));
  if (limitations.length) paragraphs.push(`Keep in mind: ${limitations.join(" ")}`);
  return unique(paragraphs).join("\n\n");
}

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function evidenceIdentity(packet: EvidencePacket) {
  const data = evidenceRecord(packet.data);
  const position = evidenceRecord(data.position);
  const market = evidenceRecord(data.market);
  const asset = evidenceRecord(data.asset);
  const token = [data.token, position.token, market.token, asset.token]
    .find((value): value is string => typeof value === "string" && value.length > 0)
    ?? packet.label.match(/\br[A-Z0-9.-]+\b/i)?.[0];
  const symbol = [data.symbol, position.symbol, market.symbol, asset.symbol]
    .find((value): value is string => typeof value === "string" && value.length > 0);
  return { token, symbol };
}

function evidenceHasCandles(packet: EvidencePacket) {
  return Array.isArray(evidenceRecord(packet.data).candles) && (evidenceRecord(packet.data).candles as unknown[]).length > 1;
}

function evidenceHasRiskContent(packet: EvidencePacket) {
  const data = evidenceRecord(packet.data);
  const risk = evidenceRecord(data.riskExposure);
  const analytics = evidenceRecord(data.analytics);
  return ["volatility", "beta", "maxDrawdown", "diversificationRatio"].some((key) => typeof risk[key] === "number" && Number.isFinite(risk[key] as number))
    || (Array.isArray(analytics.sectorWeights) && analytics.sectorWeights.length > 0)
    || (Array.isArray(analytics.factorScores) && analytics.factorScores.length > 0);
}

function preservedEvidenceSummary(evidence: EvidencePacket[], tokens: string[]) {
  const facts: string[] = [];
  const positionPacket = evidence.find((packet) => packet.kind === "portfolio-position");
  if (positionPacket) {
    const position = evidenceRecord(evidenceRecord(positionPacket.data).position);
    const value = typeof position.value === "number" ? position.value : undefined;
    const weight = typeof position.weight === "number" ? position.weight : undefined;
    if (value !== undefined || weight !== undefined) {
      facts.push(`the portfolio position is ${value === undefined ? "value unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)}${weight === undefined ? "" : ` at ${weight.toFixed(1)}% weight`}`);
    }
  }
  const marketPacket = evidence.find((packet) => packet.kind === "reality-market");
  if (marketPacket) {
    const market = evidenceRecord(marketPacket.data);
    const price = typeof market.price === "number" ? market.price : undefined;
    const move = typeof market.dayChange === "number" ? market.dayChange : undefined;
    if (price !== undefined || move !== undefined) {
      facts.push(`the current mark is ${price === undefined ? "unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(price)}${move === undefined ? "" : ` (${(move * 100).toFixed(1)}% today)`}`);
    }
  }
  const technicalPacket = evidence.find((packet) => packet.kind === "technical-analysis");
  if (technicalPacket) {
    const technical = evidenceRecord(technicalPacket.data);
    const window = typeof technical.window === "number" ? technical.window : undefined;
    const change = typeof technical.change === "number" ? technical.change : undefined;
    const volatility = typeof technical.annualizedVolatility === "number" ? technical.annualizedVolatility : undefined;
    const drawdown = typeof technical.maxDrawdown === "number" ? technical.maxDrawdown : undefined;
    const parts = [
      change === undefined ? undefined : `${(change * 100).toFixed(1)}% return`,
      volatility === undefined ? undefined : `${(volatility * 100).toFixed(1)}% annualized volatility`,
      drawdown === undefined ? undefined : `${(drawdown * 100).toFixed(1)}% max drawdown`,
    ].filter((part): part is string => Boolean(part));
    if (parts.length) facts.push(`${window ?? "available"}-session technicals show ${parts.join(", ")}`);
  }
  const label = tokens.length ? tokens.join(" and ") : "The requested research";
  return facts.length
    ? `Verified ${label} evidence: ${facts.join("; ")}.`
    : `Research completed with ${evidence.length} cited evidence source${evidence.length === 1 ? "" : "s"} from ${unique(evidence.map((packet) => packet.provider)).join(", ") || "the available providers"}.`;
}

export function preserveEvidenceCanvas(_question: string, evidence: EvidencePacket[]): ResearchCanvasEvent {
  const store = new Map(evidence.map((packet) => [packet.id, packet]));
  const identities = evidence.map(evidenceIdentity);
  const tokens = unique(identities.map((identity) => identity.token).filter((token): token is string => Boolean(token)));
  const blocks: PresentationBlockPlan[] = [];
  const addBlock = (kind: ResearchBlockKind, title: string, packets: EvidencePacket[], span: ResearchBlockSpan = "full") => {
    const evidenceIds = unique(packets.map((packet) => packet.id)).slice(0, 8);
    if (!evidenceIds.length || blocks.some((block) => block.kind === kind)) return;
    blocks.push({ id: `preserved-${kind}`, kind, title, span, evidenceIds });
  };

  if (tokens.length > 1) {
    addBlock("comparison-table", `${tokens.join(" vs ")} evidence`, evidence.filter((packet) => ["portfolio-position", "reality-market", "technical-analysis", "reality-fundamentals"].includes(packet.kind)));
  } else {
    const position = evidence.filter((packet) => packet.kind === "portfolio-position");
    const market = evidence.filter((packet) => packet.kind === "reality-market");
    addBlock("position-snapshot", `${tokens[0] ?? "Asset"} snapshot`, position.length ? position : market, "half");
    addBlock("comparison-table", `${tokens[0] ?? "Asset"} fundamentals`, evidence.filter((packet) => packet.kind === "reality-fundamentals"), "half");
    addBlock("price-chart", `${tokens[0] ?? "Asset"} price history`, evidence.filter((packet) => ["technical-analysis", "reality-market"].includes(packet.kind) && evidenceHasCandles(packet)));
  }

  addBlock("event-timeline", "Corporate events", evidence.filter((packet) => packet.kind === "corporate-events"));
  addBlock("news-feed", "Current external evidence", evidence.filter((packet) => ["external-research", "bitget-research"].includes(packet.kind)));
  addBlock("market-depth", "Live market depth", evidence.filter((packet) => packet.kind === "market-depth"), "half");
  addBlock("sentiment-gauge", "Crypto positioning", evidence.filter((packet) => packet.kind === "crypto-market-structure"), "half");
  addBlock("correlation-chart", "Cross-asset relationship", evidence.filter((packet) => packet.kind === "cross-asset-analysis"));
  addBlock("scenario-lab", "Stress scenario", evidence.filter((packet) => packet.kind === "stress-scenario"));
  addBlock("risk-map", "Portfolio risk", evidence.filter((packet) => packet.kind === "portfolio-risk"));
  addBlock("holdings-table", "Portfolio holdings", evidence.filter((packet) => packet.kind === "portfolio-holdings"));
  addBlock("metric-strip", "Verified metrics", evidence.filter((packet) => ["portfolio-summary", "reality-market", "technical-analysis"].includes(packet.kind)), "half");

  const visibleBlocks = blocks.slice(0, 6);
  if (!visibleBlocks.length) addBlock("comparison-table", "Collected evidence", evidence);
  const label = tokens.length ? tokens.join(" and ") : "Research";
  const plan: PresentationPlan = {
    operation: "replace",
    title: `${label} research evidence`.slice(0, 100),
    summary: preservedEvidenceSummary(evidence, tokens),
    subject: tokens.length === 1 ? {
      label: tokens[0],
      token: tokens[0],
      symbol: identities.find((identity) => identity.token === tokens[0])?.symbol,
      scope: evidence.some((packet) => packet.kind === "portfolio-position") ? "position" : "market",
    } : tokens.length > 1 ? { label: tokens.join(" vs "), scope: "comparison" } : undefined,
    confidence: "low",
    blocks: (visibleBlocks.length ? visibleBlocks : blocks).slice(0, 6),
    followups: [],
  };
  const canvas = materializePresentation(plan, store);
  return canvas;
}

export function loadingCanvas(previous?: ResearchCanvasState | null): ResearchCanvasEvent {
  return {
    operation: previous ? "preserve" : "replace",
    status: "loading",
    title: previous?.title ?? "Research in progress",
    summary: "Qwen is selecting tools and composing the evidence surface.",
    subject: previous?.subject,
    confidence: previous?.confidence,
    blocks: [],
    evidence: [],
    followups: [],
    warnings: [],
  };
}

export function errorCanvas(message: string): ResearchCanvasEvent {
  return {
    operation: "replace",
    status: "error",
    title: "Research unavailable",
    summary: message,
    blocks: [],
    evidence: [],
    followups: [],
    warnings: [message],
  };
}

export function workspaceFromCanvas(canvas?: ResearchCanvasState | null): ResearchWorkspaceState {
  return {
    subject: canvas?.subject,
    title: canvas?.title,
    blockKinds: canvas?.blocks.map((block) => block.kind) ?? [],
    evidenceIds: canvas?.evidence.map((item) => item.id) ?? [],
  };
}

export function applyResearchCanvasEvent(current: ResearchCanvasState | null, event: ResearchCanvasEvent): ResearchCanvasState {
  if (!current || event.operation === "replace") return event;
  if (event.operation === "preserve") {
    return event.status === "loading"
      ? { ...current, status: "loading" }
      : { ...current, status: event.status, warnings: unique([...current.warnings, ...event.warnings]) };
  }

  const blocks = new Map(current.blocks.map((block) => [block.id, block]));
  for (const block of event.blocks) blocks.set(block.id, block);
  const evidence = new Map(current.evidence.map((item) => [item.id, item]));
  for (const item of event.evidence) evidence.set(item.id, item);

  return {
    ...current,
    ...event,
    blocks: event.operation === "append" ? [...blocks.values()] : event.blocks,
    evidence: [...evidence.values()],
    warnings: unique([...current.warnings, ...event.warnings]),
  };
}

export function emptyPortfolioAnalysisContext(): PortfolioAnalysisContext {
  return {
    asOf: new Date(0).toISOString(),
    source: "No portfolio snapshot supplied",
    warnings: ["Portfolio snapshot is unavailable."],
    portfolio: { startingCapital: 0, cashBalance: 0, nav: 0, totalPnl: 0, unrealizedPnl: 0, realizedPnl: 0, positions: [], recentTrades: [] },
    analytics: null,
    riskExposure: null,
    assets: [],
  };
}
