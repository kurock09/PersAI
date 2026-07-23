import type { RuntimeProviderModelProfileState } from "@persai/contracts";

/**
 * Mirrors `MODEL_TOKEN_PRICING_DEFAULTS` in
 * `apps/api/.../runtime-provider-profile.ts` for Admin catalog draft seeding.
 */
export const MODEL_TOKEN_PRICING_DEFAULTS: Partial<
  Record<
    string,
    {
      inputPer1M: number;
      cacheCreationInputPer1M: number;
      cachedInputPer1M: number;
      outputPer1M: number;
    }
  >
> = {
  "kimi-k3": {
    inputPer1M: 3.0,
    cacheCreationInputPer1M: 0,
    cachedInputPer1M: 0.3,
    outputPer1M: 15.0
  }
};

function isUnsetTokenPricing(tokenPricing: {
  inputPer1M: number;
  cacheCreationInputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}): boolean {
  return (
    tokenPricing.inputPer1M === 0 &&
    tokenPricing.cacheCreationInputPer1M === 0 &&
    tokenPricing.cachedInputPer1M === 0 &&
    tokenPricing.outputPer1M === 0
  );
}

export function applyKnownTokenPricingDefaults(
  profile: RuntimeProviderModelProfileState
): RuntimeProviderModelProfileState {
  if (profile.billingMode !== "token_metered") {
    return profile;
  }

  const modelKey = profile.model.trim();
  const pricingDefaults = MODEL_TOKEN_PRICING_DEFAULTS[modelKey];
  if (!pricingDefaults) {
    return profile;
  }

  const currentPricing = profile.providerPriceMetadata.tokenPricing;
  if (!isUnsetTokenPricing(currentPricing)) {
    return profile;
  }

  return {
    ...profile,
    providerPriceMetadata: {
      currency: profile.providerPriceMetadata.currency,
      tokenPricing: { ...pricingDefaults }
    }
  };
}
