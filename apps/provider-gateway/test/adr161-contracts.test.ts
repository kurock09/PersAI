import assert from "node:assert/strict";
import {
  assertFixedFamilyCacheLoop,
  assertReusableSealedBoundary,
  calculateTextGenerationCacheCostComparison,
  decodeTextGenerationUsageMixedVersion,
  hashProviderCacheSemanticPrefix,
  normalizeProviderTextGenerationUsageV2,
  type TextGenerationCacheZoneTelemetry
} from "@persai/runtime-contract";

const metadata = {
  modelKey: "fixture-model",
  stepType: "main_turn",
  modelRole: "normal_reply" as const
} as const;

function sealedTelemetry(params: {
  cacheContentHash: string;
  sealedSpineHash: string;
  priorSealedBoundaryHash: string | null;
  iteration?: number;
}): TextGenerationCacheZoneTelemetry {
  return {
    requestClassification: "main_turn",
    toolLoopIteration: params.iteration ?? 1,
    providerKey: "openai",
    modelKey: "fixture-model",
    stableSystemHash: "stable",
    stableSystemChars: 10,
    hydratedHistoryHash: "history",
    hydratedHistoryChars: 20,
    cacheContentHash: params.cacheContentHash,
    cacheContentChars: 30,
    sealedSpineHash: params.sealedSpineHash,
    sealedSpineChars: 30,
    priorSealedBoundaryHash: params.priorSealedBoundaryHash,
    sealedBoundaryKind: "sealed_spine",
    toolProjectionFamilyHash: "tools",
    toolProjectionChars: 40,
    toolCount: 1,
    catalogToolCount: 0,
    fullToolCount: 1,
    projectionReasons: ["bundle_baseline"],
    volatileContextChars: 0,
    developerTailChars: 0,
    cachePolicyMode: "explicit",
    cacheKeyHash: "key",
    cacheBreakpointCount: 2
  };
}

