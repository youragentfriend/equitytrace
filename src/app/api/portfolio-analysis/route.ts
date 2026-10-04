import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, isStepCount, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { fetchCryptoMarketStructure, fetchMarketSnapshot, fetchPublicMarketCandles, fetchRealityInstruments, fetchRealityOrderBook, fetchRealityStockInfo, normalizeRealitySymbol } from "@/lib/bitget";
import { fetchPositionOverview } from "@/lib/bitget-reality";
import { runResearchBatch } from "@/lib/research-batch";
import {
  crossAssetAnalysis,
  comparisonFactSheet,
  compactResearchValue,
  calculateProposedBuyImpact,
  emptyPortfolioAnalysisContext,
  errorCanvas,
  calculateStressScenario,
  loadingCanvas,
  latestUserQuestion,
  largestPortfolioPositions,
  inferStressScenarioInput,
  materializePresentation,
  normalizeStressShock,
  presentationEvidenceIndex,
  recordResearchSourceState,
  researchFailureKind,
  selectResearchNarrative,
  scopeHoldingsBlocks,
  researchBlockKinds,
  researchCapabilities,
  portfolioEvidenceBundle,
  preserveEvidenceCanvas,
  reusableEvidencePackets,
  type EvidencePacket,
  type PortfolioAnalysisContext,
  type PresentationPlan,
  type ResearchCanvasEvent,
  type ResearchCapability,
  type ResearchProgressEvent,
  type ResearchPlan,
  type TurnRoute,
  type ResearchWorkspaceState,
  withResearchWarnings,
} from "@/lib/portfolio-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

const RESEARCH_TIMEOUT_MS = 50_000;
const POST_EVIDENCE_IDLE_MS = 35_000;
const PRESENTATION_TIMEOUT_MS = 30_000;
const TURN_ROUTER_TIMEOUT_MS = 7_000;
const MAX_TOOL_STEPS = 10;
const BITGET_MCP_TIMEOUT_MS = 3_000;
const BITGET_MCP_COOLDOWN_MS = 5 * 60_000;
let bitgetMcpUnavailableUntil = 0;
const REALITY_OVERVIEW_TTL_MS = 2 * 60_000;
const realityOverviewCache = new Map<string, { expiresAt: number; value: Promise<Awaited<ReturnType<typeof fetchPositionOverview>>> }>();

type ResearchUIMessage = UIMessage<unknown, {
  "research-canvas": ResearchCanvasEvent;
  "research-progress": ResearchProgressEvent;
  "research-timing": { stage: string; elapsedMs: number; fields: Record<string, unknown> };
}>;

const subjectSchema = z.object({
  label: z.string().min(1).max(80),
  symbol: z.string().max(40).optional(),
  token: z.string().max(40).optional(),
  scope: z.enum(["position", "portfolio", "market", "comparison"]),
});

const synthesisSchema = z.object({
  headline: z.string().min(1).max(280),
  supports: z.array(z.string().min(1).max(280)).max(6),
  risks: z.array(z.string().min(1).max(280)).max(6),
  invalidation: z.array(z.string().min(1).max(280)).max(6),
});

const presentationSchema = z.object({
  operation: z.enum(["preserve", "update", "append", "replace"]),
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(600),
  subject: subjectSchema.optional(),
  confidence: z.enum(["low", "medium", "high"]),
  blocks: z.array(z.object({
    id: z.string().min(1).max(80),
    kind: z.enum(researchBlockKinds),
    title: z.string().min(1).max(100),
    subtitle: z.string().max(180).optional(),
    span: z.enum(["full", "half"]),
    evidenceIds: z.array(z.string().min(1)).min(1).max(8),
    synthesis: synthesisSchema.optional(),
  })).max(6),
  followups: z.array(z.string().min(1).max(160)).max(3),
  narrative: z.string().max(4_000).optional(),
});

const comparisonAuditSchema = z.object({
  pass: z.boolean(),
  narrative: z.string().min(1).max(4_000).optional(),
  summary: z.string().min(1).max(600).optional(),
});

const researchPlanSchema = z.object({
  subject: z.string().min(1).max(100),
  questionType: z.enum(["portfolio", "position", "decision", "technical", "events", "comparison", "scenario", "cross-asset", "market"]),
  depth: z.enum(["lookup", "focused", "comprehensive"]),
  capabilities: z.array(z.enum(researchCapabilities)).min(1).max(9),
  researchQuestions: z.array(z.string().min(1).max(180)).min(1).max(5),
});

const turnRouteSchema = z.object({
  mode: z.enum(["conversation", "education", "clarification", "research"]),
  response: z.string().max(2_400).default(""),
  canvasAction: z.enum(["preserve", "research"]),
  needsFreshEvidence: z.boolean(),
  answerShape: z.enum(["collection", "snapshot", "analysis", "decision", "comparison", "technical", "scenario", "timeline"]).optional(),
  plan: researchPlanSchema.optional(),
});

const batchTaskSchema = z.object({
  tool: z.enum(["getPortfolioSnapshot", "getLargestPortfolioPositions", "getPortfolioPosition", "getPortfolioRisk", "calculateProposedBuyImpact", "getRealityMarket", "getMarketDepth", "getRealityFundamentals", "getRealityEvents", "analyzePriceSeries", "getCryptoMarketStructure", "analyzeCrossAssetRelationship"]),
  query: z.string().min(1).max(80).optional(),
  include: z.enum(["summary", "holdings", "trades", "all"]).optional(),
  count: z.number().int().min(1).max(10).optional(),
  amount: z.number().positive().max(1_000_000_000).optional(),
  levels: z.number().int().min(5).max(50).optional(),
  window: z.number().int().min(10).max(365).optional(),
  symbol: z.enum(["BTCUSDT", "ETHUSDT"]).optional(),
  benchmark: z.enum(["BTCUSDT", "ETHUSDT"]).optional(),
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeContext(value: unknown): PortfolioAnalysisContext {
  const empty = emptyPortfolioAnalysisContext();
  const input = record(value);
  const portfolio = record(input.portfolio);
  return {
    ...empty,
    asOf: typeof input.asOf === "string" ? input.asOf : empty.asOf,
    source: typeof input.source === "string" ? input.source : empty.source,
    warnings: Array.isArray(input.warnings) ? input.warnings.filter((item): item is string => typeof item === "string").slice(0, 12) : [],
    selectedSymbol: typeof input.selectedSymbol === "string" ? input.selectedSymbol : undefined,
    portfolio: {
      ...empty.portfolio,
      startingCapital: typeof portfolio.startingCapital === "number" ? portfolio.startingCapital : 0,
      cashBalance: typeof portfolio.cashBalance === "number" ? portfolio.cashBalance : 0,
      nav: typeof portfolio.nav === "number" ? portfolio.nav : 0,
      totalPnl: typeof portfolio.totalPnl === "number" ? portfolio.totalPnl : 0,
      unrealizedPnl: typeof portfolio.unrealizedPnl === "number" ? portfolio.unrealizedPnl : 0,
      realizedPnl: typeof portfolio.realizedPnl === "number" ? portfolio.realizedPnl : 0,
      positions: Array.isArray(portfolio.positions) ? portfolio.positions.slice(0, 100) as PortfolioAnalysisContext["portfolio"]["positions"] : [],
      recentTrades: Array.isArray(portfolio.recentTrades) ? portfolio.recentTrades.slice(-100) as PortfolioAnalysisContext["portfolio"]["recentTrades"] : [],
    },
    analytics: input.analytics && typeof input.analytics === "object" ? input.analytics as PortfolioAnalysisContext["analytics"] : null,
    riskExposure: input.riskExposure && typeof input.riskExposure === "object" ? input.riskExposure as PortfolioAnalysisContext["riskExposure"] : null,
    assets: Array.isArray(input.assets) ? input.assets.slice(0, 100) as PortfolioAnalysisContext["assets"] : [],
  };
}

function safeWorkspace(value: unknown): ResearchWorkspaceState {
  const input = record(value);
  const subject = record(input.subject);
  return {
    subject: typeof subject.label === "string" && ["position", "portfolio", "market", "comparison"].includes(String(subject.scope))
      ? subject as ResearchWorkspaceState["subject"]
      : undefined,
    title: typeof input.title === "string" ? input.title : undefined,
    blockKinds: Array.isArray(input.blockKinds) ? input.blockKinds.filter((item): item is ResearchWorkspaceState["blockKinds"][number] => typeof item === "string" && researchBlockKinds.includes(item as ResearchWorkspaceState["blockKinds"][number])) : [],
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.filter((item): item is string => typeof item === "string") : [],
  };
}

function mcpPayload(value: unknown) {
  const result = record(value);
  if (result.structuredContent !== undefined) return compactResearchValue(result.structuredContent);
  if (!Array.isArray(result.content)) return compactResearchValue(value);
  const items = result.content.map(record);
  const text = items.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text as string).join("\n");
  if (!text) return compactResearchValue(value);
  try { return compactResearchValue(JSON.parse(text)); } catch { return compactResearchValue(text); }
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^r(?=[a-z])/, "");
}

function positionFor(context: PortfolioAnalysisContext, query: string) {
  const normalized = normalizeQuery(query);
  return context.portfolio.positions.find((position) => [position.symbol, position.token, position.name].some((value) => normalizeQuery(value) === normalized));
}

function assetFor(context: PortfolioAnalysisContext, query: string) {
  const normalized = normalizeQuery(query);
  return context.assets.find((asset) => [asset.symbol, asset.token, asset.name].some((value) => normalizeQuery(value) === normalized));
}

function timeoutAfter(milliseconds: number, label: string) {
  return new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds));
}

function capabilityForEvidenceKind(kind: string): EvidencePacket["capability"] {
  if (kind.startsWith("portfolio-")) return "portfolio-intelligence";
  if (["reality-market", "reality-catalog", "market-depth"].includes(kind)) return "rtoken-market";
  if (kind === "reality-fundamentals") return "company-intelligence";
  if (kind === "technical-analysis") return "technical-intelligence";
  if (kind === "corporate-events") return "event-intelligence";
  if (kind === "crypto-market-structure") return "crypto-market-structure";
  if (kind === "cross-asset-analysis") return "macro-cross-asset";
  if (["external-research", "bitget-research"].includes(kind)) return "external-news";
  if (kind === "stress-scenario") return "scenario-intelligence";
  return undefined;
}

function cachedPositionOverview(input: Parameters<typeof fetchPositionOverview>[0]) {
  const key = `${input.symbol}:${input.mode}`;
  const cached = realityOverviewCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = fetchPositionOverview(input).catch((error) => {
    realityOverviewCache.delete(key);
    throw error;
  });
  realityOverviewCache.set(key, { expiresAt: Date.now() + REALITY_OVERVIEW_TTL_MS, value });
  return value;
}

