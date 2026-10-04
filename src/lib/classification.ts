import type { AssetClassification, AssetClass, AssetSector, AssetStyle, AssetTheme } from "./types";

const SEC_API = "https://www.sec.gov";
const SEC_DATA_API = "https://data.sec.gov";
const SEC_CACHE_TTL_MS = 24 * 60 * 60_000;
const CLASSIFICATION_CACHE_TTL_MS = 24 * 60 * 60_000;
const UNCLASSIFIED_CACHE_TTL_MS = 15 * 60_000;
const SEC_CONCURRENCY = 3;

export type ClassificationTarget = { symbol: string; underlying: string; name: string; kind: "EQUITY" | "ETF" };
type SecTickerRecord = { cik: string; name: string; kind: "EQUITY" | "FUND" };
type SecIndex = { tickers: Map<string, SecTickerRecord>; warnings: string[] };
type SecSubmission = { sic?: string; sicDescription?: string; name?: string };
type CacheEntry<T> = { value: T; expiresAt: number };

let secIndexCache: CacheEntry<SecIndex> | null = null;
const submissionCache = new Map<string, Promise<SecSubmission | undefined>>();
const classificationCache = new Map<string, CacheEntry<AssetClassification>>();

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase().replace(/\./g, "-");
}

function cikValue(value: unknown) {
  const raw = stringValue(value).replace(/\D/g, "");
  return raw ? raw.padStart(10, "0") : "";
}

function secHeaders() {
  return {
    Accept: "application/json",
    "User-Agent": process.env.SEC_USER_AGENT?.trim() || "EquityTrace/0.1 (+https://equitytrace.vercel.app/)",
  };
}

async function secJson(path: string, baseUrl = SEC_API, cacheMode: RequestCache = "force-cache"): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: secHeaders(),
    cache: cacheMode,
    ...(cacheMode === "force-cache" ? { next: { revalidate: 86_400 } } : {}),
  } as RequestInit);
  if (!response.ok) throw new Error(`SEC returned HTTP ${response.status} for ${path}`);
  return response.json();
}

function tableRows(value: unknown) {
  const data = recordOf(value);
  const fields = Array.isArray(data.fields) ? data.fields.map(stringValue) : [];
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows.map((row) => {
    if (!Array.isArray(row) || !fields.length) return recordOf(row);
    return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
  });
}

function addTickerRows(target: Map<string, SecTickerRecord>, rows: Record<string, unknown>[], kind: SecTickerRecord["kind"]) {
  for (const row of rows) {
    const ticker = normalizeTicker(stringValue(row.ticker ?? row.symbol));
    const cik = cikValue(row.cik ?? row.cik_str);
    if (!ticker || !cik) continue;
    target.set(ticker, { cik, name: stringValue(row.name), kind });
  }
}

async function loadSecIndex(): Promise<SecIndex> {
  if (secIndexCache && secIndexCache.expiresAt > Date.now()) return secIndexCache.value;
  const warnings: string[] = [];
  const tickers = new Map<string, SecTickerRecord>();
  const responses = await Promise.allSettled([
    secJson("/files/company_tickers_exchange.json"),
    secJson("/files/company_tickers_mf.json"),
  ]);
  const [companies, funds] = responses;
  if (companies.status === "fulfilled") addTickerRows(tickers, tableRows(companies.value), "EQUITY");
  else warnings.push(companies.reason instanceof Error ? companies.reason.message : "SEC company ticker data unavailable.");
  if (funds.status === "fulfilled") addTickerRows(tickers, tableRows(funds.value), "FUND");
  else warnings.push(funds.reason instanceof Error ? funds.reason.message : "SEC mutual-fund ticker data unavailable.");
  if (!tickers.size) throw new Error([...new Set(warnings)].join(" ") || "SEC ticker data unavailable.");
  const value = { tickers, warnings: [...new Set(warnings)] };
  secIndexCache = { value, expiresAt: Date.now() + SEC_CACHE_TTL_MS };
  return value;
}

async function loadSubmission(cik: string) {
  const cached = submissionCache.get(cik);
  if (cached) return cached;
  const request = secJson(`/submissions/CIK${cik}.json`, SEC_DATA_API, "no-store").then((value) => {
    const data = recordOf(value);
    return { sic: stringValue(data.sic), sicDescription: stringValue(data.sicDescription), name: stringValue(data.name) } satisfies SecSubmission;
  }).catch(() => undefined);
  submissionCache.set(cik, request);
  return request;
}

function sicNumber(sic: string) {
  const value = Number(sic);
  return Number.isInteger(value) ? value : undefined;
}

