import assert from "node:assert/strict";
import test from "node:test";
import {
  availableChartWindows,
  applyResearchCanvasEvent,
  calculateStressScenario,
  calculateProposedBuyImpact,
  comparisonFactSheet,
  comparisonVerifiedSummary,
  compactResearchValue,
  crossAssetAnalysis,
  deterministicScenarioNarrative,
  deterministicScenarioCanvas,
  deterministicDecisionNarrative,
  deterministicEvidenceNarrative,
  ensureResearchCoverage,
  filterHoldingsBySector,
  inferStressScenarioInput,
  isInvestmentDecisionQuestion,
  portfolioEvidenceBundle,
  applyDeterministicCanvasSummary,
  emptyPortfolioAnalysisContext,
  enrichResearchCanvas,
  errorCanvas,
  latestUserQuestion,
  largestPortfolioPositions,
  loadingCanvas,
  materializePresentation,
  normalizeStressShock,
  pearsonCorrelation,
  preserveEvidenceCanvas,
  presentationEvidenceIndex,
  presentationNeedsFallback,
  requestedHoldingsSector,
  researchFailureKind,
  recordResearchSourceState,
  reusableEvidencePackets,
  selectResearchNarrative,
  scopeHoldingsBlocks,
  workspaceFromCanvas,
  withResearchWarnings,
  type EvidencePacket,
  type PresentationPlan,
  type ResearchCanvasEvent,
} from "../src/lib/portfolio-analysis.ts";

test("holdings scope only filters explicit single-sector list requests", () => {
  const availableSectors = ["Technology", "Healthcare", "Finance"];
  assert.equal(requestedHoldingsSector("Show only my Technology holdings", availableSectors), "Technology");
  assert.equal(requestedHoldingsSector("List my holdings in Healthcare", availableSectors), "Healthcare");
  assert.equal(requestedHoldingsSector("Show my full portfolio and discuss Technology exposure", availableSectors), undefined);
  assert.equal(requestedHoldingsSector("Compare Technology and Healthcare positions", availableSectors), undefined);
  assert.equal(requestedHoldingsSector("Show only my Technology and Healthcare holdings", availableSectors), undefined);
  assert.equal(requestedHoldingsSector("Show only my Real Estate category holdings", availableSectors), "Real Estate");

  const positions = [
    { symbol: "NVDA", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "", quantity: 1, weight: 18.2, value: 1821, price: 1821, dayChange: 0 },
    { symbol: "MSFT", token: "rMSFT", name: "Microsoft", sector: "Technology", color: "", quantity: 1, weight: 15.3, value: 1533, price: 1533, dayChange: 0 },
    { symbol: "JNJ", token: "rJNJ", name: "Johnson & Johnson", sector: "Healthcare", color: "", quantity: 1, weight: 5, value: 500, price: 500, dayChange: 0 },
  ];
  assert.deepEqual(filterHoldingsBySector(positions, "Technology").map((position) => position.token), ["rNVDA", "rMSFT"]);
  assert.deepEqual(filterHoldingsBySector(positions).map((position) => position.token), ["rNVDA", "rMSFT", "rJNJ"]);
  assert.deepEqual(filterHoldingsBySector(positions, "Real Estate"), []);

  const holdingsPacket = { ...evidence("holdings", "portfolio-holdings", "portfolio"), data: positions };
  const canvas = materializePresentation(plan({ blocks: [
    { id: "holdings", kind: "holdings-table", title: "Technology holdings", span: "full", evidenceIds: ["holdings"] },
    { id: "allocation", kind: "allocation-view", title: "Technology allocation", span: "full", evidenceIds: ["holdings"] },
  ] }), new Map([["holdings", holdingsPacket]]));
  const scoped = scopeHoldingsBlocks(canvas, "Show only my Technology holdings");
  assert.deepEqual(scoped.blocks.map((block) => block.sectorFilter), ["Technology", "Technology"]);

  const fullPortfolio = scopeHoldingsBlocks(canvas, "Show my full portfolio and discuss Technology exposure");
  assert.deepEqual(fullPortfolio.blocks.map((block) => block.sectorFilter), [undefined, undefined]);

  const comparison = scopeHoldingsBlocks(canvas, "Compare Technology and Healthcare positions");
  assert.deepEqual(comparison.blocks.map((block) => block.sectorFilter), [undefined, undefined]);

  const comparisonCanvas = materializePresentation(plan({ blocks: [
    { id: "compare", kind: "comparison-table", title: "Sector comparison", span: "full", evidenceIds: ["holdings"] },
  ] }), new Map([["holdings", holdingsPacket]]));
  assert.deepEqual(scopeHoldingsBlocks(comparisonCanvas, "Compare Technology and Healthcare positions").blocks[0]?.comparisonSectors, ["Technology", "Healthcare"]);

  const unmatched = scopeHoldingsBlocks(canvas, "Show only my Real Estate category holdings");
  assert.deepEqual(unmatched.blocks.map((block) => block.sectorFilter), ["Real Estate", "Real Estate"]);
  assert.deepEqual(filterHoldingsBySector(positions, unmatched.blocks[0]?.sectorFilter), []);
});

function evidence(id: string, kind: string, token = "rGOOGL"): EvidencePacket {
  return {
    id,
    kind,
    label: `${token} evidence`,
    provider: kind.startsWith("portfolio") ? "portfolio" : "bitget",
    asOf: "2026-09-27T00:00:00.000Z",
    data: { token, symbol: `${token.slice(1).toUpperCase()}USDT`, price: 204.5, dayChange: 0.012, candles: [{ timestamp: 1, close: 200 }, { timestamp: 2, close: 204.5 }] },
  };
}

function plan(overrides: Partial<PresentationPlan> = {}): PresentationPlan {
  return {
    operation: "replace",
    title: "rGOOGL research",
    summary: "The current evidence supports a focused rGOOGL review.",
    subject: { label: "rGOOGL", token: "rGOOGL", symbol: "RGOOGLUSDT", scope: "market" },
    confidence: "medium",
    blocks: [{ id: "price", kind: "price-chart", title: "Price context", span: "full", evidenceIds: ["market"] }],
    followups: ["Challenge the thesis"],
    ...overrides,
  };
}

test("empty analysis context does not invent portfolio state", () => {
  const value = emptyPortfolioAnalysisContext();
  assert.equal(value.portfolio.positions.length, 0);
  assert.equal(value.portfolio.nav, 0);
  assert.match(value.warnings[0] ?? "", /unavailable/i);
});

test("materialized canvas contains exactly the model-selected evidence blocks", () => {
  const store = new Map([["market", evidence("market", "reality-market")]]);
  const canvas = materializePresentation(plan(), store);
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["price-chart"]);
  assert.equal(canvas.blocks[0]?.evidence[0]?.id, "market");
  assert.equal(canvas.subject?.token, "rGOOGL");
  assert.equal(canvas.evidence.length, 1);
});