function qwenConfig() {
  const apiKey = process.env.BITGET_QWEN_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseURL: process.env.BITGET_QWEN_BASE_URL || process.env.QWEN_BASE_URL || "https://hackathon.bitgetops.com/v1",
    model: process.env.BITGET_QWEN_MODEL || process.env.QWEN_MODEL || "qwen3.8-max",
  };
}

function messageText(message: ResearchUIMessage) {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join(" ").trim();
}

async function requestTurnRoute(
  config: NonNullable<ReturnType<typeof qwenConfig>>,
  question: string,
  messages: ResearchUIMessage[],
  workspace: ResearchWorkspaceState,
  signal: AbortSignal,
) {
  const history = messages.slice(-10).map((message) => ({ role: message.role, content: messageText(message).slice(0, 800) })).filter((message) => message.content);
  const response = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: [
          "Route this EquityTrace turn before any data tool or canvas action runs.",
          "conversation is friendly social talk, an off-topic request, or a response that needs no financial evidence.",
          "education explains a stable concept such as stocks, crypto, rTokens, dividends, earnings, valuation, or risk without live or personalized data.",
          "EquityTrace product context: rTokens always means Bitget Reality-issued tokenized U.S. stock or ETF exposure (for example rNVDA or rSPY), designed to track the corresponding underlying asset and traded in USDT. It does not mean Reserve Protocol yield tokens. Holding an rToken is not the same as being the registered shareholder and generally does not include voting rights. Bitget handles eligible underlying dividend distributions in USDT. Selected instruments may support extended or 24/7 access, while liquidity, spreads, eligibility, and product availability vary.",
          "clarification asks one natural question only when the user's intended subject or task cannot be resolved from recent conversation and workspace context.",
          "research is for live, current, personalized, portfolio-specific, comparative, technical, event/news, market, scenario, or evidence-backed analysis.",
          "A buy, sell, hold, trim, add, exit, or rebalance question is decision research, not a stress scenario. Use answerShape decision and questionType decision. A scenario is only a hypothetical move or shock requested by the user.",
          "For conversation, education, and clarification, write the complete natural response in response. Be warm, direct, and informative. Do not force headings, caveats, key evidence, limitations, or a next step. Do not mention routing or tools.",
          "For research, leave response empty and return a bounded plan with only material capabilities. Use collection when the user needs a set/list, snapshot for one current entity, technical for price analysis, scenario for what-if analysis, comparison for multiple entities, timeline for news/events, and analysis otherwise.",
          "A scenario calculation does not replace explicitly requested market, liquidity, cross-asset, news, or company research; include the relevant source capability when material.",
          "A request for latest news, headlines, announcements, or a current thesis catalyst needs external-news; Bitget corporate events alone are not a general news search. Add event-intelligence only when dated corporate actions also matter.",
          "Use the canvas only for research where live, personalized, quantitative, comparative, or dated evidence materially improves the answer. Preserve it for ordinary conversation, education, and clarification.",
        ].join("\n") },
        { role: "user", content: `Latest request: ${question}\nRecent conversation: ${JSON.stringify(history)}\nCurrent workspace: ${JSON.stringify(workspace)}` },
      ],
      tools: [{ type: "function", function: { name: "routeTurn", description: "Return the turn mode, natural direct response when applicable, and a bounded research plan only when research is necessary.", parameters: z.toJSONSchema(turnRouteSchema) } }],
      tool_choice: { type: "function", function: { name: "routeTurn" } },
      enable_thinking: false,
      temperature: 0.35,
      max_tokens: 1_000,
    }),
    signal,
  });
  const payload = record(await response.json());
  if (!response.ok) throw new Error(`Qwen turn router failed (${response.status}).`);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = record(record(choices[0]).message);
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const calledFunction = record(record(calls[0]).function);
  if (calledFunction.name !== "routeTurn") throw new Error("Qwen did not return the required turn route.");
  const input = typeof calledFunction.arguments === "string" ? JSON.parse(calledFunction.arguments) : calledFunction.arguments;
  const route = turnRouteSchema.parse(input) as TurnRoute;
  if (route.mode === "research" && !route.plan) throw new Error("Qwen did not return a research plan.");
  return route;
}

async function requestPresentationPlan(config: NonNullable<ReturnType<typeof qwenConfig>>, question: string, workspace: ResearchWorkspaceState, evidence: EvidencePacket[], route: TurnRoute, answer: string | undefined, signal: AbortSignal, validationFeedback = "") {
  const response = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: [
          "You are EquityTrace's research canvas planner. Return one valid JSON object matching the supplied schema; omit the optional narrative field.",
          "Choose visuals that answer the exact user question using only the supplied evidence IDs. The written answer may be generated concurrently; do not assume what it will conclude. Never invent a value or cite unavailable evidence.",
          "Do not infer probabilities, risk contributions, hedge benefit, or precise target allocations from volatility, correlation, or exposure alone.",
          "Choose the minimum complementary views that answer the question: lookup 1–2, focused 2–4, comprehensive 4–6 when evidence supports them. Every cited evidence ID must list the selected block in compatibleViews. Use replace for a new subject, update for the same subject, append only if requested.",
          "When technical candles exist, include price-chart and metric-strip. Distinguish lastCandle from liveQuote. RSI below 70 alone does not prove room for upside or establish a trigger.",
          "For proposed-trade-impact evidence, include a comparison-table citing every impact packet. Cash-funded buys leave NAV and untouched-sector weights unchanged; new capital changes the denominator. Multi-asset liquidity comparisons require the market-depth packets for both assets.",
          "A hypothetical shock is not a probability or forecast. Correlation does not quantify hedge benefit. Broad long-only exposure may diversify, but is not an offsetting hedge without a calculated scenario. Do not invent numeric invalidation thresholds or call one holding uniquely largest without checking ties.",
          "Treat third-party news as headline evidence, not an audited statement; do not repeat its financial figures without issuer evidence. A Bitget-listed dividend date does not confirm payment. Do not claim benchmark overweight without benchmark weights.",
          "The canvas summary must directly address the question and agree with the completed answer when one is supplied. Do not rewrite the answer in the narrative field.",
          "Include every required schema key. In particular, followups must be an array; use [] when no useful follow-up is warranted.",
          "Before returning JSON, retain only measured facts, arithmetic, and clearly labeled conditions. Never invent a value, probability, causal claim, assurance, or source.",
        ].join("\n") },
        { role: "user", content: `Exact question: ${question || "Use the resolved workspace subject."}\n${answer ? `Completed Qwen answer: ${answer}` : "The answer is being generated concurrently from the same evidence."}\nTurn route: ${JSON.stringify(route)}\nExisting workspace: ${JSON.stringify(workspace)}\nAvailable evidence packet index: ${JSON.stringify(presentationEvidenceIndex(evidence))}\nPrevious presentation validation feedback: ${validationFeedback || "none"}` },
      ],
      tools: [{ type: "function", function: { name: "presentResearch", description: "Select an evidence-backed interactive canvas for the user's question.", parameters: z.toJSONSchema(presentationSchema) } }],
      tool_choice: { type: "function", function: { name: "presentResearch" } },
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 2_800,
    }),
    signal,
  });
  const payload = record(await response.json());
  if (!response.ok) throw new Error(`Qwen presentation request failed (${response.status}).`);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = record(record(choices[0]).message);
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const calledFunction = record(record(calls[0]).function);
  if (calledFunction.name !== "presentResearch") throw new Error("Qwen did not return the required presentation function.");
  const input = typeof calledFunction.arguments === "string" ? JSON.parse(calledFunction.arguments) : calledFunction.arguments;
  return presentationSchema.parse(input);
}

async function checkPresentationAgreement(config: NonNullable<ReturnType<typeof qwenConfig>>, question: string, answer: string, plan: PresentationPlan, signal: AbortSignal) {
  const response = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "Check whether this independently drafted research canvas materially contradicts the completed answer or answers a different question. Compare the summary, block titles, and cited evidence dimensions; do not demand identical wording or block count. Return only JSON {\"pass\":true} if compatible, or {\"pass\":false,\"reason\":\"brief specific mismatch\"} if not. Do not rewrite the answer." },
        { role: "user", content: JSON.stringify({ question, answer, canvas: { summary: plan.summary, blocks: plan.blocks.map(({ kind, title, evidenceIds }) => ({ kind, title, evidenceIds })) } }) },
      ],
      response_format: { type: "json_object" },
      enable_thinking: false,
      temperature: 0,
      max_tokens: 250,
    }),
    signal,
  });
  const payload = record(await response.json());
  if (!response.ok) throw new Error(`Qwen canvas agreement check failed (${response.status}).`);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = record(record(choices[0]).message);
  const input = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
  return z.object({ pass: z.boolean(), reason: z.string().optional() }).parse(input);
}

async function auditComparisonNarrative(
  config: NonNullable<ReturnType<typeof qwenConfig>>,
  question: string,
  facts: ReturnType<typeof comparisonFactSheet>,
  tradeImpacts: EvidencePacket[],
  summary: string,
  narrative: string,
  signal: AbortSignal,
) {
  const response = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "Audit this EquityTrace comparison answer and canvas summary against the supplied measured facts and proposed-trade impacts. If all material comparative and arithmetic claims are supported, return only JSON {\"pass\":true}. Otherwise return {\"pass\":false,\"narrative\":\"complete corrected answer\",\"summary\":\"corrected concise canvas brief\"}. A 0.316 return means 31.6%; a more negative drawdown is deeper. Cash-funded buys keep NAV and untouched-sector weights unchanged; new capital changes the denominator. If measured order-book bid/ask notional is supplied, never claim it was unavailable. A small order relative to book depth does not prove execution or precise slippage. Broad long-only exposure is diversification, not a demonstrated offsetting hedge. Shared sector membership does not establish correlation or quantify diversification benefit. If the supplied facts contain no measured correlation, reject and remove any claim that the compared assets are correlated. Correct reversed rankings and unsupported claims without adding facts or changing the question's scope. Preserve valid personalized analysis and source attribution." },
        { role: "user", content: JSON.stringify({ question, facts, tradeImpacts: tradeImpacts.map((packet) => ({ label: packet.label, data: packet.data })), summary, narrative }) },
      ],
      response_format: { type: "json_object" },
      enable_thinking: false,
      temperature: 0,
      max_tokens: 2_000,
    }),
    signal,
  });
  const payload = record(await response.json());
  if (!response.ok) throw new Error(`Qwen comparison audit failed (${response.status}).`);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = record(record(choices[0]).message);
  const input = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
  return comparisonAuditSchema.parse(input);
}

