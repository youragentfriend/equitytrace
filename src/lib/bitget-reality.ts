import { fetchRealityTicker } from "./bitget";
import { catalogFromInstrument } from "./catalog";
import { sortDatedEvents } from "./event-order";
import { createRealityRequestScheduler } from "./reality-request-scheduler";
import type {
  PositionOverviewResponse,
  PositionOverviewEvent,
  AssetProfile,
  AssetQuote,
  BitgetInstrument,
  BitgetStockInfo,
  BitgetTicker,
  FinancialReport,
  OwnershipSnapshot,
  ValuationSnapshot,
} from "./types";

const BITGET_API = "https://api.bitget.com";
const PUBLIC_CACHE_TTL_MS = 5 * 60_000;
const PUBLIC_RATE_INTERVAL_MS = 1_050;
const ETF_SYMBOLS = new Set(["ARKK", "DIA", "GLD", "IWM", "IVV", "QQQ", "SPY", "TLT", "VOO", "VTI", "VUG"]);

type PublicTarget = {
  symbol: string;
  token: string;
  underlying: string;
  name: string;
  kind: "EQUITY" | "ETF";
  tradingPeriod?: string[];
  ticker?: BitgetTicker;
};

type PublicResponse = Record<string, unknown>;
type CacheEntry = { expiresAt: number; value: PublicResponse };
const publicCache = new Map<string, CacheEntry>();
const schedulePublicRequest = createRealityRequestScheduler(PUBLIC_RATE_INTERVAL_MS);

