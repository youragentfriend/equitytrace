import { NextResponse } from "next/server";
import { fetchMarketSnapshot, normalizeRealitySymbol } from "@/lib/bitget";
import { MAX_PORTFOLIO_HOLDINGS } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function requestedSymbols(value: string | null) {
  if (!value) return undefined;
  const symbols = [...new Set(value.split(",").map(normalizeRealitySymbol).filter(Boolean))];
  if (symbols.length > MAX_PORTFOLIO_HOLDINGS) throw new Error(`A portfolio can include up to ${MAX_PORTFOLIO_HOLDINGS} holdings.`);
  return symbols;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const snapshot = await fetchMarketSnapshot(requestedSymbols(url.searchParams.get("symbols")), undefined, undefined, { classifyDynamic: url.searchParams.get("classify") !== "0" });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live Bitget market data is unavailable.";
    return NextResponse.json({ error: message }, { status: message.includes("up to") ? 400 : 502 });
  }
}
