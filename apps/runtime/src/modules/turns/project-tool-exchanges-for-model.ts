/**
 * ADR-143 / ADR-156 helpers for mode-aware tier windows, plus ADR-161 A1/A2
 * sealed-boundary hashing and per-exchange projection over append-only history.
 *
 * Canonical `toolExchanges` stay full. In-turn provider `toolHistory` is the
 * loop's full sanitized exchanges (no compact-at-insert, no mid-loop micro
 * clear). Cross-turn prior replay uses `prior-tool-exchange-replay.ts`, which
 * projects full below 50% pressure and placeholders older-than-newest-5 at/above
 * 50% of `compactionTriggerThreshold`. Fresh sanitize
 * (`stringifyToolResultPayloadForModel`) remains a separate path.
 */

import type {
  ProviderGatewaySealedToolExchangeBoundary,
  ProviderGatewayToolExchange
} from "@persai/runtime-contract";
import { hashProviderCacheSemanticPrefix } from "@persai/runtime-contract";
import {
  compactOrMaskToolResultContent,
  projectFullToolResultPayload,
  withObservationTierMarker
} from "./tool-observation-compactors";
import {
  assignToolObservationTier,
  type ToolObservationMode,
  type ToolObservationTier
} from "./tool-observation-policy";

/** Serialized tool-call argument cap for model-facing projection (in-turn + cross-turn). */
export const TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS = 600;

export type ProjectToolExchangesForModelOptions = {
  mode?: ToolObservationMode;
};

export type ToolHistoryProjectionMetrics = {
  rawChars: number;
  projectedChars: number;
  fullCount: number;
  compactCount: number;
  maskedCount: number;
};

export type ProjectToolExchangesForModelResult = {
  exchanges: ProviderGatewayToolExchange[];
  metrics: ToolHistoryProjectionMetrics;
};

function readObservationTier(content: string): ToolObservationTier | null {
  try {
    const parsed = JSON.parse(content) as { _observationTier?: unknown };
    const tier = parsed._observationTier;
    if (tier === "full" || tier === "compact" || tier === "masked") {
      return tier;
    }
  } catch {
    // Projected content is always JSON from this module; fall through.
  }
  return null;
}

function emptyProjectionMetrics(): ToolHistoryProjectionMetrics {
  return {
    rawChars: 0,
    projectedChars: 0,
    fullCount: 0,
    compactCount: 0,
    maskedCount: 0
  };
}

/**
 * Derive char/tier metrics from one raw + projected exchange pair.
 * Prefer calling `projectToolExchangesForModelWithMetrics` once at the call site.
 */
export function measureToolHistoryProjection(
  rawExchanges: readonly ProviderGatewayToolExchange[],
  projectedExchanges: readonly ProviderGatewayToolExchange[]
): ToolHistoryProjectionMetrics {
  const metrics = emptyProjectionMetrics();
  for (const exchange of rawExchanges) {
    metrics.rawChars += exchange.toolResult.content.length;
  }
  for (const exchange of projectedExchanges) {
    metrics.projectedChars += exchange.toolResult.content.length;
    const tier = readObservationTier(exchange.toolResult.content);
    if (tier === "full") {
      metrics.fullCount += 1;
    } else if (tier === "compact") {
      metrics.compactCount += 1;
    } else if (tier === "masked") {
      metrics.maskedCount += 1;
    }
  }
  return metrics;
}

export function formatToolHistoryProjectionMetricsLog(input: {
  requestId: string | null | undefined;
  metrics: ToolHistoryProjectionMetrics;
}): string {
  const requestId =
    typeof input.requestId === "string" && input.requestId.trim().length > 0
      ? input.requestId.trim()
      : "unknown";
  const { rawChars, projectedChars, fullCount, compactCount, maskedCount } = input.metrics;
  return `[toolHistoryProjection] requestId=${requestId} rawChars=${String(rawChars)} projectedChars=${String(projectedChars)} fullCount=${String(fullCount)} compactCount=${String(compactCount)} maskedCount=${String(maskedCount)}`;
}

function capToolCallArguments(argumentsValue: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(argumentsValue);
  if (serialized.length <= TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS) {
    return { ...argumentsValue };
  }

  let headLength = Math.max(
    0,
    TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS -
      JSON.stringify({ __truncated_json: "" }).length
  );
  while (headLength >= 0) {
    const omittedChars = serialized.length - headLength;
    const marker = `...[tool arguments truncated: ${String(omittedChars)} chars omitted]`;
    const candidate = {
      __truncated_json: `${serialized.slice(0, headLength)}${marker}`
    };
    if (JSON.stringify(candidate).length <= TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS) {
      return candidate;
    }
    headLength -= 1;
  }

  return {
    __truncated_json: "[tool arguments truncated]"
  };
}