function systemPrompt(context: PortfolioAnalysisContext, workspace: ResearchWorkspaceState, route: TurnRoute, reusableEvidence: EvidencePacket[], phase: "gather" | "answer") {
  const gathering = phase === "gather";
  const capabilities = route.plan?.capabilities ?? [];
  const technical = capabilities.includes("technical-intelligence") || route.answerShape === "technical";
  const scenario = capabilities.includes("scenario-intelligence") || route.answerShape === "scenario";
  const decision = route.answerShape === "decision" || route.answerShape === "comparison";
  const events = capabilities.includes("event-intelligence");
  const news = capabilities.includes("external-news");
  return [
    `You are the ${gathering ? "research orchestrator" : "research analyst"} for EquityTrace, a Track 3 AI Trading Desk. The human makes the final decision.`,
    `The turn has already been routed. ${gathering ? "Execute this bounded plan without planning it again" : "Answer according to this bounded research plan"}: ${JSON.stringify(route.plan)}.`,
    `The required answer shape is ${route.answerShape ?? "analysis"}. ${gathering ? "Use already available fresh evidence before fetching the same dimension again." : "Use only the supplied citable evidence."}`,
    gathering ? "Choose the read-only evidence needed for this question. A separate Qwen stage will write the full answer and choose the exact visual blocks. The application enforces evidence coverage and deterministic calculations." : "Research is complete. Synthesize the supplied evidence into the full answer. A separate Qwen stage will select the exact visual blocks for the right-side canvas.",
    "Never invent prices, holdings, news, fundamentals, events, indicators, or forecasts. Every numeric claim must come from a tool result. Attribute decision-critical claims to the named source and as-of time; distinguish source publication date from retrieval time.",
    "Portfolio holdings and weights come from the user's EquityTrace ledger, not from Bitget. Bitget supplies Reality market data; never label portfolio evidence as Bitget-reported holdings. Round displayed derived percentages sensibly rather than printing floating-point precision.",
    "Market dayChange is a fractional return (0.005 means 0.5%), not a dollar move. Do not state a dollar change without a prior price. Current position value divided by quantity is the current mark, not average entry price or cost basis; omit entry price unless explicit cost-basis evidence exists.",
    "Do not infer a move's probability, normal-distribution tail, portfolio safety, or catalyst timing from volatility or a resilience score alone. Asset volatility is not the asset's contribution to portfolio volatility; do not equate them. Historical drawdown and a hypothetical shock may have different horizons. If holdings tie for the largest weight, say they are tied; do not call one uniquely largest. Mark hypothetical catalysts as hypotheses, not observed news.",
    "Do not attribute portfolio volatility or historical drawdown to a sector without a calculated contribution measure. Shared sector membership does not establish correlation; do not assert assets are correlated or quantify diversification benefit without a measured co-movement packet. Correlation is not a quantified hedge benefit. Do not propose a precise target allocation or claim a threshold is required unless a tool calculated its effect. Describe sector concentration as exposure, not proof of causality. Do not call a position overweight versus a benchmark without benchmark weights.",
    technical ? "For technical analysis, current MACD versus signal shows alignment, not a crossover unless prior values establish the cross. A moving average is context, not a price target. Do not invoke volume confirmation if volume evidence is absent. Never invent RSI, volatility, or allocation thresholds as verified triggers." : "",
    technical ? "For quote-versus-candle comparisons, use the explicit lastCandle and liveQuote fields in technical evidence. Never substitute the penultimate candle for the latest supplied candle without source proof that the latest is incomplete." : "",
    technical ? "RSI below 70 does not imply room for upside, prove the asset is not overbought, or predict consolidation. Support and resistance are observed levels, not calibrated probabilities." : "",
    events ? "Keep scheduled corporate events distinct from analyst forecasts. An earnings forecast is an estimate, not a confirmed earnings date or guaranteed catalyst. Bitget corporate-event dates do not confirm issuer payment or rToken cash distribution." : "",
    gathering ? "Use direct Bitget Reality REST tools first for instrument discovery, quotes, candles, company facts, valuation, earnings, ownership, and corporate events." : "",
    gathering ? "Use gatherResearch to request all independent, relevant Bitget and portfolio evidence in one step after resolving the subject; it runs those Qwen-selected reads concurrently. Dependent discovery and AgentKey find → describe → execute remain sequential. Do not refetch a fresh packet or wait for an optional slow source before finishing with available evidence." : "",
    gathering ? "Use deterministic portfolio tools for holdings, exposure, technical calculations, and scenarios. Use AgentKey for current news, web, social, macro, and alternative evidence; AgentKey requires find → describe → execute and permits one execute call per turn." : "",
    gathering && decision && capabilities.includes("portfolio-intelligence") ? "For a proposed dollar buy, use calculateProposedBuyImpact for objective weight arithmetic, then research the asset and decision with relevant Bitget and other sources. Distinguish portfolio cash from new capital; do not assume a funding source or displaced holding." : "",
    "A cash-funded buy leaves the weights of untouched sectors unchanged when NAV is unchanged; new capital dilutes their weights. Broad long-only exposure is diversification, not a demonstrated hedge against an isolated loss. Never invent numeric invalidation thresholds without a sourced observed level or calculated effect.",
    news ? "Third-party news snippets are not audited financial statements. Use them for dated headlines and source links; omit financial figures unless matching issuer evidence confirms them. Label rumors as unconfirmed." : "",
    gathering ? "Use direct Bitget market depth, crypto futures positioning, and deterministic cross-asset correlation when the question concerns liquidity, weekend trading, crypto transmission, risk appetite, sentiment, or cross-asset behavior." : "",
    gathering ? "Bitget Agent Hub MCP is optional fallback enrichment only. Call its fallback tools only when direct Bitget REST, portfolio tools, and AgentKey cannot provide the needed evidence. Never let MCP unavailability block an otherwise answerable request." : "",
    gathering ? "For a question about one asset, do not request the whole portfolio unless portfolio impact is necessary to answer it." : "If you use portfolio context for a one-asset question, explain why it matters.",
    gathering ? "For a portfolio-wide question, request the portfolio evidence you need. Never substitute the selected or largest holding for an unresolved asset." : "Never substitute the selected or largest holding for an unresolved asset.",
    gathering ? "When the user asks for the largest, top, or highest-weight positions, call getLargestPortfolioPositions and use exactly the ranked positions it returns." : "When the user asks for ranked positions, use the ranking supplied by the evidence; do not rank portfolio positions yourself.",
    "Resolve pronouns and follow-ups from the conversation plus structured workspace subject. If still ambiguous, ask one concise clarification instead of guessing.",
    decision ? "For buy/hold/sell questions, give a conditional evidence frame with supports, risks, invalidation, portfolio impact when relevant, and limitations—not a guaranteed directive. Answer directly and naturally." : "",
    scenario ? "For stress, distinguish portfolio NAV sensitivity from a market/technical stress read. The deterministic calculation is one evidence source, not the whole answer. Explain loss contributors, other relevant research, assumptions, and what would change the thesis. Never imply that an unheld asset causes an actual portfolio loss. Do not call other holdings correlated or assert contagion without measured co-movement; label any broader selloff as an unmodeled possibility." : "",
    gathering ? "After gathering sufficient evidence, call finishResearch. Do not write the answer or canvas in this stage; Qwen will do both in subsequent stages. If one source fails, finish with the available evidence." : "Answer the exact question from the supplied evidence. Preserve the normal depth and richness of EquityTrace research; do not shorten the answer merely because the canvas will arrive later.",
    scenario ? "Never describe a portfolio-wide stress result as a sector or position shock. Use the exact scope and label in the stress-scenario evidence. An unsigned stress percentage is downside unless the user explicitly requests upside." : "",
    gathering ? "" : "Do not output JSX, HTML, chart data, hidden chain-of-thought, or tool narration. Write the final answer in readable Markdown with headings, bullets, numbered steps, or a compact table when useful. Focused research is normally 150–300 words; use more for genuinely comprehensive requests. Include concrete sourced figures and timestamps; never turn the answer into a long story or a mandatory report script.",
    `Portfolio snapshot timestamp: ${context.asOf}. Source: ${context.source}.`,
    `Existing workspace: ${JSON.stringify(workspace)}.`,
    `${gathering ? "Fresh reusable evidence" : "Citable gathered evidence"}: ${JSON.stringify(presentationEvidenceIndex(reusableEvidence))}.`,
    `Portfolio warnings: ${context.warnings.join(" | ") || "none"}.`,
    scenario || decision ? "Final claim check: standalone asset volatility is not portfolio risk contribution; historical drawdown cannot establish shock probability. Never invent invalidation thresholds; use measured levels or qualitative conditions unless calibrated evidence exists." : "",
  ].filter(Boolean).join("\n");
}