test("follow-up suggestions are deduplicated and capped at three", () => {
  const store = new Map([["market", evidence("market", "reality-market")]]);
  const canvas = materializePresentation(plan({
    followups: ["First", "Second", "Third", "Fourth", "Second"],
  }), store);
  assert.deepEqual(canvas.followups, ["First", "Second", "Third"]);
});

test("presentation does not add a portfolio dashboard to a single-asset question", () => {
  const store = new Map([
    ["market", evidence("market", "reality-market", "rAAPL")],
    ["portfolio", evidence("portfolio", "portfolio-holdings", "portfolio")],
  ]);
  const canvas = materializePresentation(plan({
    title: "rAAPL price",
    subject: { label: "rAAPL", token: "rAAPL", symbol: "RAAPLUSDT", scope: "market" },
    blocks: [{ id: "quote", kind: "metric-strip", title: "Current market", span: "half", evidenceIds: ["market"] }],
  }), store);
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["metric-strip"]);
  assert.deepEqual(canvas.evidence.map((item) => item.id), ["market"]);
});

test("unsupported evidence references are omitted instead of fabricated", () => {
  const canvas = materializePresentation(plan({ blocks: [{ id: "news", kind: "news-feed", title: "Latest news", span: "full", evidenceIds: ["missing"] }] }), new Map());
  assert.equal(canvas.blocks.length, 0);
  assert.match(canvas.warnings[0] ?? "", /evidence was unavailable/i);
});

test("Qwen receives only renderable view hints for each evidence packet", () => {
  const market = evidence("market", "reality-market", "rNVDA");
  const fundamentals = evidence("fundamentals", "reality-fundamentals", "rNVDA");
  const indexed = presentationEvidenceIndex([market, fundamentals]);
  assert.ok(indexed[0]?.compatibleViews.includes("price-chart"));
  assert.ok(indexed[0]?.compatibleViews.includes("position-snapshot"));
  assert.ok(!indexed[0]?.compatibleViews.includes("event-timeline"));
  assert.ok(indexed[1]?.compatibleViews.includes("comparison-table"));
  assert.ok(!indexed[1]?.compatibleViews.includes("price-chart"));
});

test("comparison fact sheet ranks measured returns, volatility, drawdown, and daily move without reversing them", () => {
  const nvidia = evidence("nvidia", "technical-analysis", "rNVDA");
  nvidia.data = { asset: { token: "rNVDA", dayChange: 0.0072 }, window: 90, change: 0.177, annualizedVolatility: 0.301, maxDrawdown: -0.10 };
  const microsoft = evidence("microsoft", "technical-analysis", "rMSFT");
  microsoft.data = { asset: { token: "rMSFT", dayChange: 0.009 }, window: 90, change: 0.316, annualizedVolatility: 0.339, maxDrawdown: -0.059 };
  const facts = comparisonFactSheet([nvidia, microsoft]);
  assert.equal(facts.rankings.higherWindowReturn, "rMSFT");
  assert.equal(facts.rankings.higherDayChange, "rMSFT");
  assert.equal(facts.rankings.higherAnnualizedVolatility, "rMSFT");
  assert.equal(facts.rankings.deeperHistoricalDrawdown, "rNVDA");
});

test("comparison fact sheet reads portfolio weights from a holdings evidence packet", () => {
  const holdings = evidence("holdings", "portfolio-holdings", "Current portfolio");
  holdings.data = [
    { token: "rNVDA", weight: 18 },
    { token: "rMSFT", weight: 15 },
  ];
  const facts = comparisonFactSheet([holdings]);
  assert.equal(facts.rows.find((row) => row.token === "rNVDA")?.portfolioWeight, 18);
  assert.equal(facts.rows.find((row) => row.token === "rMSFT")?.portfolioWeight, 15);
  assert.equal(facts.rankings.higherPortfolioWeight, "rNVDA");
  const nvidia = evidence("nvidia", "technical-analysis", "rNVDA");
  nvidia.data = { asset: { token: "rNVDA" }, window: 90, change: 0.18 };
  const microsoft = evidence("microsoft", "technical-analysis", "rMSFT");
  microsoft.data = { asset: { token: "rMSFT" }, window: 90, change: 0.32 };
  holdings.data = [...holdings.data as object[], { token: "rAAPL", weight: 12 }];
  const mixed = comparisonFactSheet([holdings, nvidia, microsoft]);
  assert.equal(mixed.rows.length, 2);
  assert.equal(mixed.rankings.higherWindowReturn, "rMSFT");
  assert.equal(mixed.rankings.higherPortfolioWeight, "rNVDA");
});

test("comparison brief reports measured spreads without reversing tighter and wider", () => {
  const nvidia = evidence("nvidia", "technical-analysis", "rNVDA");
  nvidia.data = { asset: { token: "rNVDA" }, window: 90, change: 0.18, annualizedVolatility: 0.30, maxDrawdown: -0.10 };
  const microsoft = evidence("microsoft", "technical-analysis", "rMSFT");
  microsoft.data = { asset: { token: "rMSFT" }, window: 90, change: 0.328, annualizedVolatility: 0.338, maxDrawdown: -0.059 };
  const nvdaDepth = evidence("nvda-depth", "market-depth", "rNVDA");
  nvdaDepth.data = { symbol: "RNVDAUSDT", spreadBps: 1.7 };
  const msftDepth = evidence("msft-depth", "market-depth", "rMSFT");
  msftDepth.data = { symbol: "RMSFTUSDT", spreadBps: 8.7 };
  const holdings = evidence("holdings", "portfolio-holdings", "Current portfolio");
  holdings.data = [{ token: "rNVDA", weight: 18 }, { token: "rMSFT", weight: 15 }];
  const summary = comparisonVerifiedSummary(comparisonFactSheet([holdings, nvidia, microsoft, nvdaDepth, msftDepth]));
  assert.match(summary, /rNVDA:.*1\.7 bps.*18\.0% portfolio weight/);
  assert.match(summary, /rMSFT:.*8\.7 bps.*15\.0% portfolio weight/);
  assert.doesNotMatch(summary, /rMSFT.*tighter/i);
});

test("thesis synthesis remains attached to cited tool evidence", () => {
  const store = new Map([["position", evidence("position", "portfolio-position", "rMSFT")]]);
  const canvas = materializePresentation(plan({
    title: "rMSFT decision frame",
    subject: { label: "rMSFT", token: "rMSFT", symbol: "RMSFTUSDT", scope: "position" },
    blocks: [{ id: "thesis", kind: "thesis-board", title: "Hold thesis", span: "full", evidenceIds: ["position"], synthesis: { headline: "Hold only while the thesis and risk budget remain intact.", supports: ["Position size is known."], risks: ["External evidence may change."], invalidation: ["Concentration limit is breached."] } }],
  }), store);
  assert.equal(canvas.blocks[0]?.synthesis?.invalidation[0], "Concentration limit is breached.");
  assert.equal(canvas.blocks[0]?.evidenceIds[0], "position");
});

