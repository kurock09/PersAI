import { describe, expect, it } from "vitest";
import type { RuntimeProviderModelProfileState } from "@persai/contracts";
import { applyKnownTokenPricingDefaults } from "./runtime-model-catalog-defaults";

function createTokenMeteredProfile(
  model: string,
  tokenPricing: {
    inputPer1M: number;
    cacheCreationInputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
  }
): RuntimeProviderModelProfileState {
  return {
    model,
    capabilities: ["chat"],
    kind: "cinematic",
    active: true,
    billingMode: "token_metered",
    effectiveFrom: null,
    effectiveTo: null,
    inputTokenWeight: 1,
    cacheWriteInputTokenWeight: 1,
    cachedInputTokenWeight: 1,
    outputTokenWeight: 1,
    maxOutputTokens: null,
    contextWindow: null,
    promptCachePolicy: null,
    displayLabel: null,
    notes: null,
    providerPriceMetadata: {
      currency: "USD",
      tokenPricing
    }
  };
}

describe("applyKnownTokenPricingDefaults", () => {
  it("seeds kimi-k3 published token pricing when draft pricing is unset", () => {
    const profile = createTokenMeteredProfile("kimi-k3", {
      inputPer1M: 0,
      cacheCreationInputPer1M: 0,
      cachedInputPer1M: 0,
      outputPer1M: 0
    });

    const next = applyKnownTokenPricingDefaults(profile);

    expect(next.providerPriceMetadata).toEqual({
      currency: "USD",
      tokenPricing: {
        inputPer1M: 3.0,
        cacheCreationInputPer1M: 0,
        cachedInputPer1M: 0.3,
        outputPer1M: 15.0
      }
    });
  });

  it("does not overwrite customized pricing for a known model key", () => {
    const profile = createTokenMeteredProfile("kimi-k3", {
      inputPer1M: 9,
      cacheCreationInputPer1M: 0,
      cachedInputPer1M: 1,
      outputPer1M: 21
    });

    const next = applyKnownTokenPricingDefaults(profile);

    expect(next).toBe(profile);
  });
});
