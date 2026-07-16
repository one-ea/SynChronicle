export function hasKnownPlatformPrice(metadata: unknown, inputPrice: unknown, outputPrice: unknown): boolean {
  const values = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  if (values.priceStatus === "unknown") return false;
  return finitePrice(inputPrice) && finitePrice(outputPrice);
}

function finitePrice(value: unknown): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}