export async function runAdr161ContractsTest(): Promise<void> {
  const semanticPrefix = {
    messages: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: '<persai_tool_exchange_boundary ordinal="000001"/>',
            prompt_cache_breakpoint: { mode: "explicit" }
          }
        ]
      }
    ]
  };
  const movedBreakpoint = {
    messages: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: '<persai_tool_exchange_boundary ordinal="000001"/>'
          }
        ]
      }
    ],
    prompt_cache_options: { mode: "explicit", ttl: "30m" }
  };
  const semanticHash = hashProviderCacheSemanticPrefix({
    provider: "openai",
    serializedPrefix: semanticPrefix
  });
  assert.equal(
    semanticHash.hash,
    hashProviderCacheSemanticPrefix({
      provider: "openai",
      serializedPrefix: movedBreakpoint
    }).hash,
    "cache controls must not change provider semantic-prefix identity"
  );
  assert.notEqual(
    semanticHash.hash,
    hashProviderCacheSemanticPrefix({
      provider: "openai",
      serializedPrefix: {
        ...semanticPrefix,
        messages: [
          {
            ...semanticPrefix.messages[0],
            content: [
              {
                type: "input_text",
                text: '<persai_tool_exchange_boundary ordinal="000002"/>'
              }
            ]
          }
        ]
      }
    }).hash,
    "model-visible boundary marker content remains semantic"
  );

  const openai = normalizeProviderTextGenerationUsageV2({
    providerKey: "openai",
    ...metadata,
    responseUsage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      cache_write_tokens: 10,
      input_tokens_details: { cached_tokens: 60 }
    },
    promptCachePolicy: {
      mode: "explicit",
      ttl: "30m",
      stableAnchor: "explicit",
      sealedSpineBreakpoint: "explicit"
    }
  });

  assert.deepEqual(
    normalizeProviderTextGenerationUsageV2({
      providerKey: "openai",
      ...metadata,
      responseUsage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 }
      },
      promptCachePolicy: {
        mode: "explicit",
        ttl: "30m",
        stableAnchor: "explicit",
        sealedSpineBreakpoint: "explicit"
      }
    }),
    { status: "usage_unavailable", reason: "provider_usage_component_missing" }
  );

  assert.equal(
    normalizeProviderTextGenerationUsageV2({
      providerKey: "openai",
      ...metadata,
      responseUsage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 60 }
      },
      promptCachePolicy: { mode: "automatic", retention: "24h" }
    }).status,
    "accounted"
  );
  assert.deepEqual(
    normalizeProviderTextGenerationUsageV2({
      providerKey: "openai",
      ...metadata,
      responseUsage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120
      },
      promptCachePolicy: null
    }),
    {
      status: "accounted",
      entry: {
        schemaVersion: 2,
        ...metadata,
        providerKey: "openai",
        totalInputTokens: 100,
        uncachedInputTokens: 100,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 20,
        totalTokens: 120
      }
    }
  );
  assert.deepEqual(openai, {
    status: "accounted",
    entry: {
      schemaVersion: 2,
      ...metadata,
      providerKey: "openai",
      totalInputTokens: 100,
      uncachedInputTokens: 30,
      cacheWriteInputTokens: 10,
      cacheReadInputTokens: 60,
      outputTokens: 20,
      totalTokens: 120
    }
  });

  const deepseek = normalizeProviderTextGenerationUsageV2({
    providerKey: "deepseek",
    ...metadata,
    responseUsage: {
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 70,
      prompt_cache_miss_tokens: 30,
      completion_tokens: 20,
      total_tokens: 120
    }
  });
  assert.equal(deepseek.status, "accounted");
  assert.equal(deepseek.status === "accounted" ? deepseek.entry.cacheReadInputTokens : null, 70);

  const anthropic = normalizeProviderTextGenerationUsageV2({
    providerKey: "anthropic",
    ...metadata,
    responseUsage: {
      input_tokens: 30,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 60,
      output_tokens: 20
    }
  });
  assert.equal(anthropic.status, "accounted");
  assert.equal(anthropic.status === "accounted" ? anthropic.entry.totalTokens : null, 120);

  const mismatch = normalizeProviderTextGenerationUsageV2({
    providerKey: "deepseek",
    ...metadata,
    responseUsage: {
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 70,
      prompt_cache_miss_tokens: 20,
      completion_tokens: 20,
      total_tokens: 120
    }
  });
  assert.deepEqual(mismatch, {
    status: "usage_mismatch",
    reason: "input_token_partition_mismatch"
  });

  assert.throws(
    () => decodeTextGenerationUsageMixedVersion({ schemaVersion: 3, usage: [] }),
    /text_generation_usage_unknown_schema_version/
  );
  assert.equal(
    decodeTextGenerationUsageMixedVersion({
      usage: {
        inputTokens: 1,
        cacheCreationInputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1,
        totalTokens: 2,
        entries: []
      }
    }).schemaVersion,
    1
  );
  assert.throws(
    () =>
      decodeTextGenerationUsageMixedVersion({
        schemaVersion: 2,
        usage: [
          {
            schemaVersion: 2,
            stepType: "main_turn",
            modelRole: "normal_reply",
            providerKey: "openai",
            modelKey: "",
            totalInputTokens: 100,
            uncachedInputTokens: 30,
            cacheWriteInputTokens: 10,
            cacheReadInputTokens: 60,
            outputTokens: 20,
            totalTokens: 120
          }
        ]
      }),
    /text_generation_usage_v2_model_key_invalid/
  );
  assert.throws(
    () =>
      decodeTextGenerationUsageMixedVersion({
        schemaVersion: 2,
        usage: [
          {
            schemaVersion: 2,
            stepType: "main_turn",
            modelRole: "normal_reply",
            providerKey: "unknown",
            modelKey: "fixture-model",
            totalInputTokens: 100,
            uncachedInputTokens: 30,
            cacheWriteInputTokens: 10,
            cacheReadInputTokens: 60,
            outputTokens: 20,
            totalTokens: 120
          }
        ]
      }),
    /text_generation_usage_v2_provider_key_invalid/
  );

  const accounting =
    openai.status === "accounted" ? openai.entry : assert.fail("OpenAI fixture failed");
  assert.deepEqual(
    calculateTextGenerationCacheCostComparison(accounting, {
      inputPer1M: 10,
      cacheWriteInputPer1M: 12.5,
      cacheReadInputPer1M: 1
    }),
    {
      noCacheInputCost: 0.001,
      actualCachedInputCost: 0.000485,
      netCacheSavings: 0.000515,
      netCacheSavingsPercent: 0.515
    }
  );

  const prior = sealedTelemetry({
    cacheContentHash: "full-spine-through-1",
    sealedSpineHash: "sealed-boundary-1",
    priorSealedBoundaryHash: null
  });
  assert.equal(prior.requestClassification, "main_turn");
  assert.equal(prior.providerKey, "openai");
  const next = sealedTelemetry({
    cacheContentHash: "full-spine-through-2",
    sealedSpineHash: "sealed-boundary-2",
    priorSealedBoundaryHash: "sealed-boundary-1",
    iteration: 2
  });
  assertReusableSealedBoundary({
    priorSealedSpineHash: prior.sealedSpineHash,
    nextPriorSealedBoundaryHash: next.priorSealedBoundaryHash,
    priorSealedBoundaryKind: prior.sealedBoundaryKind
  });
  assert.throws(
    () =>
      assertReusableSealedBoundary({
        priorSealedSpineHash: prior.sealedSpineHash,
        nextPriorSealedBoundaryHash: "rewritten",
        priorSealedBoundaryKind: prior.sealedBoundaryKind
      }),
    /sealed_boundary_not_reused/
  );

  const loopResult = assertFixedFamilyCacheLoop(
    Array.from({ length: 50 }, (_, index) => ({
      telemetry: sealedTelemetry({
        cacheContentHash: `full-spine-through-${String(index + 1)}`,
        sealedSpineHash: `sealed-boundary-${String(index + 1)}`,
        priorSealedBoundaryHash: index === 0 ? null : `sealed-boundary-${String(index)}`,
        iteration: index + 1
      }),
      usage: {
        ...accounting,
        stepType: "tool_loop_followup",
        totalInputTokens: 100,
        uncachedInputTokens: 30,
        cacheWriteInputTokens: 10,
        cacheReadInputTokens: 60,
        outputTokens: 20,
        totalTokens: 120
      }
    })),
    {
      inputPer1M: 10,
      cacheWriteInputPer1M: 12.5,
      cacheReadInputPer1M: 1
    }
  );
  assert.ok(loopResult.netCacheSavings > 0);
}
