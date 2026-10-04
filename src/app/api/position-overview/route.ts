import { NextResponse } from "next/server";
import { fetchRealityInstruments, fetchRealityStockInfo, normalizeRealitySymbol } from "@/lib/bitget";
import { fetchPositionOverview } from "@/lib/bitget-reality";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const positionOverviewRequestSchema = z.object({
  symbol: z.string().regex(/^R[A-Z0-9]+USDT$/),
  mode: z.enum(["asset", "news"]).default("asset"),
});

export async function POST(request: Request) {
  try {
    const input = positionOverviewRequestSchema.parse(await request.json());
    const symbol = normalizeRealitySymbol(input.symbol);
    const [instruments, stockInfo] = await Promise.all([
      fetchRealityInstruments(),
      fetchRealityStockInfo().catch(() => []),
    ]);
    const positionOverviewData = await fetchPositionOverview({ symbol, instruments, stockInfo, mode: input.mode });
    return NextResponse.json(positionOverviewData, { status: positionOverviewData.status === "UNAVAILABLE" ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Position Overview request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