function createResearchTools(context: PortfolioAnalysisContext, question: string, plan?: ResearchPlan, initialEvidence: EvidencePacket[] = [], answerShape?: TurnRoute["answerShape"], onBatchProgress?: (id: string, label: string, state: "running" | "complete" | "error") => void) {
  const evidence = new Map<string, EvidencePacket>(initialEvidence.map((packet) => [packet.id, packet]));
  const clients: MCPClient[] = [];
  const describedAgentKeyTools = new Set<string>();
  let evidenceCounter = initialEvidence.length;
  let bitgetClient: MCPClient | undefined;
  let agentKeyClient: MCPClient | undefined;
  let agentKeyExecuted = false;
  let presentation: ResearchCanvasEvent | undefined;
  let batchCounter = 0;
  const researchPlan: ResearchPlan | undefined = plan;

  const register = (kind: string, label: string, provider: EvidencePacket["provider"], data: unknown, asOf = new Date().toISOString(), metadata: Partial<Pick<EvidencePacket, "capability" | "confidence" | "limitations" | "sources">> = {}) => {
    let id = `evidence-${++evidenceCounter}`;
    while (evidence.has(id)) id = `evidence-${++evidenceCounter}`;
    const packet: EvidencePacket = { id, kind, label, provider, asOf, data: compactResearchValue(data), capability: capabilityForEvidenceKind(kind), confidence: "high", ...metadata };
    evidence.set(id, packet);
    return presentationEvidenceIndex([packet])[0];
  };

  const commitPresentation = (plan: PresentationPlan) => {
    const next = materializePresentation(plan, evidence);
    if (plan.blocks.length > 0 && next.blocks.length === 0) throw new Error("Qwen selected no views with compatible evidence.");
    const tradeImpact = [...evidence.values()].filter((packet) => packet.kind === "proposed-trade-impact");
    if (tradeImpact.length && !tradeImpact.every((packet) => next.blocks.some((block) => block.kind === "comparison-table" && block.evidence.includes(packet)))) {
      throw new Error("Every proposed-trade impact calculation requires a comparison-table citing that calculation.");
    }
    if ((researchPlan?.questionType === "technical" || answerShape === "technical") && [...evidence.values()].some((packet) => packet.kind === "technical-analysis" && Array.isArray(record(packet.data).candles) && (record(packet.data).candles as unknown[]).length > 1) && !["price-chart", "metric-strip"].every((kind) => next.blocks.some((block) => block.kind === kind))) {
      throw new Error("Technical research with candles requires price-chart and metric-strip views.");
    }
    presentation = next;
    return presentation;
  };

  const getBitgetClient = async () => {
    if (bitgetClient) return bitgetClient;
    if (Date.now() < bitgetMcpUnavailableUntil) throw new Error("Bitget Agent Hub fallback is temporarily unavailable.");
    const pending = createMCPClient({ transport: { type: "http", url: "https://agent.bitget.com/mcp" }, clientName: "equitytrace", maxRetries: 0 });
    try {
      bitgetClient = await Promise.race([pending, timeoutAfter(BITGET_MCP_TIMEOUT_MS, "Bitget Agent Hub")]);
    } catch (error) {
      bitgetMcpUnavailableUntil = Date.now() + BITGET_MCP_COOLDOWN_MS;
      void pending.then((client) => client.close()).catch(() => undefined);
      throw error;
    }
    clients.push(bitgetClient);
    return bitgetClient;
  };

  const callBitgetMcp = async (name: string, args: Record<string, unknown>) => {
    if (Date.now() < bitgetMcpUnavailableUntil) return { status: "unavailable", provider: "bitget-mcp", message: "Bitget Agent Hub fallback is cooling down after a provider failure. Continue with direct Bitget REST, portfolio, SEC, or AgentKey evidence." };
    try {
      const client = await getBitgetClient();
      return await Promise.race([client.callTool({ name, arguments: args }), timeoutAfter(BITGET_MCP_TIMEOUT_MS, "Bitget Agent Hub")]);
    } catch (error) {
      bitgetMcpUnavailableUntil = Date.now() + BITGET_MCP_COOLDOWN_MS;
      const failedClient = bitgetClient;
      bitgetClient = undefined;
      if (failedClient) await failedClient.close().catch(() => undefined);
      return { status: "unavailable", provider: "bitget-mcp", message: error instanceof Error ? error.message : "Bitget Agent Hub fallback is unavailable." };
    }
  };

  const getAgentKeyClient = async () => {
    const apiKey = process.env.AGENTKEY_API_KEY;
    if (!apiKey) throw new Error("AgentKey is not configured for this deployment.");
    if (agentKeyClient) return agentKeyClient;
    agentKeyClient = await createMCPClient({ transport: { type: "http", url: "https://api.agentkey.app/v1/mcp", headers: { Authorization: `Bearer ${apiKey}` } }, clientName: "equitytrace", maxRetries: 1 });
    clients.push(agentKeyClient);
    return agentKeyClient;
  };

  const tools = {
    getPortfolioSnapshot: tool({
      description: "Read the user's complete current EquityTrace portfolio. Use only for portfolio-wide questions or when portfolio impact is essential.",
      inputSchema: z.object({ include: z.enum(["summary", "holdings", "trades", "all"]).default("summary") }),
      execute: async ({ include }) => {
        const data = include === "summary" ? {
          startingCapital: context.portfolio.startingCapital,
          cashBalance: context.portfolio.cashBalance,
          nav: context.portfolio.nav,
          totalPnl: context.portfolio.totalPnl,
          unrealizedPnl: context.portfolio.unrealizedPnl,
          realizedPnl: context.portfolio.realizedPnl,
          positionCount: context.portfolio.positions.length,
        } : include === "holdings" ? context.portfolio.positions : include === "trades" ? context.portfolio.recentTrades : context.portfolio;
        return register(include === "holdings" ? "portfolio-holdings" : "portfolio-summary", `Portfolio ${include}`, "portfolio", data, context.asOf);
      },
    }),
    getLargestPortfolioPositions: tool({
      description: "Return the user's portfolio positions in deterministic descending weight order. Required for largest, top, or highest-weight position questions; do not infer this ranking from prose.",
      inputSchema: z.object({ count: z.number().int().min(1).max(10).default(2) }),
      execute: async ({ count }) => register(
        "portfolio-holdings",
        `Top ${count} portfolio positions by weight`,
        "portfolio",
        largestPortfolioPositions(context.portfolio.positions, count),
        context.asOf,
      ),
    }),
    getPortfolioPosition: tool({
      description: "Read one named position from the user's portfolio. Supply the actual asset, token, company, or Reality symbol from the conversation. Never use this to guess a missing subject.",
      inputSchema: z.object({ query: z.string().min(1).max(80) }),
      execute: async ({ query }) => {
        const position = positionFor(context, query);
        if (!position) return { status: "not-held", query, message: `${query} is not present in the supplied portfolio ledger.` };
        const market = assetFor(context, query) ?? context.assets.find((item) => item.symbol === position.symbol);
        return register("portfolio-position", `${position.token} portfolio position`, "portfolio", { position, market }, context.asOf);
      },
    }),
    calculateProposedBuyImpact: tool({
      description: "For a proposed dollar-denominated buy, calculate objective before/after position and sector weights from the current ledger. Use alongside current Bitget and other relevant research, not as a substitute for it. If funding is unspecified, compare available portfolio-cash funding with new capital; do not assume a sale of another holding.",
      inputSchema: z.object({ query: z.string().min(1).max(80), amount: z.number().positive().max(1_000_000_000) }),
      execute: async ({ query, amount }) => {
        const impact = calculateProposedBuyImpact(context, query, amount);
        if (!impact) return { status: "unavailable", query, message: "The instrument, amount, or current NAV could not be resolved for a proposed-buy calculation." };
        return register("proposed-trade-impact", `${impact.token} proposed buy impact`, "derived", impact, context.asOf, { limitations: impact.limitations });
      },
    }),
    searchRealityInstruments: tool({
      description: "Search the live Bitget Reality instrument universe by exact rToken, underlying ticker, or company name. Use this when the user names an instrument that is not already resolved in the supplied portfolio context.",
      inputSchema: z.object({ query: z.string().min(1).max(100) }),
      execute: async ({ query }) => {
        const [instruments, stockInfo] = await Promise.race([Promise.all([fetchRealityInstruments(), fetchRealityStockInfo().catch(() => [])]), timeoutAfter(7_000, "Bitget instrument search")]);
        const infoBySymbol = new Map(stockInfo.map((item) => [item.symbol, item]));
        const needle = normalizeQuery(query);
        const matches = instruments.flatMap((instrument) => {
          const info = infoBySymbol.get(instrument.symbol);
          const token = instrument.baseCoin || instrument.symbol.replace(/USDT$/i, "");
          const underlying = info?.code || token.replace(/^r/i, "");
          const name = info?.name || `${underlying} Reality instrument`;
          return [instrument.symbol, token, underlying, name].some((value) => normalizeQuery(value).includes(needle))
            ? [{ symbol: instrument.symbol, token, underlying, name, status: instrument.status }]
            : [];
        }).slice(0, 12);
        if (!matches.length) return { status: "unavailable", query, message: "No matching online Bitget Reality instrument was found." };
        return register("reality-catalog", `Bitget Reality matches for ${query}`, "bitget", { query, matches });
      },
    }),
    getRealityMarket: tool({
      description: "Resolve any exact Bitget Reality token, underlying stock code, or Reality symbol dynamically and retrieve its live quote plus daily candles. No whitelist is used.",
      inputSchema: z.object({ query: z.string().min(1).max(80) }),
      execute: async ({ query }) => {
        const existing = assetFor(context, query);
        if (existing) return register("reality-market", `${existing.token} market`, "bitget", existing, context.asOf);
        const symbol = normalizeRealitySymbol(query);
        if (!symbol) return { status: "unavailable", query, message: "The supplied value could not be resolved to a Reality instrument." };
        const snapshot = await fetchMarketSnapshot([symbol], undefined, undefined, { classifyDynamic: false });
        const asset = snapshot.assets[0];
        if (!asset) return { status: "unavailable", query, message: "Bitget did not return an online Reality instrument for this query." };
        return register("reality-market", `${asset.token} market`, "bitget", {
          symbol: asset.symbol,
          token: asset.token,
          name: asset.name,
          sector: asset.sector,
          color: asset.color,
          price: Number(asset.ticker.lastPrice),
          dayChange: Number(asset.ticker.price24hPcnt),
          candles: asset.candles.map((candle) => ({ timestamp: Number(candle[0]), close: Number(candle[4]) })).filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close)),
        }, snapshot.asOf);
      },
    }),
    getMarketDepth: tool({
      description: "Fetch live Bitget Reality bid/ask depth and compute spread, top-book liquidity, and imbalance. Use for liquidity, execution quality, weekend access, or market-microstructure questions.",
      inputSchema: z.object({ query: z.string().min(1).max(80), levels: z.number().int().min(5).max(50).default(15) }),
      execute: async ({ query, levels }) => {
        const symbol = assetFor(context, query)?.symbol ?? normalizeRealitySymbol(query);
        if (!symbol) return { status: "unavailable", query, message: "The instrument could not be resolved for market-depth research." };
        const book = await Promise.race([fetchRealityOrderBook(symbol, levels), timeoutAfter(6_000, "Bitget market depth")]);
        const bestBid = book.bids[0]?.price;
        const bestAsk = book.asks[0]?.price;
        if (!bestBid || !bestAsk) return { status: "unavailable", query, message: "Bitget returned an empty order book." };
        const bidNotional = book.bids.reduce((sum, level) => sum + level.price * level.quantity, 0);
        const askNotional = book.asks.reduce((sum, level) => sum + level.price * level.quantity, 0);
        const total = bidNotional + askNotional;
        return register("market-depth", `${query} Bitget market depth`, "bitget", {
          symbol,
          bestBid,
          bestAsk,
          mid: (bestBid + bestAsk) / 2,
          spread: bestAsk - bestBid,
          spreadBps: ((bestAsk - bestBid) / ((bestBid + bestAsk) / 2)) * 10_000,
          bidNotional,
          askNotional,
          imbalance: total > 0 ? (bidNotional - askNotional) / total : 0,
          bids: book.bids.slice(0, 15),
          asks: book.asks.slice(0, 15),
        }, book.timestamp, { capability: "rtoken-market", sources: [{ label: book.source }] });
      },
    }),
    getCryptoMarketStructure: tool({
      description: "Fetch direct Bitget crypto futures price, funding, open interest, and long/short positioning. Use only when crypto risk appetite, sentiment, positioning, weekend behavior, or cross-asset transmission is material.",
      inputSchema: z.object({ symbol: z.enum(["BTCUSDT", "ETHUSDT"]).default("BTCUSDT") }),
      execute: async ({ symbol }) => {
        const result = await Promise.race([fetchCryptoMarketStructure(symbol), timeoutAfter(7_000, "Bitget crypto positioning")]);
        return register("crypto-market-structure", `${symbol} Bitget positioning`, "bitget", result, result.asOf, {
          capability: "crypto-market-structure",
          confidence: result.limitations.length ? "medium" : "high",
          limitations: result.limitations,
          sources: [{ label: result.source }],
        });
      },
    }),
    analyzeCrossAssetRelationship: tool({
      description: "Compute deterministic aligned daily performance and return correlation between one Reality instrument and BTC or ETH. Use for questions about how crypto affects an rToken or portfolio holding.",
      inputSchema: z.object({ query: z.string().min(1).max(80), benchmark: z.enum(["BTCUSDT", "ETHUSDT"]).default("BTCUSDT"), window: z.number().int().min(30).max(365).default(90) }),
      execute: async ({ query, benchmark, window }) => {
        let asset = assetFor(context, query);
        if (!asset) {
          const symbol = normalizeRealitySymbol(query);
          if (symbol) {
            const snapshot = await Promise.race([fetchMarketSnapshot([symbol], undefined, undefined, { classifyDynamic: false }), timeoutAfter(8_000, "Bitget Reality market")]);
            const found = snapshot.assets[0];
            if (found) asset = { symbol: found.symbol, token: found.token, name: found.name, sector: found.sector, color: found.color, price: Number(found.ticker.lastPrice), dayChange: Number(found.ticker.price24hPcnt), candles: found.candles.map((candle) => ({ timestamp: Number(candle[0]), close: Number(candle[4]) })).filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close)) };
          }
        }
        if (!asset) return { status: "unavailable", query, message: "The Reality instrument could not be resolved for cross-asset analysis." };
        const benchmarkCandles = await Promise.race([fetchPublicMarketCandles(benchmark, window), timeoutAfter(7_000, "Bitget benchmark candles")]);
        const peer = benchmarkCandles.map((candle) => ({ timestamp: Number(candle[0]), close: Number(candle[4]) })).filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close));
        const result = crossAssetAnalysis(asset.candles.slice(-window), peer, asset.token, benchmark.replace("USDT", ""));
        if (result.observations < 10 || result.returnCorrelation === undefined) return { status: "unavailable", query, message: "Insufficient aligned history for a reliable cross-asset relationship." };
        return register("cross-asset-analysis", `${asset.token} versus ${benchmark.replace("USDT", "")}`, "derived", result, context.asOf, {
          capability: "macro-cross-asset",
          limitations: ["Correlation is historical and does not establish causation."],
          sources: [{ label: "Bitget public daily candles" }],
        });
      },
    }),
    getRealityFundamentals: tool({
      description: "Fetch company profile, live quote, valuation, earnings, and ownership evidence directly from public Bitget Reality REST for one exact supported token or underlying ticker.",
      inputSchema: z.object({ query: z.string().min(1).max(80) }),
      execute: async ({ query }) => {
        const symbol = assetFor(context, query)?.symbol ?? normalizeRealitySymbol(query);
        if (!symbol) return { status: "unavailable", query, message: "Resolve the instrument with searchRealityInstruments before requesting fundamentals." };
        const [instruments, stockInfo] = await Promise.all([fetchRealityInstruments(), fetchRealityStockInfo().catch(() => [])]);
        if (!instruments.some((instrument) => instrument.symbol === symbol)) return { status: "unavailable", query, message: "This instrument is not currently online in Bitget Reality." };
        const overview = await Promise.race([cachedPositionOverview({ symbol, instruments, stockInfo, mode: "asset" }), timeoutAfter(10_000, "Bitget fundamentals")]);
        return register("reality-fundamentals", `${overview.token} Bitget fundamentals`, "bitget", overview, overview.asOf);
      },
    }),
    getRealityEvents: tool({
      description: "Fetch earnings dates, dividends, splits, suspensions, resumptions, and share-capital events directly from public Bitget Reality REST for one exact supported token or underlying ticker. This is corporate-event evidence, not general news.",
      inputSchema: z.object({ query: z.string().min(1).max(80) }),
      execute: async ({ query }) => {
        const symbol = assetFor(context, query)?.symbol ?? normalizeRealitySymbol(query);
        if (!symbol) return { status: "unavailable", query, message: "Resolve the instrument with searchRealityInstruments before requesting events." };
        const [instruments, stockInfo] = await Promise.all([fetchRealityInstruments(), fetchRealityStockInfo().catch(() => [])]);
        if (!instruments.some((instrument) => instrument.symbol === symbol)) return { status: "unavailable", query, message: "This instrument is not currently online in Bitget Reality." };
        const overview = await Promise.race([cachedPositionOverview({ symbol, instruments, stockInfo, mode: "news" }), timeoutAfter(10_000, "Bitget corporate events")]);
        const events = (overview.events ?? []).map((event) => event.type === "DIVIDEND"
          ? { ...event, detail: event.detail?.replace(/\bPayment\s+/i, "Bitget-listed date ") }
          : event);
        return register("corporate-events", `${overview.token} Bitget-reported corporate events`, "bitget", {
          symbol: overview.symbol,
          token: overview.token,
          underlyingSymbol: overview.underlyingSymbol,
          name: overview.name,
          source: overview.source,
          asOf: overview.asOf,
          events,
        }, overview.asOf, { limitations: ["Bitget-listed corporate-event dates do not confirm issuer payment or rToken cash distribution; verify timing with the issuer and Bitget."] });
      },
    }),
    analyzePriceSeries: tool({
      description: "Compute deterministic trend, moving-average, volatility, and drawdown metrics from an exact Reality instrument's daily candles.",
      inputSchema: z.object({ query: z.string().min(1).max(80), window: z.number().int().min(10).max(365).default(90) }),
      execute: async ({ query, window }) => {
        let asset = assetFor(context, query);
        if (!asset) {
          const symbol = normalizeRealitySymbol(query);
          if (symbol) {
            const snapshot = await fetchMarketSnapshot([symbol], undefined, undefined, { classifyDynamic: false });
            const found = snapshot.assets[0];
            if (found) asset = { symbol: found.symbol, token: found.token, name: found.name, sector: found.sector, color: found.color, price: Number(found.ticker.lastPrice), dayChange: Number(found.ticker.price24hPcnt), candles: found.candles.map((candle) => ({ timestamp: Number(candle[0]), close: Number(candle[4]) })).filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close)) };
          }
        }
        if (!asset || asset.candles.length < 2) return { status: "unavailable", query, message: "Comparable daily candles are unavailable." };
        const candles = asset.candles.slice(-window);
        const closes = candles.map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0);
        const returns = closes.slice(1).map((close, index) => close / closes[index] - 1);
        const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
        const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
        let peak = closes[0];
        let maxDrawdown = 0;
        for (const close of closes) { peak = Math.max(peak, close); maxDrawdown = Math.min(maxDrawdown, close / peak - 1); }
        const average = (period: number) => closes.slice(-Math.min(period, closes.length)).reduce((sum, value) => sum + value, 0) / Math.min(period, closes.length);
        const rollingAverage = (index: number, period: number) => {
          const values = closes.slice(Math.max(0, index - period + 1), index + 1);
          return values.reduce((sum, value) => sum + value, 0) / values.length;
        };
        const ema = (period: number) => {
          const alpha = 2 / (period + 1);
          const values: number[] = [];
          closes.forEach((close, index) => values.push(index === 0 ? close : close * alpha + values[index - 1]! * (1 - alpha)));
          return values;
        };
        const ema12 = ema(12);
        const ema26 = ema(26);
        const macdSeries = closes.map((_, index) => ema12[index]! - ema26[index]!);
        const signalAlpha = 2 / 10;
        const signalSeries: number[] = [];
        macdSeries.forEach((value, index) => signalSeries.push(index === 0 ? value : value * signalAlpha + signalSeries[index - 1]! * (1 - signalAlpha)));
        const rsiReturns = returns.slice(-14);
        const averageGain = rsiReturns.reduce((sum, value) => sum + Math.max(0, value), 0) / Math.max(1, rsiReturns.length);
        const averageLoss = rsiReturns.reduce((sum, value) => sum + Math.max(0, -value), 0) / Math.max(1, rsiReturns.length);
        const rsi14 = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
        const indicators = candles.map((point, index) => {
          const sma20 = rollingAverage(index, 20);
          const values = closes.slice(Math.max(0, index - 19), index + 1);
          const variance20 = values.reduce((sum, value) => sum + (value - sma20) ** 2, 0) / Math.max(1, values.length);
          const deviation = Math.sqrt(variance20);
          return { timestamp: point.timestamp, close: point.close, sma20, sma50: rollingAverage(index, 50), upperBand: sma20 + deviation * 2, lowerBand: sma20 - deviation * 2 };
        });
        const recent20 = closes.slice(-20);
        return register("technical-analysis", `${asset.token} deterministic technicals`, "derived", {
          asset: { symbol: asset.symbol, token: asset.token, name: asset.name, price: asset.price, dayChange: asset.dayChange },
          lastCandle: candles.at(-1),
          liveQuote: { price: asset.price, asOf: context.asOf },
          candles,
          window: candles.length,
          change: closes.at(-1)! / closes[0] - 1,
          annualizedVolatility: Math.sqrt(variance) * Math.sqrt(252),
          maxDrawdown,
          sma20: average(20),
          sma50: average(50),
          rsi14,
          macd: macdSeries.at(-1),
          macdSignal: signalSeries.at(-1),
          momentum20: closes.length > 20 ? closes.at(-1)! / closes.at(-21)! - 1 : closes.at(-1)! / closes[0]! - 1,
          support20: Math.min(...recent20),
          resistance20: Math.max(...recent20),
          trend: closes.at(-1)! > average(20) && average(20) > average(50) ? "bullish" : closes.at(-1)! < average(20) && average(20) < average(50) ? "bearish" : "mixed",
          indicators,
        }, context.asOf, { capability: "technical-intelligence", limitations: ["Indicators describe historical price behavior and are not forecasts."], sources: [{ label: "Bitget public Reality daily candles" }] });
      },
    }),
    getPortfolioRisk: tool({
      description: "Read deterministic portfolio risk, exposure, correlation, beta, volatility, drawdown, and risk-return calculations.",
      inputSchema: z.object({ reason: z.string().max(160).optional() }),
      execute: async () => context.riskExposure
        ? register("portfolio-risk", "Portfolio risk and exposure", "derived", { riskExposure: context.riskExposure, analytics: context.analytics }, context.asOf)
        : { status: "unavailable", message: "Comparable portfolio candle history is unavailable." },
    }),
    ...(initialEvidence.some((packet) => packet.kind === "stress-scenario") || !plan?.capabilities.includes("scenario-intelligence") ? {} : { runStressScenario: tool({
      description: "Run a deterministic price-shock scenario for one named portfolio position, one exact portfolio sector, or the whole portfolio. Use a decimal shock such as -0.20 for minus twenty percent. Portfolio scope shocks the entire NAV and must never be described as a sector shock.",
      inputSchema: z.object({ scope: z.enum(["position", "sector", "portfolio"]).optional(), query: z.string().max(80).optional(), shock: z.union([z.number(), z.string().max(24)]).optional() }),
      execute: async ({ scope, query, shock }) => {
        try {
          const inferred = inferStressScenarioInput(question, context.portfolio.positions);
          const numericShock = typeof shock === "string" ? Number(shock.replace(/[%\s]/g, "")) / (shock.includes("%") ? 100 : 1) : shock;
          const scenario = calculateStressScenario({
            scope: scope ?? inferred.scope,
            query: query ?? inferred.query,
            shock: normalizeStressShock(question, Number.isFinite(numericShock) ? numericShock! : inferred.shock),
            baseNav: context.portfolio.nav,
            positions: context.portfolio.positions,
          });
          return register("stress-scenario", `${scenario.label} stress scenario`, "derived", scenario, context.asOf);
        } catch (error) {
          return { status: "unavailable", message: error instanceof Error ? error.message : "The requested scenario is unavailable." };
        }
      },
    }) }),
    browseBitgetAgentHubFallback: tool({
      description: "Optional last-resort Bitget Agent Hub MCP enrichment. Use only after direct Bitget REST, portfolio tools, and AgentKey cannot supply essential evidence. Call this before queryBitgetAgentHubFallback.",
      inputSchema: z.object({ category: z.enum(["equity", "etf", "news", "sentiment", "crypto"]), keyword: z.string().max(100).optional() }),
      execute: async ({ category, keyword }) => {
        const result = await callBitgetMcp("guide", { category, keyword: keyword ?? null, subcategory: null });
        return { provider: "bitget-mcp", catalog: mcpPayload(result) };
      },
    }),
    queryBitgetAgentHubFallback: tool({
      description: "Execute one optional Bitget Agent Hub MCP entry returned by browseBitgetAgentHubFallback. Provider failures return an unavailable result and must not block the answer.",
      inputSchema: z.object({ entryId: z.string().min(1).max(160), params: z.record(z.string(), z.unknown()).default({}), label: z.string().min(1).max(100) }),
      execute: async ({ entryId, params, label }) => {
        const result = await callBitgetMcp("do_query", { entry_id: entryId, params });
        if (record(result).status === "unavailable") return result;
        return register("bitget-research", label, "bitget-mcp", mcpPayload(result));
      },
    }),
    findAgentKeyTools: tool({
      description: "Discover an AgentKey tool for missing live news, web, social, finance, or alternative evidence. Pass the user's full research need. Use only when Bitget is insufficient.",
      inputSchema: z.object({ q: z.string().min(1).max(500) }),
      execute: async ({ q }) => {
        const client = await getAgentKeyClient();
        return { provider: "agentkey", matches: mcpPayload(await client.callTool({ name: "find_tools", arguments: { q } })) };
      },
    }),
    describeAgentKeyTool: tool({
      description: "Describe one exact AgentKey tool name returned by findAgentKeyTools. This is mandatory before execution.",
      inputSchema: z.object({ name: z.string().min(1).max(200) }),
      execute: async ({ name }) => {
        const client = await getAgentKeyClient();
        const description = mcpPayload(await client.callTool({ name: "describe_tool", arguments: { name } }));
        describedAgentKeyTools.add(name);
        return { provider: "agentkey", name, description };
      },
    }),
    executeAgentKeyTool: tool({
      description: "Execute one AgentKey tool after find and describe. One execution is allowed per research turn. The result becomes citable evidence.",
      inputSchema: z.object({ name: z.string().min(1).max(200), params: z.record(z.string(), z.unknown()).default({}), label: z.string().min(1).max(100) }),
      execute: async ({ name, params, label }) => {
        if (!describedAgentKeyTools.has(name)) return { status: "blocked", message: "Describe this exact AgentKey tool before executing it." };
        if (agentKeyExecuted) return { status: "blocked", message: "Only one AgentKey execution is allowed per research turn." };
        agentKeyExecuted = true;
        const client = await getAgentKeyClient();
        const result = await Promise.race([client.callTool({ name: "execute_tool", arguments: { name, params } }), timeoutAfter(10_000, "AgentKey evidence")]);
        return register("external-research", label, "agentkey", mcpPayload(result), new Date().toISOString(), {
          confidence: "medium",
          limitations: ["Third-party headlines and snippets may be stale or inaccurate; company financial figures require matching issuer confirmation."],
        });
      },
    }),
    finishResearch: tool({
      description: "End evidence gathering once the selected research dimensions are covered or unavailable. Qwen will write the complete answer and select its canvas afterward.",
      inputSchema: z.object({}),
      execute: async () => evidence.size > 0
        ? { status: "complete", evidence: presentationEvidenceIndex([...evidence.values()]) }
        : { status: "blocked", message: "Gather citable evidence before finishing research." },
    }),
  };

  const capabilityTools: Partial<Record<ResearchCapability, string[]>> = {
    "portfolio-intelligence": ["getPortfolioSnapshot", "getLargestPortfolioPositions", "getPortfolioPosition", "getPortfolioRisk", "calculateProposedBuyImpact"],
    "rtoken-market": ["getRealityMarket", "getMarketDepth"],
    "company-intelligence": ["getRealityFundamentals"],
    "technical-intelligence": ["analyzePriceSeries"],
    "event-intelligence": ["getRealityEvents"],
    "crypto-market-structure": ["getCryptoMarketStructure"],
    "macro-cross-asset": ["analyzeCrossAssetRelationship"],
    "external-news": ["findAgentKeyTools", "describeAgentKeyTool", "executeAgentKeyTool", "browseBitgetAgentHubFallback", "queryBitgetAgentHubFallback"],
    "scenario-intelligence": ["runStressScenario"],
  };
  const subjectAlreadyResolved = researchPlan && ["position", "decision", "technical", "events"].includes(researchPlan.questionType) && Boolean(assetFor(context, researchPlan.subject));
  const allowedToolNames = new Set(subjectAlreadyResolved ? ["finishResearch"] : ["searchRealityInstruments", "finishResearch"]);
  for (const capability of researchPlan?.capabilities ?? []) {
    for (const toolName of capabilityTools[capability] ?? []) allowedToolNames.add(toolName);
  }
  const batchable = new Set(batchTaskSchema.shape.tool.options.filter((name) => allowedToolNames.has(name)));
  const batchTool = batchable.size ? tool({
      description: `Fetch independent Qwen-selected evidence concurrently in one step. Available actions: ${[...batchable].map((name) => `${name}: ${tools[name].description}`).join(" ")} Supply query for named assets, amount for a proposed buy, and optional window/levels/count/include/symbol/benchmark as relevant. Use exact known symbols. Resolve dependent discovery before batching. A failed source does not cancel the others.`,
      inputSchema: z.object({ tasks: z.array(batchTaskSchema).min(1).max(8) }),
      execute: async ({ tasks }) => {
        const selected = [...new Map(tasks.map((task) => [JSON.stringify(task), task])).values()];
        const currentBatch = ++batchCounter;
        const results = await runResearchBatch(selected, async (task, index) => {
          const id = `batch-${currentBatch}-${index}-${task.tool}`;
          onBatchProgress?.(id, progressLabel(task.tool), "running");
          const args = { query: task.query, include: task.include ?? "summary", count: task.count ?? 2, amount: task.amount, levels: task.levels ?? 15, window: task.window ?? 90, symbol: task.symbol ?? "BTCUSDT", benchmark: task.benchmark ?? "BTCUSDT" };
          try {
            if (!batchable.has(task.tool)) {
              onBatchProgress?.(id, progressLabel(task.tool), "error");
              return { tool: task.tool, query: task.query, output: { status: "blocked", message: "This action is outside Qwen's selected research capabilities for this turn." } };
            }
            if (["getPortfolioPosition", "calculateProposedBuyImpact", "getRealityMarket", "getMarketDepth", "getRealityFundamentals", "getRealityEvents", "analyzePriceSeries", "analyzeCrossAssetRelationship"].includes(task.tool) && !task.query) {
              onBatchProgress?.(id, progressLabel(task.tool), "error");
              return { tool: task.tool, query: task.query, output: { status: "unavailable", message: "An exact subject is required for this research task." } };
            }
            if (task.tool === "calculateProposedBuyImpact" && task.amount === undefined) {
              onBatchProgress?.(id, progressLabel(task.tool), "error");
              return { tool: task.tool, query: task.query, output: { status: "unavailable", message: "A proposed buy amount is required." } };
            }
            const selectedTool = tools[task.tool] as unknown as { execute: (input: typeof args) => Promise<unknown> };
            const output = await selectedTool.execute(args);
            onBatchProgress?.(id, String(record(output).label ?? progressLabel(task.tool)), record(output).status === "unavailable" ? "error" : "complete");
            return { tool: task.tool, query: task.query, output };
          } catch (error) {
            onBatchProgress?.(id, progressLabel(task.tool), "error");
            throw error;
          }
        }, 4);
        return results.map((result, index) => result.status === "fulfilled" ? result.value : { tool: selected[index]!.tool, query: selected[index]!.query, output: { status: "unavailable", message: result.reason instanceof Error ? result.reason.message : "The source was unavailable." } });
      },
    }) : undefined;
  if (batchTool) {
    allowedToolNames.add("gatherResearch");
  }
  const selectedTools = { ...Object.fromEntries(Object.entries(tools).filter(([toolName]) => allowedToolNames.has(toolName) && !batchable.has(toolName as typeof batchTaskSchema.shape.tool.options[number]))), ...(batchTool ? { gatherResearch: batchTool } : {}) };

  return {
    tools: selectedTools,
    getPlan: () => researchPlan,
    getPresentation: () => presentation,
    getEvidence: () => [...evidence.values()],
    commitPresentation,
    close: async () => { await Promise.allSettled(clients.map((client) => client.close())); },
  };
}