test("loading and error states never contain fake visual blocks", () => {
  const loading = loadingCanvas();
  const error = errorCanvas("Provider unavailable");
  assert.equal(loading.blocks.length, 0);
  assert.equal(error.blocks.length, 0);
  assert.equal(error.status, "error");
});

test("research payload compaction retains the full supported chart window and latest observations", () => {
  const input = {
    candles: Array.from({ length: 400 }, (_, index) => ({ timestamp: index, close: 100 + index })),
    indicators: Array.from({ length: 400 }, (_, index) => ({ timestamp: index, rsi: index })),
    headlines: Array.from({ length: 90 }, (_, index) => `headline ${index}`),
  };
  const compact = compactResearchValue(input) as typeof input;
  assert.equal(compact.candles.length, 365);
  assert.equal(compact.candles[0]?.timestamp, 35);
  assert.equal(compact.candles.at(-1)?.timestamp, 399);
  assert.equal(compact.indicators[0]?.timestamp, 35);
  assert.equal(compact.indicators.at(-1)?.timestamp, 399);
  assert.equal(compact.headlines[0], "headline 0");
});

test("proposed buy impact separates cash funding from new capital and does not assume an unavailable cash balance", () => {
  const context = emptyPortfolioAnalysisContext();
  context.portfolio.nav = 10_000;
  context.portfolio.cashBalance = 1_000;
  context.portfolio.positions = [{ symbol: "rNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "", quantity: 10, weight: 20, value: 2_000, price: 200, dayChange: 0 }];
  const impact = calculateProposedBuyImpact(context, "NVDA", 500);
  assert.equal(impact?.alternatives[0]?.funding, "portfolio cash");
  assert.equal(impact?.alternatives[0]?.afterNav, 10_000);
  assert.equal(impact?.alternatives[0]?.afterPositionWeight, 25);
  assert.equal(impact?.alternatives[0]?.afterSectorWeight, 25);
  assert.equal(impact?.alternatives[1]?.funding, "new capital");
  assert.equal(impact?.alternatives[1]?.afterNav, 10_500);
  assert.equal(impact?.alternatives[1]?.afterPositionWeight, 2_500 / 10_500 * 100);
  assert.deepEqual(calculateProposedBuyImpact(context, "NVDA", 1_500)?.alternatives.map((row) => row.funding), ["new capital"]);
  assert.equal(calculateProposedBuyImpact(context, "unknown", 500), null);
});

test("a cross-asset liquidity comparison can cite market-depth evidence without silently losing it", () => {
  const depth = { ...evidence("depth", "market-depth"), data: { symbol: "RSPYUSDT", spreadBps: 6, bidNotional: 10_000, askNotional: 12_000, imbalance: -0.09 } };
  const selected = plan({ blocks: [{ id: "liquidity", kind: "comparison-table", title: "Liquidity comparison", span: "full", evidenceIds: ["depth"] }] });
  const canvas = materializePresentation(selected, new Map([[depth.id, depth]]));
  assert.deepEqual(canvas.blocks[0]?.evidenceIds, ["depth"]);
  assert.equal(presentationNeedsFallback(selected, canvas, new Map([[depth.id, depth]])), false);
});

test("research errors do not carry a previous answer into the new error state", () => {
  const previous = materializePresentation(plan(), new Map([["market", evidence("market", "reality-market")]]));
  const failed = applyResearchCanvasEvent(previous, errorCanvas("Current question failed"));
  assert.equal(failed.status, "error");
  assert.equal(failed.summary, "Current question failed");
  assert.equal(failed.title, "Research unavailable");
  assert.equal(failed.subject, undefined);
});

test("chart range controls appear only when timestamp coverage supports them", () => {
  const day = 86_400_000;
  assert.deepEqual(availableChartWindows([0, 30 * day - 1]), []);
  assert.deepEqual(availableChartWindows([0, 30 * day]), [30]);
  assert.deepEqual(availableChartWindows([0, 90 * day]), [30, 90]);
  assert.deepEqual(availableChartWindows([365 * day, 0, Number.NaN]), [30, 90, 365]);
});

test("cross-asset analysis aligns dates and computes deterministic return correlation", () => {
  const day = 86_400_000;
  const primary = [100, 110, 99, 108].map((close, index) => ({ timestamp: index * day, close }));
  const benchmark = [200, 220, 198, 216].map((close, index) => ({ timestamp: index * day, close }));
  const result = crossAssetAnalysis(primary, benchmark, "rNVDA", "BTC");
  assert.equal(result.observations, 4);
  assert.ok((result.returnCorrelation ?? 0) > 0.99);
  assert.deepEqual(result.series.map((point) => Number(point.primary.toFixed(4))), [100, 110, 99, 108]);
  assert.equal(pearsonCorrelation([1, 2], [1, 2]), undefined);
});

function event(operation: ResearchCanvasEvent["operation"], id: string): ResearchCanvasEvent {
  const item = evidence(id, "reality-market", id);
  return materializePresentation(plan({ operation, title: id, blocks: [{ id, kind: "metric-strip", title: id, span: "half", evidenceIds: [id] }] }), new Map([[id, item]]));
}

test("canvas reducer applies model-selected replace, append, update, and preserve operations", () => {
  const replaced = applyResearchCanvasEvent(null, event("replace", "one"));
  const appended = applyResearchCanvasEvent(replaced, event("append", "two"));
  const updated = applyResearchCanvasEvent(appended, event("update", "three"));
  const preserved = applyResearchCanvasEvent(updated, { ...event("preserve", "ignored"), status: "loading" });
  assert.deepEqual(replaced.blocks.map((block) => block.id), ["one"]);
  assert.deepEqual(appended.blocks.map((block) => block.id), ["one", "two"]);
  assert.deepEqual(updated.blocks.map((block) => block.id), ["three"]);
  assert.deepEqual(preserved.blocks.map((block) => block.id), ["three"]);
  assert.equal(preserved.status, "loading");
});

test("workspace state preserves the model-resolved subject for follow-ups", () => {
  const canvas = materializePresentation(plan({ subject: { label: "rJPM", token: "rJPM", symbol: "RJPMUSDT", scope: "position" } }), new Map([["market", evidence("market", "reality-market", "rJPM")]]));
  const workspace = workspaceFromCanvas(canvas);
  assert.equal(workspace.subject?.token, "rJPM");
  assert.deepEqual(workspace.blockKinds, ["price-chart"]);
  assert.deepEqual(workspace.evidenceIds, ["market"]);
});

test("presentation recovery keeps evidence IDs while bounding provider payloads", () => {
  const packet = evidence("market", "reality-market", "rJPM");
  packet.data = { token: "rJPM", candles: Array.from({ length: 1_000 }, (_, index) => ({ index, close: 300 + index })) };
  const index = presentationEvidenceIndex([packet]);
  assert.equal(index[0]?.id, "market");
  assert.match(index[0]?.dataPreview ?? "", /rJPM/);
  assert.ok((index[0]?.dataPreview.length ?? 0) <= 1_600);
  assert.match(index[0]?.dataPreview ?? "", /"count":1000/);
  assert.match(index[0]?.dataPreview ?? "", /"first"/);
  assert.match(index[0]?.dataPreview ?? "", /"last"/);
});

test("portfolio holdings preview retains every small-portfolio position", () => {
  const holdings = evidence("holdings", "portfolio-holdings", "portfolio");
  holdings.data = Array.from({ length: 7 }, (_, index) => ({
    symbol: `RTEST${index}USDT`, token: `rTEST${index}`, name: `Company ${index}`,
    sector: "Technology", color: "#ffffff", quantity: 12.3456,
    weight: index + 1, value: (index + 1) * 100, price: 50, dayChange: 0.02,
  }));
  const preview = presentationEvidenceIndex([holdings])[0]?.dataPreview ?? "";
  assert.match(preview, /rTEST0/);
  assert.match(preview, /rTEST6/);
  assert.ok(preview.length <= 1_200);
});

test("presentation recovery receives the exact latest user question", () => {
  assert.equal(latestUserQuestion([
    { role: "user", parts: [{ type: "text", text: "First question" }] },
    { role: "assistant", parts: [{ type: "text", text: "Answer" }] },
    { role: "user", parts: [{ type: "text", text: "Compare rAAPL and rNVDA in the context of my portfolio." }] },
  ]), "Compare rAAPL and rNVDA in the context of my portfolio.");
  assert.equal(latestUserQuestion([{ role: "assistant", parts: [] }]), "");
});

test("recovered turns never expose stale pre-tool narration", () => {
  assert.equal(selectResearchNarrative("I will fetch the data.", "", "Hold only while the risk budget remains intact.", true), "Hold only while the risk budget remains intact.");
  assert.equal(selectResearchNarrative("I will fetch the data.", "Evidence supports holding.", "Fallback summary", true), "Evidence supports holding.");
  assert.equal(selectResearchNarrative("The verified evidence shows improving momentum with elevated volatility.", "", "Fallback summary", true), "Fallback summary");
  assert.equal(selectResearchNarrative("You own 10 rJPM.", "", "Position summary", false), "You own 10 rJPM.");
});

test("interrupted markdown fragments never replace a complete recovered summary", () => {
  assert.equal(
    selectResearchNarrative("Your portfolio is performing well. NAV sits at **", "", "NAV is $10,420 with moderate concentration risk.", true),
    "NAV is $10,420 with moderate concentration risk.",
  );
});

test("research failures are classified without exposing provider payloads", () => {
  assert.equal(researchFailureKind(Object.assign(new Error("aborted"), { name: "AbortError" })), "timeout");
  assert.equal(researchFailureKind(new SyntaxError("Unexpected token")), "invalid-json");
  assert.equal(researchFailureKind(Object.assign(new Error("invalid"), { name: "ZodError" })), "validation");
  assert.equal(researchFailureKind(new Error("Qwen did not return the required presentation function.")), "missing-tool");
  assert.equal(researchFailureKind(new Error("Qwen presentation request failed (429).")), "provider-http");
  assert.equal(researchFailureKind(new Error("Technical research with candles requires price-chart and metric-strip views.")), "missing-technical-views");
  assert.equal(researchFailureKind(new Error("Every proposed-trade impact calculation requires a comparison-table citing that calculation.")), "missing-trade-impact-view");
  assert.equal(researchFailureKind(new Error("unknown")), "unknown");
});

test("presentation rejects visual blocks whose evidence cannot render them", () => {
  const risk = evidence("risk", "portfolio-risk", "portfolio");
  risk.data = { riskExposure: { volatility: 0.2 }, analytics: { sectorWeights: [{ label: "Technology", value: 55 }] } };
  const canvas = materializePresentation(plan({
    blocks: [
      { id: "bad-allocation", kind: "allocation-view", title: "Sector & Factor Exposure", span: "full", evidenceIds: ["risk"] },
      { id: "good-risk", kind: "risk-map", title: "Sector & Factor Exposure", span: "full", evidenceIds: ["risk"] },
    ],
  }), new Map([["risk", risk]]));
  assert.deepEqual(canvas.blocks.map((block) => block.id), ["good-risk"]);
  assert.match(canvas.warnings.join(" "), /incompatible/i);
});

test("compatible blocks silently ignore extra incompatible evidence", () => {
  const market = evidence("market", "reality-market", "rMSFT");
  const fundamentals = evidence("fundamentals", "reality-fundamentals", "rMSFT");
  const requested = plan({ blocks: [{ id: "metrics", kind: "metric-strip", title: "Metrics", span: "full", evidenceIds: ["market", "fundamentals"] }] });
  const canvas = materializePresentation(requested, new Map([["market", market], ["fundamentals", fundamentals]]));
  assert.deepEqual(canvas.blocks[0]?.evidenceIds, ["market"]);
  assert.deepEqual(canvas.warnings, []);
  assert.equal(presentationNeedsFallback(requested, canvas, new Map([["market", market], ["fundamentals", fundamentals]])), true);
});

test("deterministic fallback keeps all compatible evidence without exposing an internal Qwen warning", () => {
  const position = evidence("position", "portfolio-position", "rNVDA");
  const fundamentals = evidence("fundamentals", "reality-fundamentals", "rNVDA");
  const technicals = evidence("technicals", "technical-analysis", "rNVDA");
  technicals.data = { asset: { token: "rNVDA", symbol: "RNVDAUSDT" }, candles: [{ timestamp: 1, close: 1 }, { timestamp: 2, close: 2 }] };
  const events = evidence("events", "corporate-events", "rNVDA");
  events.data = { events: [{ title: "Earnings", date: "2026-10-01" }] };
  const risk = evidence("risk", "portfolio-risk", "portfolio");
  risk.data = { riskExposure: { volatility: 0.2 }, analytics: { sectorWeights: [{ label: "Technology", value: 55 }] } };
  const canvas = preserveEvidenceCanvas("Any single-asset research question", [position, fundamentals, technicals, events, risk]);
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["position-snapshot", "comparison-table", "price-chart", "event-timeline", "risk-map", "metric-strip"]);
  assert.doesNotMatch(canvas.warnings.join(" "), /Qwen|composition/i);
});

test("stress research is enriched with scenario, position, allocation, and metric views", () => {
  const holdings = evidence("holdings", "portfolio-holdings", "portfolio");
  holdings.data = [{ symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 1, weight: 30, value: 3_000, price: 100, dayChange: 0 }];
  const position = evidence("position", "portfolio-position", "rNVDA");
  position.data = { position: (holdings.data as unknown[])[0] };
  const stress = evidence("stress", "stress-scenario", "rNVDA");
  stress.data = { scope: "position", label: "rNVDA", shock: -0.2, baseNav: 10_000, exposure: 3_000, impact: -600, stressedNav: 9_400 };
  const initial = materializePresentation(plan({ blocks: [{ id: "scenario", kind: "scenario-lab", title: "Stress test", span: "full", evidenceIds: ["stress"] }] }), new Map([["stress", stress]]));
  const enriched = enrichResearchCanvas(initial, [holdings, position, stress]);
  assert.deepEqual(enriched.blocks.map((block) => block.kind), ["scenario-lab", "position-snapshot", "metric-strip", "allocation-view"]);
  assert.equal(enriched.evidence.length, 3);
});

test("named stress research includes a price view when technical candles were collected", () => {
  const stress = evidence("stress", "stress-scenario", "rNVDA");
  stress.data = { scope: "position", label: "rNVDA", shock: -0.2, baseNav: 10_000, exposure: 3_000, impact: -600, stressedNav: 9_400 };
  const technical = evidence("technical", "technical-analysis", "rNVDA");
  technical.data = { candles: [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 95 }] };
  const canvas = materializePresentation(plan({ blocks: [{ id: "scenario", kind: "scenario-lab", title: "Stress", span: "full", evidenceIds: ["stress"] }] }), new Map([["stress", stress]]));
  const covered = ensureResearchCoverage(canvas, [stress, technical], { answerShape: "scenario", questionType: "scenario", depth: "focused" });
  assert.deepEqual(covered.blocks.map((block) => block.kind), ["scenario-lab", "metric-strip", "price-chart"]);
});

