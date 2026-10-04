import { NextResponse } from "next/server";
import { fetchRealityOrderBook, normalizeRealitySymbol } from "@/lib/bitget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = normalizeRealitySymbol(url.searchParams.get("symbol") ?? "");
    if (!symbol) return NextResponse.json({ error: "A valid Reality symbol is required." }, { status: 400 });
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const orderBook = await fetchRealityOrderBook(symbol, Number.isFinite(limit) ? limit : 20);
    return NextResponse.json(orderBook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live Bitget order-book data is unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