function progressLabel(toolName: string) {
  const labels: Record<string, string> = {
    planResearch: "Planning evidence needs",
    getPortfolioSnapshot: "Reading portfolio",
    gatherResearch: "Gathering selected research evidence",
    getLargestPortfolioPositions: "Ranking portfolio positions",
    getPortfolioPosition: "Reading position",
    searchRealityInstruments: "Searching Bitget Reality instruments",
    getRealityMarket: "Fetching Bitget market data",
    getMarketDepth: "Reading Bitget market depth",
    getCryptoMarketStructure: "Reading crypto positioning",
    analyzeCrossAssetRelationship: "Calculating cross-asset relationship",
    getRealityFundamentals: "Fetching Bitget fundamentals",
    getRealityEvents: "Fetching Bitget corporate events",
    analyzePriceSeries: "Calculating technical context",
    getPortfolioRisk: "Calculating portfolio risk",
    runStressScenario: "Running stress scenario",
    browseBitgetAgentHubFallback: "Checking optional Bitget Agent Hub evidence",
    queryBitgetAgentHubFallback: "Querying optional Bitget Agent Hub evidence",
    findAgentKeyTools: "Finding external evidence source",
    describeAgentKeyTool: "Validating external data call",
    executeAgentKeyTool: "Fetching external evidence",
    finishResearch: "Finishing evidence gathering",
  };
  return labels[toolName] ?? "Researching";
}