test("technical research is enriched beyond a lone chart without duplicating block kinds", () => {
  const market = evidence("market", "reality-market", "rMSFT");
  const technicals = evidence("technicals", "technical-analysis", "rMSFT");
  technicals.data = { asset: { token: "rMSFT", symbol: "RMSFTUSDT", price: 500, dayChange: 0.01 }, candles: [{ timestamp: 1, close: 490 }, { timestamp: 2, close: 500 }], change: 0.02, annualizedVolatility: 0.25, maxDrawdown: -0.08, sma20: 495 };
  const initial = materializePresentation(plan({ blocks: [{ id: "chart", kind: "price-chart", title: "Price trend", span: "full", evidenceIds: ["technicals"] }] }), new Map([["technicals", technicals]]));
  const enriched = enrichResearchCanvas(initial, [market, technicals]);
  assert.deepEqual(enriched.blocks.map((block) => block.kind), ["price-chart", "position-snapshot", "metric-strip"]);
  assert.equal(new Set(enriched.blocks.map((block) => block.kind)).size, enriched.blocks.length);
});

test("adaptive canvas covers market depth, crypto positioning, and cross-asset evidence with compatible views", () => {
  const depth = evidence("depth", "market-depth", "rNVDA");
  const sentiment = evidence("sentiment", "crypto-market-structure", "BTC");
  const crossAsset = evidence("cross", "cross-asset-analysis", "rNVDA");
  const initial = materializePresentation(plan({ blocks: [{ id: "depth", kind: "market-depth", title: "Liquidity", span: "half", evidenceIds: ["depth"] }] }), new Map([["depth", depth]]));
  const enriched = enrichResearchCanvas(initial, [depth, sentiment, crossAsset]);
  assert.deepEqual(enriched.blocks.map((block) => block.kind), ["market-depth", "sentiment-gauge", "correlation-chart"]);
  assert.equal(enriched.evidence.length, 3);
});

