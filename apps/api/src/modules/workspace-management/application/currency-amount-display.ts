export function toMajorCurrencyUnits(amountMinor: number | null): number | null {
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) {
    return null;
  }
  return Number((amountMinor / 100).toFixed(amountMinor % 100 === 0 ? 0 : 2));
}

export function formatCurrencyAmountLabel(params: {
  amountMinor: number;
  currency: string;
  locale: string;
}): string {
  return new Intl.NumberFormat(params.locale, {
    style: "currency",
    currency: params.currency,
    maximumFractionDigits: params.amountMinor % 100 === 0 ? 0 : 2
  }).format(params.amountMinor / 100);
}

export function formatPlanPriceLabel(params: {
  amountMinor: number | null;
  currency: string | null;
  billingPeriod: "month" | "year" | null;
  locale: string;
}): string | null {
  if (
    typeof params.amountMinor !== "number" ||
    !Number.isFinite(params.amountMinor) ||
    typeof params.currency !== "string" ||
    params.currency.trim().length === 0 ||
    (params.billingPeriod !== "month" && params.billingPeriod !== "year")
  ) {
    return null;
  }
  const formatted = formatCurrencyAmountLabel({
    amountMinor: params.amountMinor,
    currency: params.currency,
    locale: params.locale
  });
  const suffix =
    params.billingPeriod === "year"
      ? params.locale.startsWith("ru")
        ? " / год"
        : " / year"
      : params.locale.startsWith("ru")
        ? " / месяц"
        : " / month";
  return `${formatted}${suffix}`;
}

export function majorUnitsToAmountMinor(priceMajor: number): number {
  return Math.round(priceMajor * 100);
}