function chunkText(value: string) {
  return value.match(/.{1,48}(?:\s+|$)/g) ?? [value];
}

async function writeNarrative(writer: Parameters<NonNullable<Parameters<typeof createUIMessageStream>[0]["execute"]>>[0]["writer"], narrative: string) {
  writer.write({ type: "text-start", id: "research-answer" });
  for (const chunk of chunkText(narrative)) writer.write({ type: "text-delta", id: "research-answer", delta: chunk });
  writer.write({ type: "text-end", id: "research-answer" });
}

export async function POST(request: Request) {
  try {
    const body = record(await request.json());
    const messages = (Array.isArray(body.messages) ? body.messages : []) as ResearchUIMessage[];
    const question = latestUserQuestion(messages);
    const context = safeContext(body.analysisContext);
    const workspace = safeWorkspace(body.workspace);
    const previousCanvas = body.canvas && typeof body.canvas === "object" ? body.canvas as ResearchCanvasEvent : null;
    const config = qwenConfig();
    if (!config) return Response.json({ error: "Qwen is not configured for this deployment." }, { status: 503 });

    const stream = createUIMessageStream<ResearchUIMessage>({
      originalMessages: messages,
      onError: () => "Research could not be completed.",
      execute: async ({ writer }) => {
        const turnStartedAt = Date.now();
        const requestId = crypto.randomUUID();
        const logStage = (stage: string, fields: Record<string, unknown> = {}) => {
          const elapsedMs = Date.now() - turnStartedAt;
          console.info("[portfolio-analysis] stage", { requestId, stage, elapsedMs, ...fields });
          writer.write({ type: "data-research-timing", data: { stage, elapsedMs, fields }, transient: true });
        };
        writer.write({ type: "start" });
        writer.write({ type: "data-research-progress", id: "turn-route", data: { id: "turn-route", label: "Understanding your message", phase: "thinking", state: "running" } });
        let turnRoute: TurnRoute;
        const routeStartedAt = Date.now();
        const routeAbort = new AbortController();
        const routeTimeout = setTimeout(() => routeAbort.abort(), TURN_ROUTER_TIMEOUT_MS);
        try {
          turnRoute = await requestTurnRoute(config, question, messages, workspace, routeAbort.signal);
        } catch (error) {
          console.warn("[portfolio-analysis] turn router failed", { kind: researchFailureKind(error) });
          logStage("route-failed", { kind: researchFailureKind(error) });
          const message = "Qwen could not understand this request. Please retry.";
          writer.write({ type: "data-research-canvas", id: "research-canvas", data: errorCanvas(message) });
          await writeNarrative(writer, message);
          writer.setOutcome({ status: "failed" });
          return;
        } finally {
          clearTimeout(routeTimeout);
        }
        const routeMs = Date.now() - routeStartedAt;
        logStage("routed", { durationMs: routeMs, mode: turnRoute.mode, answerShape: turnRoute.answerShape });

        const routeLabel = turnRoute.mode === "research" ? "Planning focused research" : turnRoute.mode === "clarification" ? "Clarifying the request" : "Replying";
        writer.write({ type: "data-research-progress", id: "turn-route", data: { id: "turn-route", label: routeLabel, phase: "thinking", state: "complete" } });
        if (turnRoute.mode !== "research") {
          const fallbackResponse = turnRoute.mode === "clarification"
            ? "What would you like me to clarify?"
            : turnRoute.mode === "education"
              ? "I couldn’t produce a reliable explanation just now. Please try that question again."
              : "No worries. What would you like to explore?";
          await writeNarrative(writer, selectResearchNarrative(turnRoute.response.trim() || fallbackResponse, "", "", false));
          console.info("[portfolio-analysis] turn complete", { requestId, mode: turnRoute.mode, routeMs, totalMs: Date.now() - turnStartedAt, tools: 0, canvas: "preserved" });
          writer.setOutcome({ status: "completed" });
          return;
        }

        const researchPlan = turnRoute.plan!;
        const seededEvidence = new Map<string, EvidencePacket>();
        for (const packet of reusableEvidencePackets(previousCanvas, context)) seededEvidence.set(packet.id, packet);
        if (researchPlan.capabilities.includes("portfolio-intelligence") || researchPlan.questionType === "scenario" || turnRoute.answerShape === "scenario") {
          for (const packet of portfolioEvidenceBundle(context)) seededEvidence.set(packet.id, packet);
        }
        if (researchPlan.questionType === "scenario" || turnRoute.answerShape === "scenario") {
          try {
            const input = inferStressScenarioInput(question, context.portfolio.positions);
            const scenario = calculateStressScenario({ ...input, baseNav: context.portfolio.nav, positions: context.portfolio.positions });
            seededEvidence.set("stress-scenario-current", {
              id: "stress-scenario-current",
              kind: "stress-scenario",
              label: `${scenario.label} stress scenario`,
              provider: "derived",
              asOf: context.asOf,
              data: scenario,
              capability: "scenario-intelligence",
              confidence: "high",
              limitations: ["This is a linear sensitivity estimate; liquidity, gaps, contagion, and correlation shifts are not modeled."],
            });
          } catch (error) {
            console.info("[portfolio-analysis] deterministic scenario unavailable", { kind: researchFailureKind(error) });
          }
        }
        const initialEvidence = [...seededEvidence.values()];
        const research = createResearchTools(context, question, researchPlan, initialEvidence, turnRoute.answerShape, (id, label, state) => {
          writer.write({ type: "data-research-progress", id: `progress-${id}`, data: { id, label, phase: "tool", state } });
        });
        if (!previousCanvas) writer.write({ type: "data-research-canvas", id: "research-canvas", data: loadingCanvas() });
        writer.write({ type: "data-research-progress", id: "research-start", data: { id: "research-start", label: previousCanvas ? "Updating relevant evidence" : "Starting focused research", phase: "thinking", state: "running" } });
        if (initialEvidence.length) {
          writer.write({ type: "data-research-progress", id: "research-start", data: { id: "research-start", label: `${initialEvidence.length} current evidence source${initialEvidence.length === 1 ? "" : "s"} available`, phase: "thinking", state: "complete" } });
          writer.write({ type: "data-research-progress", id: "research-synthesis", data: { id: "research-synthesis", label: "Reviewing current evidence", phase: "composing", state: "running" } });
        }
        const provider = createOpenAICompatible({ name: "bitget-qwen", apiKey: config.apiKey, baseURL: config.baseURL, includeUsage: true });
        let narrative = "";
        let researchError: unknown;
        let answerError: unknown;
        let presentationError: unknown;
        const failedSources = new Set<string>();
        const toolStartedAt = new Map<string, number>();
        const toolMetrics: Array<{ tool: string; durationMs: number; state: "complete" | "error" }> = [];
        let gatheringComplete = false;
        let modelStep = 0;
        let streamedNarrative = false;
        let firstNarrativeDeltaAt = 0;
        const comparisonTurn = turnRoute.answerShape === "comparison" || researchPlan.questionType === "comparison";
        try {
          const primaryAbort = new AbortController();
          const primaryTimeout = setTimeout(() => primaryAbort.abort(), RESEARCH_TIMEOUT_MS);
          let postEvidenceTimeout: ReturnType<typeof setTimeout> | undefined;
          const clearPostEvidenceTimeout = () => {
            if (postEvidenceTimeout) clearTimeout(postEvidenceTimeout);
            postEvidenceTimeout = undefined;
          };
          const armPostEvidenceTimeout = () => {
            clearPostEvidenceTimeout();
            if (research.getEvidence().length > 0 && !gatheringComplete) {
              postEvidenceTimeout = setTimeout(() => primaryAbort.abort(), POST_EVIDENCE_IDLE_MS);
            }
          };
          try {
            const result = streamText({
              model: provider(config.model),
              instructions: systemPrompt(context, workspace, turnRoute, research.getEvidence(), "gather"),
              messages: await convertToModelMessages(messages),
              tools: research.tools,
              stopWhen: isStepCount(MAX_TOOL_STEPS),
              temperature: 0.15,
              maxOutputTokens: 2_800,
              providerOptions: { bitgetQwen: { enable_thinking: false } },
              abortSignal: primaryAbort.signal,
            });

            for await (const part of result.stream) {
              if (part.type === "start-step") modelStep += 1;
              if (part.type === "finish-step") logStage("model-step", { step: modelStep, responseMs: part.performance.responseTimeMs, stepMs: part.performance.stepTimeMs, inputTokens: part.usage.inputTokens, outputTokens: part.usage.outputTokens, finishReason: part.finishReason });
              if (part.type === "tool-call") {
                clearPostEvidenceTimeout();
                toolStartedAt.set(part.toolCallId, Date.now());
                writer.write({ type: "data-research-progress", id: `progress-${part.toolCallId}`, data: { id: part.toolCallId, label: progressLabel(part.toolName), phase: "tool", state: "running", tool: part.toolName } });
              }
              if (part.type === "tool-result") {
                const blocked = record(part.output).status === "blocked";
                toolMetrics.push({ tool: part.toolName, durationMs: Date.now() - (toolStartedAt.get(part.toolCallId) ?? Date.now()), state: blocked ? "error" : "complete" });
                writer.write({ type: "data-research-progress", id: `progress-${part.toolCallId}`, data: { id: part.toolCallId, label: progressLabel(part.toolName), phase: "tool", state: blocked ? "error" : "complete", tool: part.toolName } });
                if (part.toolName === "gatherResearch" && Array.isArray(part.output)) {
                  for (const item of part.output) recordResearchSourceState(failedSources, progressLabel(String(record(item).tool)), !["unavailable", "blocked"].includes(String(record(record(item).output).status)));
                } else if (part.toolName !== "finishResearch") recordResearchSourceState(failedSources, progressLabel(part.toolName), record(part.output).status !== "unavailable");
                if (part.toolName === "finishResearch") {
                  clearPostEvidenceTimeout();
                  if (!blocked) {
                    gatheringComplete = true;
                    logStage("evidence-ready", { count: research.getEvidence().length });
                    primaryAbort.abort();
                  } else armPostEvidenceTimeout();
                } else {
                  const evidenceCount = research.getEvidence().length;
                  writer.write({ type: "data-research-progress", id: "research-start", data: { id: "research-start", label: `Collected ${evidenceCount} evidence source${evidenceCount === 1 ? "" : "s"}`, phase: "thinking", state: "complete" } });
                  writer.write({ type: "data-research-progress", id: "research-synthesis", data: { id: "research-synthesis", label: `Reviewing ${evidenceCount} evidence source${evidenceCount === 1 ? "" : "s"}`, phase: "composing", state: "running" } });
                  armPostEvidenceTimeout();
                }
              }
              if (part.type === "tool-error") {
                toolMetrics.push({ tool: part.toolName, durationMs: Date.now() - (toolStartedAt.get(part.toolCallId) ?? Date.now()), state: "error" });
                if (part.toolName !== "finishResearch") recordResearchSourceState(failedSources, progressLabel(part.toolName), false);
                writer.write({ type: "data-research-progress", id: `progress-${part.toolCallId}`, data: { id: part.toolCallId, label: progressLabel(part.toolName), phase: "tool", state: "error", tool: part.toolName } });
                armPostEvidenceTimeout();
              }
            }
          } catch (error) {
            if (!gatheringComplete) {
              researchError = error;
              console.warn("[portfolio-analysis] primary research degraded", { kind: researchFailureKind(error) });
            }
          } finally {
            clearTimeout(primaryTimeout);
            clearPostEvidenceTimeout();
          }

          const evidence = research.getEvidence();
          const parallelCanvasAbort = new AbortController();
          const parallelCanvasPlan = evidence.length ? (async () => {
            const startedAt = Date.now();
            const timeout = setTimeout(() => parallelCanvasAbort.abort(), Math.min(PRESENTATION_TIMEOUT_MS, Math.max(1_000, 140_000 - (Date.now() - turnStartedAt))));
            writer.write({ type: "data-research-progress", id: "research-canvas-plan", data: { id: "research-canvas-plan", label: "Planning the evidence canvas alongside the answer", phase: "composing", state: "running" } });
            try {
              return { plan: await requestPresentationPlan(config, question, workspace, evidence, turnRoute, undefined, parallelCanvasAbort.signal), error: undefined };
            } catch (error) {
              return { plan: undefined, error };
            } finally {
              clearTimeout(timeout);
              logStage("canvas-plan", { attempt: 1, durationMs: Date.now() - startedAt, parallel: true });
            }
          })() : null;
          if (evidence.length > 0) {
            writer.write({ type: "data-research-progress", id: "research-synthesis", data: { id: "research-synthesis", label: "Writing the research answer", phase: "composing", state: "running" } });
            const answerAbort = new AbortController();
            const answerTimeout = setTimeout(() => answerAbort.abort(), Math.min(65_000, Math.max(1_000, 140_000 - (Date.now() - turnStartedAt))));
            try {
              const answerMessages = await convertToModelMessages(messages);
              answerMessages.push({ role: "user", content: `Citable evidence gathered for this question: ${JSON.stringify(presentationEvidenceIndex(evidence))}\nAnswer the latest request from this evidence. If a requested source failed, disclose only that limitation.` });
              const answer = streamText({
                model: provider(config.model),
                instructions: systemPrompt(context, workspace, turnRoute, evidence, "answer"),
                messages: answerMessages,
                temperature: 0.15,
                maxOutputTokens: 2_800,
                providerOptions: { bitgetQwen: { enable_thinking: false } },
                abortSignal: answerAbort.signal,
              });
              for await (const part of answer.stream) {
                if (part.type !== "text-delta") continue;
                narrative += part.text;
                if (!comparisonTurn) {
                  if (!streamedNarrative) {
                    writer.write({ type: "text-start", id: "research-answer" });
                    streamedNarrative = true;
                    firstNarrativeDeltaAt = Date.now();
                    logStage("narrative-first-delta", { afterEvidenceMs: Date.now() - turnStartedAt });
                  }
                  writer.write({ type: "text-delta", id: "research-answer", delta: part.text });
                }
              }
            } catch (error) {
              answerError = error;
              console.warn("[portfolio-analysis] research answer interrupted", { kind: researchFailureKind(error) });
            } finally {
              clearTimeout(answerTimeout);
              if (streamedNarrative) {
                if (answerError) writer.write({ type: "text-delta", id: "research-answer", delta: "\n\n**Answer interrupted.** Please retry before relying on this partial response." });
                writer.write({ type: "text-end", id: "research-answer" });
              }
            }
          }
          writer.write({ type: "data-research-progress", id: "research-synthesis", data: { id: "research-synthesis", label: answerError || !narrative.trim() ? "Could not complete the research answer" : "Research answer composed", phase: "composing", state: answerError || !narrative.trim() ? "error" : "complete" } });

          let canvas = research.getPresentation();
          if (answerError || !narrative.trim()) parallelCanvasAbort.abort();
          const parallelResult = await parallelCanvasPlan;
          if (evidence.length > 0 && narrative.trim() && !answerError) {
            let validationFeedback = "";
            const verifyAgreement = async (plan: PresentationPlan) => {
              if (comparisonTurn) return;
              const abort = new AbortController();
              const timeout = setTimeout(() => abort.abort(), Math.min(12_000, Math.max(1_000, 145_000 - (Date.now() - turnStartedAt))));
              try {
                const agreement = await checkPresentationAgreement(config, question, narrative.trim(), plan, abort.signal);
                if (!agreement.pass) throw new Error(`Canvas disagreed with the answer: ${agreement.reason || "material mismatch"}`);
              } finally {
                clearTimeout(timeout);
              }
            };
            if (parallelResult?.error) {
              presentationError = parallelResult.error;
              validationFeedback = parallelResult.error instanceof Error ? parallelResult.error.message.slice(0, 300) : "Presentation validation failed.";
            }
            if (parallelResult?.plan) {
              try {
                canvas = research.commitPresentation(parallelResult.plan);
                await verifyAgreement(parallelResult.plan);
                presentationError = undefined;
              } catch (error) {
                canvas = undefined;
                presentationError = error;
                validationFeedback = error instanceof Error ? error.message.slice(0, 300) : "Presentation validation failed.";
                console.warn("[portfolio-analysis] parallel canvas plan rejected", { kind: researchFailureKind(error), reason: validationFeedback });
              }
            }
            if (!canvas) {
              const presentationStartedAt = Date.now();
              const presentationAbort = new AbortController();
              const presentationTimeout = setTimeout(() => presentationAbort.abort(), Math.min(PRESENTATION_TIMEOUT_MS, Math.max(1_000, 140_000 - (Date.now() - turnStartedAt))));
              try {
                const plan = await requestPresentationPlan(config, question, workspace, evidence, turnRoute, narrative.trim(), presentationAbort.signal, validationFeedback);
                canvas = research.commitPresentation(plan);
                await verifyAgreement(plan);
                presentationError = undefined;
              } catch (error) {
                canvas = undefined;
                presentationError = error;
                validationFeedback = error instanceof Error ? error.message.slice(0, 300) : "Presentation validation failed.";
                console.warn("[portfolio-analysis] canvas plan failed", { attempt: 2, kind: researchFailureKind(error), reason: validationFeedback });
              } finally {
                clearTimeout(presentationTimeout);
                logStage("canvas-plan", { attempt: 2, durationMs: Date.now() - presentationStartedAt, state: canvas ? "complete" : "error" });
              }
            }
            writer.write({ type: "data-research-progress", id: "research-canvas-plan", data: { id: "research-canvas-plan", label: canvas ? "Evidence canvas ready" : "Could not validate the evidence canvas", phase: "composing", state: canvas ? "complete" : "error" } });
          }

          if (!canvas) {
            logStage("turn-failed", { evidence: evidence.length, primaryKind: researchError ? researchFailureKind(researchError) : undefined, answerKind: answerError ? researchFailureKind(answerError) : undefined, presentationKind: presentationError ? researchFailureKind(presentationError) : undefined });
            const message = !evidence.length
              ? researchError instanceof Error && researchError.name === "AbortError"
                ? "The research run timed out before any citable evidence was returned. Please retry."
                : "Qwen completed without returning citable evidence. Please retry the question."
              : answerError || !narrative.trim()
                ? "Qwen gathered evidence but could not complete an answer. The canvas shows partial source data only. Please retry."
                : comparisonTurn
                  ? "Qwen answered, but the comparison canvas could not be validated, so its unaudited conclusion is withheld. Please retry."
                  : "Qwen answered from the available evidence, but the canvas could not be validated. The views below are partial source data only.";
            const partial = evidence.length ? preserveEvidenceCanvas(question, evidence) : errorCanvas(message);
            writer.write({ type: "data-research-canvas", id: "research-canvas", data: evidence.length ? { ...partial, title: "Partial research evidence", summary: message, confidence: "low", warnings: [...partial.warnings, message] } : partial });
            if (!streamedNarrative) await writeNarrative(writer, message);
            writer.setOutcome({ status: "failed" });
          } else {
            canvas = scopeHoldingsBlocks(canvas, question);
            canvas = withResearchWarnings(canvas, [...failedSources], { actualFailuresOnly: true });
            let selectedNarrative = narrative.trim();
            const comparisonFacts = comparisonFactSheet(evidence);
            if (comparisonTurn && (comparisonFacts.rows.length >= 2 || evidence.some((packet) => packet.kind === "proposed-trade-impact"))) {
              const auditStartedAt = Date.now();
              let auditVerified = false;
              writer.write({ type: "data-research-progress", id: "comparison-audit", data: { id: "comparison-audit", label: "Checking comparative claims", phase: "composing", state: "running" } });
              const auditAbort = new AbortController();
              const auditTimeout = setTimeout(() => auditAbort.abort(), Math.min(25_000, Math.max(1_000, 145_000 - (Date.now() - turnStartedAt))));
              try {
                const audited = await auditComparisonNarrative(config, question, comparisonFacts, evidence.filter((packet) => packet.kind === "proposed-trade-impact"), canvas.summary, selectedNarrative, auditAbort.signal);
                if (!audited.pass && !audited.narrative) throw new Error("Comparison audit omitted its correction.");
                canvas = { ...canvas, summary: audited.summary ?? canvas.summary };
                selectedNarrative = audited.narrative ?? selectedNarrative;
                auditVerified = true;
                writer.write({ type: "data-research-progress", id: "comparison-audit", data: { id: "comparison-audit", label: "Checked comparative claims", phase: "composing", state: "complete" } });
              } catch (error) {
                console.warn("[portfolio-analysis] comparison audit failed", { kind: researchFailureKind(error) });
                canvas = { ...canvas, confidence: "low", warnings: [...canvas.warnings, "The comparative narrative could not be independently verified this turn."] };
                selectedNarrative = `**Verification incomplete.** Check the measured comparison views before acting.\n\n${selectedNarrative}`;
                writer.write({ type: "data-research-progress", id: "comparison-audit", data: { id: "comparison-audit", label: "Could not verify comparative claims", phase: "composing", state: "error" } });
              } finally {
                clearTimeout(auditTimeout);
                logStage("comparison-audit", { durationMs: Date.now() - auditStartedAt, state: auditVerified ? "complete" : "unverified" });
              }
            }
            if (!streamedNarrative) await writeNarrative(writer, selectedNarrative);
            writer.write({ type: "data-research-canvas", id: "research-canvas", data: canvas });
            logStage("canvas-emitted", { blocks: canvas.blocks.length });
            console.info("[portfolio-analysis] turn complete", {
              requestId,
              mode: "research",
              routeMs,
              totalMs: Date.now() - turnStartedAt,
              answerShape: turnRoute.answerShape,
              evidence: evidence.length,
              blocks: canvas.blocks.length,
              narrativeStreamed: streamedNarrative,
              firstNarrativeDeltaMs: firstNarrativeDeltaAt ? firstNarrativeDeltaAt - turnStartedAt : undefined,
              failures: failedSources.size,
              tools: toolMetrics,
            });
            writer.setOutcome({ status: "completed" });
          }
        } finally {
          await research.close();
        }
      },
    });
    return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Portfolio research request failed.";
    return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