test("only real source failures become user-visible warnings", () => {
  const canvas = materializePresentation(plan(), new Map([["market", evidence("market", "reality-market")]]));
  assert.deepEqual(withResearchWarnings(canvas, []), canvas);
  const warned = withResearchWarnings(canvas, ["Fetching fundamentals", "Fetching fundamentals", "Fetching corporate events"]);
  assert.deepEqual(warned.warnings, ["Some requested evidence was unavailable: Fetching fundamentals, Fetching corporate events."]);
  assert.deepEqual(withResearchWarnings(canvas, ["Running stress scenario"], { actualFailuresOnly: true }).warnings, []);
});

test("a successful retry clears its stale source warning without hiding other failures", () => {
  const failures = new Set<string>();
  recordResearchSourceState(failures, "Fetching fundamentals", false);
  recordResearchSourceState(failures, "Fetching events", false);
  recordResearchSourceState(failures, "Fetching fundamentals", true);
  assert.deepEqual([...failures], ["Fetching events"]);
});

test("stress scenarios preserve portfolio, sector, and position scope", () => {
  const positions = [
    { symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 1, weight: 30, value: 3_000, price: 100, dayChange: 0 },
    { symbol: "RAAPLUSDT", token: "rAAPL", name: "Apple", sector: "Technology", color: "#fff", quantity: 1, weight: 20, value: 2_000, price: 100, dayChange: 0 },
    { symbol: "RJPMUSDT", token: "rJPM", name: "JPMorgan", sector: "Finance", color: "#fff", quantity: 1, weight: 10, value: 1_000, price: 100, dayChange: 0 },
  ];
  const portfolio = calculateStressScenario({ scope: "portfolio", shock: -0.2, baseNav: 10_000, positions });
  const sector = calculateStressScenario({ scope: "sector", query: "Technology", shock: -0.2, baseNav: 10_000, positions });
  const position = calculateStressScenario({ scope: "position", query: "rNVDA", shock: -0.2, baseNav: 10_000, positions });
  assert.deepEqual({ exposure: portfolio.exposure, impact: portfolio.impact, stressedNav: portfolio.stressedNav }, { exposure: 6_000, impact: -1_200, stressedNav: 8_800 });
  assert.deepEqual({ exposure: sector.exposure, impact: sector.impact, label: sector.label }, { exposure: 5_000, impact: -1_000, label: "Technology" });
  assert.deepEqual({ exposure: position.exposure, impact: position.impact, label: position.label }, { exposure: 3_000, impact: -600, label: "rNVDA" });
});

