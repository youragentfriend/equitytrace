export const MAX_PORTFOLIO_HOLDINGS = 25;

export function isWithinLimit(count: number, limit: number) {
  return Number.isInteger(count) && count >= 0 && count <= limit;
}

export function uniqueSymbolsWithinPortfolioLimit(symbols: string[]) {
  const uniqueSymbols = [...new Set(symbols)];
  if (!isWithinLimit(uniqueSymbols.length, MAX_PORTFOLIO_HOLDINGS)) {
    throw new Error(`A portfolio can include up to ${MAX_PORTFOLIO_HOLDINGS} holdings.`);
  }
  return uniqueSymbols;
}
