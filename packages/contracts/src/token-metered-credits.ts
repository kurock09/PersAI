export type TokenMeteredPricing = {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
};

export type TokenMeteredWeights = {
  inputTokenWeight: number;
  cachedInputTokenWeight: number;
  outputTokenWeight: number;
};

/** Typical token mix for comparing mode credit cost (billable input / cached / output). */
export const TOKEN_METERED_REFERENCE_MIX = {
  billableInput: 0.65,
  cachedInput: 0.1,
  output: 0.25
} as const;

export function deriveTokenMeteredWeightsFromPricing(
  tokenPricing: TokenMeteredPricing
): TokenMeteredWeights {
  const inputPer1M = tokenPricing.inputPer1M;
  if (!(inputPer1M > 0)) {
    return {
      inputTokenWeight: 1,
      cachedInputTokenWeight: 1,
      outputTokenWeight: 1
    };
  }
  return {
    inputTokenWeight: 1,
    cachedInputTokenWeight: tokenPricing.cachedInputPer1M / inputPer1M,
    outputTokenWeight: tokenPricing.outputPer1M / inputPer1M
  };
}

export function computeTokenMeteredReferenceIndex(weights: TokenMeteredWeights): number {
  const mix = TOKEN_METERED_REFERENCE_MIX;
  return (
    mix.billableInput * weights.inputTokenWeight +
    mix.cachedInput * weights.cachedInputTokenWeight +
    mix.output * weights.outputTokenWeight
  );
}

export function computeTokenMeteredModeCreditMultiplier(
  modeWeights: TokenMeteredWeights,
  normalWeights: TokenMeteredWeights
): number {
  const normalIndex = computeTokenMeteredReferenceIndex(normalWeights);
  if (!(normalIndex > 0)) {
    return 1;
  }
  return computeTokenMeteredReferenceIndex(modeWeights) / normalIndex;
}

export function formatTokenMeteredWeight(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const rounded = Math.round(value * 10_000) / 10_000;
  return String(rounded);
}

export function formatTokenMeteredCreditMultiplier(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded)}×`;
}

type TokenMeteredWeightCarrier = TokenMeteredWeights & {
  billingMode: string;
  providerPriceMetadata: unknown;
};

export function applyDerivedTokenMeteredWeights<T extends TokenMeteredWeightCarrier>(
  profile: T
): T {
  if (profile.billingMode !== "token_metered") {
    return profile;
  }
  const metadata = profile.providerPriceMetadata;
  if (metadata === null || typeof metadata !== "object" || !("tokenPricing" in metadata)) {
    return profile;
  }
  const tokenPricing = (metadata as { tokenPricing: TokenMeteredPricing }).tokenPricing;
  if (tokenPricing === null || typeof tokenPricing !== "object") {
    return profile;
  }
  return {
    ...profile,
    ...deriveTokenMeteredWeightsFromPricing(tokenPricing)
  };
}