test("price shock permits total loss but rejects a price below zero", () => {
  const input = { scope: "portfolio" as const, baseNav: 10_000, positions: [{ symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 1, weight: 30, value: 3_000, price: 100, dayChange: 0 }] };
  assert.equal(calculateStressScenario({ ...input, shock: -1 }).stressedNav, 7_000);
  assert.throws(() => calculateStressScenario({ ...input, shock: -1.01 }), /cannot fall more than 100%/);
});

test("stress intent defaults to downside while preserving explicit direction", () => {
  assert.equal(normalizeStressShock("Stress my Technology exposure by 20%.", 0.2), -0.2);
  assert.equal(normalizeStressShock("Stress-test rMSFT at a 15% decline.", 0.15), -0.15);
  assert.equal(normalizeStressShock("If rNVDA fell 20% while rMSFT stayed flat", 0.2), -0.2);
  assert.equal(normalizeStressShock("What if Technology rises by 20%?", 0.2), 0.2);
  assert.equal(normalizeStressShock("Model a 10% upside gain.", -0.1), 0.1);
  assert.equal(normalizeStressShock("Shock the portfolio by -25%.", -0.25), -0.25);
});

test("stress scenario input is resolved deterministically before Qwen tool execution", () => {
  const positions = [
    { symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 1, weight: 30, value: 3_000, price: 100, dayChange: 0 },
    { symbol: "RJPMUSDT", token: "rJPM", name: "JPMorgan", sector: "Finance", color: "#fff", quantity: 1, weight: 10, value: 1_000, price: 100, dayChange: 0 },
  ];

  assert.deepEqual(inferStressScenarioInput("Can you stress test rNVDA?", positions), { scope: "position", query: "rNVDA", shock: -0.2 });
  assert.deepEqual(inferStressScenarioInput("Model a 12% decline in my largest position.", positions), { scope: "position", query: "rNVDA", shock: -0.12 });
  assert.deepEqual(inferStressScenarioInput("If rNVDA fell 20% while rJPM stayed flat, what happens?", positions), { scope: "position", query: "rNVDA", shock: -0.2 });
  assert.deepEqual(inferStressScenarioInput("What if Technology rises by 15%?", positions), { scope: "sector", query: "Technology", shock: 0.15 });
  assert.deepEqual(inferStressScenarioInput("Stress the whole portfolio by 10%.", positions), { scope: "portfolio", shock: -0.1 });
  assert.deepEqual(inferStressScenarioInput("Stress test rUNKNOWN.", positions), { scope: "position", query: "rUNKNOWN", shock: -0.2 });
});

test("investment decisions are classified by intent rather than one sample prompt", () => {
  for (const question of [
    "Should I sell rSPY?",
    "Would you hold rMSFT here?",
    "Is it time to trim my largest position?",
    "Should I add to rNVDA?",
    "Help me rebalance out of Technology.",
  ]) assert.equal(isInvestmentDecisionQuestion(question), true, question);

  for (const question of [
    "What if rSPY falls 10%?",
    "Stress test rNVDA.",
    "How did rSPY perform during the selloff?",
    "Show my portfolio.",
  ]) assert.equal(isInvestmentDecisionQuestion(question), false, question);
});

test("ranked portfolio selection uses actual weight and value instead of model ordering", () => {
  const positions = [
    { symbol: "RAAPLUSDT", token: "rAAPL", name: "Apple", sector: "Technology", color: "#fff", quantity: 1, weight: 12, value: 12_000, price: 100, dayChange: 0 },
    { symbol: "RSPYUSDT", token: "rSPY", name: "SPY", sector: "Broad Market", color: "#fff", quantity: 1, weight: 18, value: 18_000, price: 100, dayChange: 0 },
    { symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 1, weight: 18, value: 18_500, price: 100, dayChange: 0 },
    { symbol: "RMSFTUSDT", token: "rMSFT", name: "Microsoft", sector: "Technology", color: "#fff", quantity: 1, weight: 15, value: 15_000, price: 100, dayChange: 0 },
  ];
  assert.deepEqual(largestPortfolioPositions(positions, 2).map((position) => position.token), ["rNVDA", "rSPY"]);
  assert.deepEqual(largestPortfolioPositions(positions, 0), []);
  assert.equal(largestPortfolioPositions(positions, 20).length, positions.length);
});

test("stress conclusions are derived from scenario arithmetic rather than model prose", () => {
  const packet = evidence("stress", "stress-scenario", "portfolio");
  packet.data = { scope: "sector", label: "Technology", shock: -0.2, baseNav: 100_000, exposure: 45_000, impact: -9_000, stressedNav: 91_000 };
  const canvas = materializePresentation(plan({
    summary: "The scenario NAV increases to $109,000.",
    blocks: [{ id: "scenario", kind: "scenario-lab", title: "Technology stress", span: "full", evidenceIds: ["stress"] }],
  }), new Map([["stress", packet]]));
  const grounded = applyDeterministicCanvasSummary(canvas);
  assert.match(grounded.summary, /-20%/);
  assert.match(grounded.summary, /-\$9,000/);
  assert.match(grounded.summary, /\$91,000/);
  assert.doesNotMatch(grounded.summary, /\$109,000/);
});

test("scenario narrative remains informative while preserving deterministic arithmetic", () => {
  const scenario = evidence("stress", "stress-scenario", "rNVDA");
  scenario.data = { scope: "position", label: "rNVDA", shock: -0.2, baseNav: 10_000, exposure: 3_000, impact: -600, stressedNav: 9_400 };
  const risk = evidence("risk", "portfolio-risk", "portfolio");
  risk.data = { riskExposure: { volatility: 0.24, beta: 1.1, maxDrawdown: -0.18 }, analytics: {} };
  const canvas = materializePresentation(plan({ blocks: [
    { id: "scenario", kind: "scenario-lab", title: "Stress", span: "full", evidenceIds: ["stress"] },
    { id: "risk", kind: "risk-map", title: "Risk", span: "full", evidenceIds: ["risk"] },
  ] }), new Map([["stress", scenario], ["risk", risk]]));
  const narrative = deterministicScenarioNarrative(canvas);
  assert.match(narrative, /\$600/);
  assert.match(narrative, /\$9,400/);
  assert.match(narrative, /30\.0% of NAV/);
  assert.match(narrative, /For context/);
  assert.doesNotMatch(narrative, /Limitations and next step/);
});