function recordOf(value: unknown): PublicResponse {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PublicResponse : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ratioPercentValue(value: unknown) {
  const parsed = numberValue(value);
  if (parsed === undefined) return undefined;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function dateValue(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return undefined;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{12,}$/.test(raw)) {
    const parsed = new Date(Number(raw));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function hasValues(value: Record<string, unknown>) {
  return Object.values(value).some((item) => item !== undefined && item !== "");
}

function rows(response: PublicResponse | undefined) {
  return Array.isArray(response?.list) ? response.list.map(recordOf) : [];
}

function displayNumber(value: unknown) {
  const number = numberValue(value);
  return number === undefined ? "" : number.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function displayDate(value: unknown) {
  return dateValue(value) ?? "";
}

function eventDetail(parts: Array<string | undefined>) {
  const detail = parts.filter(Boolean).join(" · ");
  return detail || undefined;
}

async function publicJson(path: string): Promise<PublicResponse> {
  const cached = publicCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return schedulePublicRequest(path, async () => {
    const response = await fetch(`${BITGET_API}${path}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Bitget Reality API returned HTTP ${response.status}`);
    const body = recordOf(await response.json());
    if (body.code !== "00000") throw new Error(`Bitget Reality API rejected ${path}: ${stringValue(body.msg) || "unknown error"}`);
    const data = recordOf(body.data);
    publicCache.set(path, { expiresAt: Date.now() + PUBLIC_CACHE_TTL_MS, value: data });
    return data;
  });
}

function baseResponse(target: PublicTarget, timestamp: string): Pick<PositionOverviewResponse, "symbol" | "token" | "underlyingSymbol" | "name" | "kind" | "source" | "asOf"> {
  return { symbol: target.symbol, token: target.token, underlyingSymbol: target.underlying, name: target.name, kind: target.kind, source: "Bitget public Reality REST", asOf: timestamp };
}

function makeReport(earnings: PublicResponse): FinancialReport | undefined {
  if (!hasValues(earnings)) return undefined;
  const report: FinancialReport = {
    period: stringValue(earnings.fiscalYear) || undefined,
    announcementDate: displayDate(earnings.publicationDeadline) || undefined,
    isActual: typeof earnings.isActual === "boolean" ? earnings.isActual : undefined,
    revenue: numberValue(earnings.revenue),
    ebit: numberValue(earnings.ebit),
    operatingIncome: numberValue(earnings.ebit),
    netIncome: numberValue(earnings.netIncomeParent),
    eps: numberValue(earnings.eps),
    roe: ratioPercentValue(earnings.roe),
  };
  return hasValues(report as Record<string, unknown>) ? report : undefined;
}

function makeOwnership(insiderRows: PublicResponse[], executiveRows: PublicResponse[], majorRows: PublicResponse[]): OwnershipSnapshot | undefined {
  const major = majorRows[0];
  const ownership: OwnershipSnapshot = {
    insiderTradeCount: insiderRows.length,
    executiveHolderCount: executiveRows.length,
    majorHolderCount: majorRows.length,
    majorHolder: stringValue(major?.name),
  };
  return hasValues(ownership as Record<string, unknown>) ? ownership : undefined;
}

export function buildRealityEvents(responses: ReadonlyMap<string, PublicResponse>): PositionOverviewEvent[] {
  const events: PositionOverviewEvent[] = [];
  const earnings = responses.get("earnings") ?? {};
  const earningsDate = displayDate(earnings.publicationDeadline);
  if (earningsDate) {
    events.push({
      type: "EARNINGS",
      label: earnings.isActual === true ? "Reported earnings" : "Earnings forecast",
      date: earningsDate,
      detail: eventDetail([earnings.fiscalYear ? `FY ${stringValue(earnings.fiscalYear)}` : undefined, earnings.eps ? `EPS ${stringValue(earnings.eps)}` : undefined]),
    });
  }

  for (const dividend of rows(responses.get("dividends")).slice(0, 5)) {
    const split = stringValue(dividend.splitValidDate) || stringValue(dividend.splitNumerator) || stringValue(dividend.splitDenominator);
    const isSplit = Boolean(split) || /split/i.test(stringValue(dividend.type));
    const date = displayDate(dividend.dividendDate || dividend.exrightDate || dividend.announcementDate);
    if (!date) continue;
    events.push({
      type: isSplit ? "SPLIT" : "DIVIDEND",
      label: isSplit ? "Stock split" : "Dividend",
      date,
      detail: isSplit
        ? eventDetail([stringValue(dividend.splitNumerator) && stringValue(dividend.splitDenominator) ? `${stringValue(dividend.splitNumerator)}:${stringValue(dividend.splitDenominator)}` : undefined])
        : eventDetail([numberValue(dividend.dividendPerShare) !== undefined ? `$${displayNumber(dividend.dividendPerShare)} per share` : undefined, displayDate(dividend.dividendDate) ? `Payment ${displayDate(dividend.dividendDate)}` : undefined]),
    });
  }

  const suspension = responses.get("suspension") ?? {};
  const suspensionDate = displayDate(suspension.suspensionDate);
  if (suspensionDate) events.push({ type: "SUSPENSION", label: "Trading suspension", date: suspensionDate, detail: stringValue(suspension.suspensionReason) || undefined });
  const resumptionDate = displayDate(suspension.resumptionDate);
  if (resumptionDate) events.push({ type: "RESUMPTION", label: "Trading resumption", date: resumptionDate, detail: stringValue(suspension.resumptionTradingTime) ? `Trading ${stringValue(suspension.resumptionTradingTime)}` : undefined });

  const capital = responses.get("shareCapital") ?? {};
  const capitalDate = displayDate(capital.changeDate || capital.announcementDate);
  if (capitalDate) events.push({ type: "SHARE_CAPITAL", label: "Share-capital change", date: capitalDate, detail: eventDetail([stringValue(capital.changeReason), capital.totalShares ? `${displayNumber(capital.totalShares)} total shares` : undefined]) });

  return sortDatedEvents(events);
}

export async function fetchPublicPositionOverview(target: PublicTarget, mode: "asset" | "news"): Promise<PositionOverviewResponse> {
  const timestamp = new Date().toISOString();
  const warnings: string[] = [];
  const responses = new Map<string, PublicResponse>();
  const paths: Array<[string, string]> = mode === "asset"
    ? [
      ["overview", `/api/v3/reality/market/company-overview?code=${encodeURIComponent(target.underlying)}`],
      ["valuation", `/api/v3/reality/market/valuation-indicators?code=${encodeURIComponent(target.underlying)}`],
      ["earnings", `/api/v3/reality/market/earnings-forecast?code=${encodeURIComponent(target.underlying)}`],
      ["insider", `/api/v3/reality/market/inner-trades?code=${encodeURIComponent(target.underlying)}&limit=3`],
      ["executive", `/api/v3/reality/market/executive-shareholdings?code=${encodeURIComponent(target.underlying)}&limit=3`],
      ["major", `/api/v3/reality/market/sharehold-detail?code=${encodeURIComponent(target.underlying)}&limit=3`],
    ]
    : [
      ["earnings", `/api/v3/reality/market/earnings-forecast?code=${encodeURIComponent(target.underlying)}`],
      ["dividends", `/api/v3/reality/market/dividends?code=${encodeURIComponent(target.underlying)}&limit=5`],
      ["suspension", `/api/v3/reality/market/suspension-resumption-info?code=${encodeURIComponent(target.underlying)}`],
      ["shareCapital", `/api/v3/reality/market/share-capital-change?code=${encodeURIComponent(target.underlying)}`],
    ];

  await Promise.all(paths.map(async ([key, path]) => {
    try {
      responses.set(key, await publicJson(path));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `${key} data unavailable.`);
    }
  }));

  const overview = responses.get("overview") ?? {};
  const valuationRow = responses.get("valuation") ?? {};
  const earnings = responses.get("earnings") ?? {};
  const profile: AssetProfile = {
    company: stringValue(overview.name) || target.name,
    tradingPeriod: target.tradingPeriod,
  };
  const quote: AssetQuote = {
    lastPrice: numberValue(target.ticker?.lastPrice),
    changePercent: numberValue(target.ticker?.price24hPcnt),
    volume: numberValue(target.ticker?.volume24h),
    high52Week: numberValue(overview.high52Week),
    low52Week: numberValue(overview.low52Week),
    totalMarketCap: numberValue(overview.marketCap),
    pb: numberValue(overview.pbRatio),
  };
  const valuation: ValuationSnapshot = {
    pe: numberValue(valuationRow.pe),
    peTtm: numberValue(valuationRow.peTtmEd ?? valuationRow.peTtmPd),
    pb: numberValue(valuationRow.pbEd ?? valuationRow.pb),
    ps: numberValue(valuationRow.psTtmEd ?? valuationRow.ps),
    pcf: numberValue(valuationRow.pcfTtmEd ?? valuationRow.pcf),
    evEbitda: numberValue(valuationRow.evEbitda),
    marketCap: numberValue(valuationRow.tmvUsd) ?? quote.totalMarketCap,
    dividendYield: numberValue(valuationRow.dividendYieldTtm),
  };
  const report = makeReport(earnings);
  const ownership = target.kind === "EQUITY" ? makeOwnership(rows(responses.get("insider")), rows(responses.get("executive")), rows(responses.get("major"))) : undefined;
  const events = mode === "news" ? buildRealityEvents(responses) : undefined;
  return {
    ...baseResponse(target, timestamp),
    status: !responses.size && !target.ticker ? "UNAVAILABLE" : warnings.length ? "PARTIAL" : "LIVE",
    warnings: [...new Set(warnings)],
    events,
    profile: hasValues(profile as Record<string, unknown>) ? profile : undefined,
    quote: hasValues(quote as Record<string, unknown>) ? quote : undefined,
    report,
    valuation: hasValues(valuation as Record<string, unknown>) ? valuation : undefined,
    ownership,
  };
}

type PositionOverviewArgs = { symbol: string; instruments: BitgetInstrument[]; stockInfo: BitgetStockInfo[]; mode?: "asset" | "news" };

export async function fetchPositionOverview({ symbol, instruments, stockInfo, mode = "asset" }: PositionOverviewArgs): Promise<PositionOverviewResponse> {
  const instrument = instruments.find((candidate) => candidate.symbol === symbol);
  const info = stockInfo.find((candidate) => candidate.symbol === symbol);
  const catalog = instrument ? catalogFromInstrument(instrument, info) : undefined;
  const underlying = (info?.code || instrument?.baseCoin || symbol.replace(/^R/i, "").replace(/USDT$/i, "")).replace(/^r/i, "").toUpperCase();
  const target: PublicTarget = {
    symbol,
    token: catalog?.token || symbol.replace(/USDT$/i, ""),
    underlying,
    name: info?.name || catalog?.name || `${underlying} Reality instrument`,
    kind: ETF_SYMBOLS.has(underlying) || /\b(etf|trust|index)\b/i.test(info?.name || catalog?.name || "") ? "ETF" : "EQUITY",
    tradingPeriod: info?.tradingPeriod,
  };
  try {
    target.ticker = await fetchRealityTicker(symbol);
  } catch {
    // Detailed Reality endpoints can still provide a partial response without a live ticker.
  }
  return fetchPublicPositionOverview(target, mode);
}
