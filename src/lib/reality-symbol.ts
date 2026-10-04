export function normalizeRealitySymbol(value: string) {
  const normalized = value.trim().toUpperCase();
  if (/^R[A-Z0-9]+USDT$/.test(normalized)) return normalized;
  if (/^R[A-Z0-9]+$/.test(normalized)) return `${normalized}USDT`;
  if (/^[A-Z][A-Z0-9]{0,9}$/.test(normalized)) return `R${normalized}USDT`;
  return "";
}