test("deterministic scenario lane produces focused interactive coverage without unrelated providers", () => {
  const context = emptyPortfolioAnalysisContext();
  context.portfolio = {
    startingCapital: 10_000,
    cashBalance: 7_000,
    nav: 10_000,
    totalPnl: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    recentTrades: [],
    positions: [{ symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 10, weight: 30, value: 3_000, price: 300, dayChange: 0.01 }],
  };
  const canvas = deterministicScenarioCanvas("Can you stress test rNVDA?", context);
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["scenario-lab", "position-snapshot", "metric-strip", "allocation-view"]);
  assert.deepEqual(new Set(canvas.evidence.map((packet) => packet.provider)), new Set(["derived", "portfolio"]));
  assert.match(canvas.summary, /-20%/);
  assert.match(deterministicScenarioNarrative(canvas), /\$600 loss/);
  assert.deepEqual(canvas.warnings, []);
});

test("recovery narrative synthesizes cross-asset and positioning evidence instead of collapsing to one fact", () => {
  const position = evidence("position", "portfolio-position", "rNVDA");
  position.data = { position: { token: "rNVDA", value: 1_800, weight: 18 }, market: { price: 220 } };
  const cross = evidence("cross", "cross-asset-analysis", "rNVDA");
  cross.data = { primaryLabel: "rNVDA", benchmarkLabel: "BTC", observations: 90, returnCorrelation: 0.52, series: [] };
  cross.limitations = ["Correlation is historical and does not establish causation."];
  const crypto = evidence("crypto", "crypto-market-structure", "BTC");
  crypto.data = { symbol: "BTCUSDT", change24h: 0.03, fundingRate: 0.0001, longShortRatio: 1.4 };
  const canvas = preserveEvidenceCanvas("Cross-asset impact", [position, cross, crypto]);
  const narrative = deterministicEvidenceNarrative(canvas);
  assert.match(narrative, /moderate return correlation \(0\.52\)/);
  assert.match(narrative, /0\.010% funding/);
  assert.match(narrative, /Keep in mind:/);
  assert.doesNotMatch(narrative, /Next step:/);
});

test("recovery narrative separates verified corporate events from external narrative", () => {
  const events = evidence("events", "corporate-events", "rMSFT");
  events.data = { events: [{ title: "Quarterly earnings", date: "2026-10-20" }, { title: "Dividend ex-date", date: "2026-11-01" }] };
  const news = evidence("news", "external-research", "rMSFT");
  news.data = { results: [{ headline: "Cloud demand remains in focus", publisher: "Example Wire" }] };
  const canvas = preserveEvidenceCanvas("Current events and news", [events, news]);
  const narrative = deterministicEvidenceNarrative(canvas);
  assert.match(narrative, /verified calendar includes/i);
  assert.match(narrative, /2026-10-20: Quarterly earnings/);
  assert.match(narrative, /Current coverage includes/);
  assert.match(narrative, /Cloud demand remains in focus \(Example Wire\)/);
});

test("empty portfolio-risk evidence cannot create a nominally ready visual", () => {
  const risk = evidence("risk", "portfolio-risk", "portfolio");
  risk.data = { riskExposure: {}, analytics: { sectorWeights: [], factorScores: [] } };
  const canvas = materializePresentation(plan({ blocks: [{ id: "risk", kind: "risk-map", title: "Sector & Factor Exposure", span: "full", evidenceIds: ["risk"] }] }), new Map([["risk", risk]]));
  assert.equal(canvas.blocks.length, 0);
});

test("presentation failure preserves single-asset evidence in compatible views", () => {
  const market = evidence("market", "reality-market", "rNVDA");
  const fundamentals = evidence("fundamentals", "reality-fundamentals", "rNVDA");
  fundamentals.data = { token: "rNVDA", symbol: "RNVDAUSDT", valuation: { pe: 31.2, marketCap: 4_200_000_000_000 } };
  const technicals = evidence("technicals", "technical-analysis", "rNVDA");
  technicals.data = { asset: { token: "rNVDA", symbol: "RNVDAUSDT", price: 182 }, candles: [{ timestamp: 1, close: 175 }, { timestamp: 2, close: 182 }], change: 0.04 };
  const canvas = preserveEvidenceCanvas("Can you analyze rNVDA?", [market, fundamentals, technicals]);
  assert.equal(canvas.status, "ready");
  assert.equal(canvas.subject?.token, "rNVDA");
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["position-snapshot", "comparison-table", "price-chart", "metric-strip"]);
  assert.deepEqual(canvas.evidence.map((item) => item.id).sort(), ["fundamentals", "market", "technicals"]);
  assert.match(canvas.summary, /4\.0% return/);
  assert.doesNotMatch(canvas.warnings.join(" "), /Qwen|composition/i);
});

test("presentation failure preserves multi-asset evidence as a comparison", () => {
  const apple = evidence("apple", "portfolio-position", "rAAPL");
  apple.data = { position: { token: "rAAPL", symbol: "RAAPLUSDT", price: 250, weight: 20 } };
  const nvidia = evidence("nvidia", "portfolio-position", "rNVDA");
  nvidia.data = { position: { token: "rNVDA", symbol: "RNVDAUSDT", price: 182, weight: 15 } };
  const canvas = preserveEvidenceCanvas("Compare rAAPL and rNVDA.", [apple, nvidia]);
  assert.equal(canvas.status, "ready");
  assert.equal(canvas.subject?.scope, "comparison");
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["comparison-table"]);
  assert.deepEqual(canvas.blocks[0]?.evidenceIds, ["apple", "nvidia"]);
});

test("presentation failure can retain a sourced scenario without claiming a completed thesis", () => {
  const stress = { ...evidence("stress", "stress-scenario", "portfolio"), data: { scope: "sector", label: "Technology", shock: -0.1, baseNav: 10_000, exposure: 4_500, impact: -450, stressedNav: 9_550 } };
  const canvas = preserveEvidenceCanvas("Stress my portfolio", [stress]);
  assert.equal(canvas.confidence, "low");
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["scenario-lab"]);
  assert.deepEqual(canvas.blocks[0]?.evidenceIds, ["stress"]);
});

test("research copy preserves emphasis markers for rendered Markdown without changing arithmetic", () => {
  assert.equal(selectResearchNarrative("Impact is **-$200** and 2*3 remains 6.", "", "", false), "Impact is **-$200** and 2*3 remains 6.");
});

test("decision coverage prioritizes thesis evidence instead of forcing a scenario", () => {
  const position = evidence("position", "portfolio-position", "rSPY");
  const technical = evidence("technical", "technical-analysis", "rSPY");
  technical.data = { asset: { token: "rSPY", symbol: "RSPYUSDT" }, candles: [{ timestamp: 1, close: 650 }, { timestamp: 2, close: 655 }], change: 0.01 };
  const events = evidence("events", "corporate-events", "rSPY");
  events.data = { events: [{ title: "Distribution", date: "2026-12-15" }] };
  const initial = materializePresentation(plan({ blocks: [{ id: "thesis", kind: "thesis-board", title: "Decision frame", span: "full", evidenceIds: ["position"], synthesis: { headline: "Hold while the thesis remains intact.", supports: ["Diversified exposure"], risks: ["Market drawdown"], invalidation: ["Risk budget changes"] } }] }), new Map([["position", position]]));
  const canvas = ensureResearchCoverage(initial, [position, technical, events], { answerShape: "decision", questionType: "decision", depth: "focused", question: "Should I sell rSPY?" });
  assert.deepEqual(canvas.blocks.map((block) => block.kind), ["thesis-board", "position-snapshot", "price-chart", "metric-strip", "event-timeline"]);
  assert.equal(canvas.blocks.some((block) => block.kind === "scenario-lab"), false);
});