function cloneToolCall(
  toolCall: ProviderGatewayToolExchange["toolCall"]
): ProviderGatewayToolExchange["toolCall"] {
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: capToolCallArguments(toolCall.arguments)
  };
}

export function projectOneToolExchange(
  exchange: ProviderGatewayToolExchange,
  tier: ReturnType<typeof assignToolObservationTier>
): ProviderGatewayToolExchange {
  const toolName = exchange.toolCall.name || exchange.toolResult.name;
  const isError = exchange.toolResult.isError === true;

  let projectedPayload;
  if (tier === "full") {
    projectedPayload = projectFullToolResultPayload(exchange.toolResult.content);
  } else {
    projectedPayload = withObservationTierMarker(
      compactOrMaskToolResultContent({
        toolName,
        content: exchange.toolResult.content,
        isError,
        tier
      }),
      tier
    );
  }

  return {
    toolCall: cloneToolCall(exchange.toolCall),
    toolResult: {
      toolCallId: exchange.toolResult.toolCallId,
      name: exchange.toolResult.name,
      content: JSON.stringify(projectedPayload),
      isError
    },
    ...(typeof exchange.reasoningContent === "string"
      ? { reasoningContent: exchange.reasoningContent }
      : exchange.reasoningContent === null
        ? { reasoningContent: null }
        : {}),
    ...(typeof exchange.assistantText === "string"
      ? { assistantText: exchange.assistantText }
      : exchange.assistantText === null
        ? { assistantText: null }
        : {})
  };
}

/**
 * Project a turn's tool exchanges for the model and return size/tier metrics.
 * Does not mutate `exchanges`. Single-owner path for in-turn observability.
 *
 * ADR-156 applies one global policy with no tool-specific exceptions:
 * in-turn keeps the newest 3 full and next 3 compact; cross-turn retains the
 * ADR-143 newest 1 full and next 4 compact. Older exchanges are masked, while
 * errors never become a bare mask.
 */
export function projectToolExchangesForModelWithMetrics(
  exchanges: readonly ProviderGatewayToolExchange[],
  options?: ProjectToolExchangesForModelOptions
): ProjectToolExchangesForModelResult {
  const mode = options?.mode ?? "cross_turn";
  const exchangeCount = exchanges.length;
  const projected = exchanges.map((exchange, index) => {
    const tier = assignToolObservationTier({
      index,
      exchangeCount,
      isError: exchange.toolResult.isError === true,
      mode
    });
    return projectOneToolExchange(exchange, tier);
  });
  return {
    exchanges: projected,
    metrics: measureToolHistoryProjection(exchanges, projected)
  };
}

/**
 * Project a turn's tool exchanges for the model. Does not mutate `exchanges`.
 */
export function projectToolExchangesForModel(
  exchanges: readonly ProviderGatewayToolExchange[],
  options?: ProjectToolExchangesForModelOptions
): ProviderGatewayToolExchange[] {
  return projectToolExchangesForModelWithMetrics(exchanges, options).exchanges;
}

/**
 * Optional cache-boundary metadata over the latest completed full tool-history
 * prefix. Hash covers full sanitized protocol pairs (ADR-161 A1 append-full).
 */
export function buildSealedToolExchangeBoundary(
  exchanges: readonly ProviderGatewayToolExchange[]
): ProviderGatewaySealedToolExchangeBoundary | null {
  if (exchanges.length === 0) {
    return null;
  }
  const cacheContent = hashProviderCacheSemanticPrefix({
    provider: "persai_sealed_spine",
    serializedPrefix: exchanges
  });
  const priorCacheContent =
    exchanges.length > 1
      ? hashProviderCacheSemanticPrefix({
          provider: "persai_sealed_spine",
          serializedPrefix: exchanges.slice(0, -1)
        })
      : null;
  return {
    exchangeCount: exchanges.length,
    cacheContentHash: cacheContent.hash,
    cacheContentChars: cacheContent.chars,
    priorSealedCacheContentHash: priorCacheContent?.hash ?? null,
    priorSealedCacheContentChars: priorCacheContent?.chars ?? null,
    boundaryKind: "sealed_tool_exchange_spine"
  };
}