function sectorFromMetadata(industry: string, name: string, sic: string, kind: ClassificationTarget["kind"]): AssetSector {
  const text = `${industry} ${name}`.trim();
  if (kind !== "EQUITY" && /\b(s&p\s*500|sp500|total market|total stock|russell\s*3000|dow jones|nasdaq[- ]?\d+|all[- ]cap|broad market|index fund)\b/i.test(text)) return "Broad Market";
  if (/\b(bank|banking|financial|finance|insurance|capital markets|asset management|credit|mortgage|investment|securities|brokerage)\b|银行|金融|保险|资本市场|资产管理|信贷|抵押/iu.test(text)) return "Finance";
  if (/\b(health|healthcare|health care|pharma|pharmaceutical|biotech|biotechnology|medical|diagnostic|drug|life science|hospital)\b|医疗|医药|制药|生物科技|生物技术|诊断|药品|生命科学|医院/iu.test(text)) return "Healthcare";
  if (/\b(energy|oil|gas|coal|renewable|solar|utilities|electric utility|petroleum)\b|能源|石油|油气|天然气|煤炭|可再生|太阳能|公用事业/iu.test(text)) return "Energy";
  if (/\b(consumer|retail|beverage|food|household|personal product|restaurant|apparel|tobacco|automotive|automobile|motor vehicle|hotel|leisure|mobile home|homebuilding|building materials|lumber)\b|消费|零售|饮料|食品|家庭用品|个人用品|餐饮|服装|烟草|汽车|酒店|休闲|住宅建筑|建筑材料|木材/iu.test(text)) return "Consumer";
  if (/\b(industrial|aerospace|defense|machinery|construction|transportation|railroad|engineering|electrical equipment|aircraft)\b|工业|航空航天|国防|机械|建筑|运输|铁路|工程|电气设备/iu.test(text)) return "Industrials";
  if (/\b(technology|software|internet|cloud|computer|information technology|communication equipment|data processing|electronic|interactive media|online services|search engine|semiconductor|semiconductors|chip|integrated circuit)\b|科技|软件|互联网|云计算|计算机|信息技术|通信设备|数据处理|电子|互动媒体|在线服务|搜索引擎|半导体|芯片/iu.test(text)) return "Technology";

  const code = sicNumber(sic);
  if (code !== undefined) {
    if (code >= 6000 && code <= 6799) return "Finance";
    if ((code >= 2830 && code <= 2836) || (code >= 3840 && code <= 3859)) return "Healthcare";
    if ((code >= 1300 && code <= 1399) || (code >= 2900 && code <= 2999) || (code >= 4900 && code <= 4999)) return "Energy";
    if ((code >= 3570 && code <= 3679) || (code >= 7370 && code <= 7379)) return "Technology";
    if ((code >= 2000 && code <= 2599) || (code >= 5400 && code <= 5999) || (code >= 7000 && code <= 7099)) return "Consumer";
  }
  return "Unclassified";
}

export function classifyAssetMetadata({ industry = "", name = "", sic = "", kind = "EQUITY", secMatched = false }: { industry?: string; name?: string; sic?: string; kind?: ClassificationTarget["kind"]; secMatched?: boolean }): AssetClassification {
  const text = `${industry} ${name}`.trim();
  const themes: AssetTheme[] = /\b(ai|artificial intelligence|semiconductor|semiconductors|chip|chips|integrated circuit)\b|人工智能|半导体|芯片/iu.test(text) ? ["AI & Semiconductors"] : [];
  const styles: AssetStyle[] = kind !== "EQUITY" && /\b(nasdaq|growth|innovation|technology|semiconductor)\b/i.test(text) ? ["Growth"] : [];
  const sector = sectorFromMetadata(industry, name, sic, kind);
  const assetClass: AssetClass = kind === "ETF" ? "ETF" : secMatched && kind !== "EQUITY" ? "FUND" : kind === "EQUITY" ? "EQUITY" : "UNKNOWN";
  return {
    sector,
    assetClass,
    themes,
    styles,
    source: sector === "Unclassified" ? "UNCLASSIFIED" : secMatched ? "SEC" : "BITGET",
    asOf: new Date().toISOString(),
  };
}

async function classifyTarget(target: ClassificationTarget, index: SecIndex): Promise<AssetClassification> {
  const key = normalizeTicker(target.underlying);
  const cached = classificationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const record = index.tickers.get(key);
  const effectiveKind: ClassificationTarget["kind"] = target.kind === "ETF" || /\b(etf|trust|index)\b/i.test(record?.name || "") ? "ETF" : target.kind;
  const submission = record?.kind === "EQUITY" ? await loadSubmission(record.cik) : undefined;
  const classification = classifyAssetMetadata({
    industry: submission?.sicDescription,
    name: submission?.name || record?.name || target.name,
    sic: submission?.sic,
    kind: effectiveKind,
    secMatched: Boolean(record),
  });
  const ttl = classification.sector === "Unclassified" ? UNCLASSIFIED_CACHE_TTL_MS : CLASSIFICATION_CACHE_TTL_MS;
  classificationCache.set(key, { value: classification, expiresAt: Date.now() + ttl });
  return classification;
}

async function withConcurrency<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  async function consume() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => consume()));
  return results;
}

export type DeterministicClassificationResult = { classifications: Map<string, AssetClassification>; warnings: string[] };

export async function fetchDeterministicClassificationMap(targets: ClassificationTarget[]): Promise<DeterministicClassificationResult> {
  const classifications = new Map<string, AssetClassification>();
  const warnings: string[] = [];
  if (!targets.length) return { classifications, warnings };
  let index: SecIndex;
  try {
    index = await loadSecIndex();
    warnings.push(...index.warnings);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "SEC classification data unavailable.");
    index = { tickers: new Map(), warnings: [] };
  }
  const uniqueTargets = [...new Map(targets.map((target) => [target.symbol, target])).values()];
  const results = await withConcurrency(uniqueTargets, SEC_CONCURRENCY, async (target) => [target.symbol, await classifyTarget(target, index)] as const);
  for (const [symbol, classification] of results) classifications.set(symbol, classification);
  return { classifications, warnings: [...new Set(warnings)] };
}