test("decision recovery answers the decision naturally from partial verified evidence", () => {
  const position = evidence("position", "portfolio-position", "rSPY");
  position.data = { position: { token: "rSPY", value: 1_800, weight: 18, price: 650 } };
  const technical = evidence("technical", "technical-analysis", "rSPY");
  technical.data = { asset: { token: "rSPY", price: 650 }, trend: "bullish", change: 0.03, annualizedVolatility: 0.09, maxDrawdown: -0.03, rsi14: 60, support20: 635, candles: [{ timestamp: 1, close: 640 }, { timestamp: 2, close: 650 }] };
  const canvas = ensureResearchCoverage(materializePresentation(plan({ blocks: [{ id: "position", kind: "position-snapshot", title: "rSPY", span: "half", evidenceIds: ["position"] }] }), new Map([["position", position]])), [position, technical], { answerShape: "decision", questionType: "decision", depth: "focused", question: "Should I sell rSPY?" });
  const narrative = deterministicDecisionNarrative(canvas, "Should I sell rSPY?");
  assert.match(narrative, /wouldn’t treat the current evidence as a reason to sell/i);
  assert.match(narrative, /18\.0%/);
  assert.match(narrative, /bullish/i);
  assert.match(narrative, /\$635/);
  assert.doesNotMatch(narrative, /Research completed with|Key evidence|Next step|If rSPY moved/);
  assert.equal(canvas.blocks[0]?.kind === "thesis-board" || canvas.blocks.some((block) => block.kind === "thesis-board"), true);
});

test("portfolio bundle keeps summary and holdings as distinct renderable evidence", () => {
  const context = emptyPortfolioAnalysisContext();
  context.asOf = "2026-09-29T00:00:00.000Z";
  context.portfolio = {
    startingCapital: 10_000,
    cashBalance: 1_000,
    nav: 10_000,
    totalPnl: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    recentTrades: [],
    positions: [
      { symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 1, weight: 90, value: 9_000, price: 9_000, dayChange: 0 },
    ],
  };
  const bundle = portfolioEvidenceBundle(context);
  assert.deepEqual(bundle.map((packet) => packet.kind), ["portfolio-summary", "portfolio-holdings"]);
  assert.equal((bundle[0]?.data as { nav: number }).nav, 10_000);
  assert.equal((bundle[1]?.data as unknown[]).length, 1);
});

test("semantic coverage makes a collection request render the collection, not metrics alone", () => {
  const summary = evidence("summary", "portfolio-summary", "portfolio");
  summary.data = { nav: 10_000, cashBalance: 1_000, positionCount: 1 };
  const holdings = evidence("holdings", "portfolio-holdings", "portfolio");
  holdings.data = [{ symbol: "RNVDAUSDT", token: "rNVDA", name: "NVIDIA", sector: "Technology", color: "#fff", quantity: 1, weight: 90, value: 9_000, price: 9_000, dayChange: 0 }];
  const initial = materializePresentation(plan({
    subject: { label: "Portfolio", scope: "portfolio" },
    blocks: [{ id: "metrics", kind: "metric-strip", title: "Portfolio metrics", span: "full", evidenceIds: ["summary"] }],
  }), new Map([["summary", summary], ["holdings", holdings]]));
  const covered = ensureResearchCoverage(initial, [summary, holdings], { answerShape: "collection", questionType: "portfolio", depth: "lookup" });
  assert.deepEqual(covered.blocks.map((block) => block.kind), ["metric-strip", "holdings-table", "allocation-view"]);
});

test("planned internal capabilities do not become user-visible provider failures", () => {
  const canvas = materializePresentation(plan(), new Map([["market", evidence("market", "reality-market")]]));
  const unchanged = withResearchWarnings(canvas, ["portfolio intelligence"], { actualFailuresOnly: true });
  assert.deepEqual(unchanged.warnings, []);
});

test("fallback research prose is natural and does not force report boilerplate", () => {
  const market = evidence("market", "reality-market", "rNVDA");
  const canvas = materializePresentation(plan({ summary: "rNVDA is trading near $204.50.", blocks: [{ id: "market", kind: "metric-strip", title: "Market", span: "full", evidenceIds: ["market"] }] }), new Map([["market", market]]));
  const narrative = deterministicEvidenceNarrative(canvas);
  assert.doesNotMatch(narrative, /^(Key evidence|Caveat|Limitations|Next step|Portfolio implication):/im);
});

test("fresh thread evidence is reusable while stale live market evidence expires", () => {
  const context = emptyPortfolioAnalysisContext();
  context.asOf = "2026-09-29T10:00:00.000Z";
  const current = evidence("current", "reality-fundamentals", "rNVDA");
  current.asOf = "2026-09-29T09:55:00.000Z";
  const stale = evidence("stale", "reality-market", "rNVDA");
  stale.asOf = "2026-09-29T09:58:00.000Z";
  const portfolio = evidence("portfolio", "portfolio-summary", "portfolio");
  portfolio.asOf = context.asOf;
  const canvas = materializePresentation(plan({ blocks: [
    { id: "fundamentals", kind: "comparison-table", title: "Fundamentals", span: "full", evidenceIds: ["current"] },
    { id: "market", kind: "metric-strip", title: "Market", span: "half", evidenceIds: ["stale"] },
    { id: "portfolio", kind: "metric-strip", title: "Portfolio", span: "half", evidenceIds: ["portfolio"] },
  ] }), new Map([["current", current], ["stale", stale], ["portfolio", portfolio]]));
  assert.deepEqual(reusableEvidencePackets(canvas, context, new Date("2026-09-29T10:00:00.000Z").getTime()).map((packet) => packet.id), ["current", "portfolio"]);
});

test("research copy preserves Markdown structure for the rich chat surface", () => {
  const result = selectResearchNarrative("### Summary\n* **NAV:** $10,000\n| Asset | Weight |\n|---|---|\n| rNVDA | 18% |", "", "", false);
  assert.match(result, /^### Summary/);
  assert.match(result, /\* \*\*NAV:\*\* \$10,000/);
  assert.match(result, /\| rNVDA \| 18% \|/);
});
