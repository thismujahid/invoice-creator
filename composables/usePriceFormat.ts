const priceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "decimal",
});

export function formatPrice(price: unknown): string {
  if (price === null || price === undefined || price === "") return "0";
  const num = Number(price);
  if (!Number.isFinite(num)) return "0";
  const formatted = priceFormatter.format(num);
  return formatted.replace(/\.00$/, "").replace(/^-0$/, "0");
}

export const usePriceFormat = () => ({ formatPrice });
