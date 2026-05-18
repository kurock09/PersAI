const RF_LEGAL_COUNTRY_CODES = new Set(["RU"]);

export type LegalMarket = "rf" | "intl";
export type LegalDocumentKind = "terms" | "privacy";

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function resolveLegalMarket(countryCode: string | null | undefined): LegalMarket {
  const normalized = normalizeCountryCode(countryCode);
  if (normalized && RF_LEGAL_COUNTRY_CODES.has(normalized)) {
    return "rf";
  }
  return "intl";
}

export function resolveLegalDocumentVersion(
  market: LegalMarket,
  documentKind: LegalDocumentKind
): string {
  return `${market}:persai_${documentKind === "terms" ? "tos" : "privacy"}_mvp_v1`;
}
