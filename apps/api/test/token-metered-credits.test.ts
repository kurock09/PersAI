import assert from "node:assert/strict";
import {
  applyDerivedTokenMeteredWeights,
  computeTokenMeteredModeCreditMultiplier,
  deriveTokenMeteredWeightsFromPricing
} from "@persai/types";

async function run(): Promise<void> {
  assert.deepEqual(
    deriveTokenMeteredWeightsFromPricing({
      inputPer1M: 2.5,
      cachedInputPer1M: 0.25,
      outputPer1M: 15
    }),
    {
      inputTokenWeight: 2.5,
      cachedInputTokenWeight: 0.25,
      outputTokenWeight: 15
    }
  );

  const mini = deriveTokenMeteredWeightsFromPricing({
    inputPer1M: 0.4,
    cachedInputPer1M: 0.04,
    outputPer1M: 2.4
  });
  const premium = deriveTokenMeteredWeightsFromPricing({
    inputPer1M: 2,
    cachedInputPer1M: 0.2,
    outputPer1M: 12
  });
  const premiumMultiplier = computeTokenMeteredModeCreditMultiplier(premium, mini);
  assert.ok(premiumMultiplier > 4.9 && premiumMultiplier < 5.1);

  const pro = deriveTokenMeteredWeightsFromPricing({
    inputPer1M: 10,
    cachedInputPer1M: 2.5,
    outputPer1M: 120
  });
  const reasoningMultiplier = computeTokenMeteredModeCreditMultiplier(pro, mini);
  assert.ok(reasoningMultiplier > 40 && reasoningMultiplier < 45);

  const derived = applyDerivedTokenMeteredWeights({
    billingMode: "token_metered",
    inputTokenWeight: 9,
    cachedInputTokenWeight: 9,
    outputTokenWeight: 9,
    providerPriceMetadata: {
      currency: "USD",
      tokenPricing: {
        inputPer1M: 4,
        cachedInputPer1M: 1,
        outputPer1M: 16
      }
    }
  });
  assert.equal(derived.inputTokenWeight, 4);
  assert.equal(derived.cachedInputTokenWeight, 1);
  assert.equal(derived.outputTokenWeight, 16);
}

void run()
  .then(() => {
    console.log("token-metered-credits.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
