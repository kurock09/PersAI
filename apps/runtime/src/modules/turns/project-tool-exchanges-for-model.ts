/**
 * ADR-143 / ADR-156 — single owner for model-facing tool observation
 * projection with global mode-aware tier windows.
 *
 * Canonical `toolExchanges` stay full. Provider-facing history (in-turn and
 * cross-turn) must go through `projectToolExchangesForModel` only. Fresh
 * sanitize (`stringifyToolResultPayloadForModel`) remains a separate path.
 */

import type {
  ProviderGatewaySealedToolExchangeBoundary,
  ProviderGatewayToolExchange,
  ProviderGatewayToolObservationOverlay
} from "@persai/runtime-contract";
import { hashProviderCacheSemanticPrefix } from "@persai/runtime-contract";
import {
  compactOrMaskToolResultContent,
  projectFullToolResultPayload,
  withObservationTierMarker
} from "./tool-observation-compactors";
import {
  assignToolObservationTier,
  TOOL_OBSERVATION_IN_TURN_FULL_COUNT,
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

export type SealedToolExchangeSpine = {
  exchanges: ProviderGatewayToolExchange[];
  boundary: ProviderGatewaySealedToolExchangeBoundary | null;
};

export type InTurnToolExchangeProjection = {
  spine: readonly ProviderGatewayToolExchange[];
  overlays: readonly ProviderGatewayToolObservationOverlay[];
  boundary: ProviderGatewaySealedToolExchangeBoundary | null;
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

function buildSealedBoundary(
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

/**
 * D1's in-turn state. Append only completed exchanges: once a compact entry
 * enters `exchanges`, no later overlay/window update can rewrite it.
 */
export function createSealedToolExchangeSpine(): SealedToolExchangeSpine {
  return { exchanges: [], boundary: null };
}

export function appendCompletedToolExchangeToSpine(
  spine: SealedToolExchangeSpine,
  exchange: ProviderGatewayToolExchange,
  assistantText: string | null | undefined = exchange.assistantText
): void {
  if (
    spine.exchanges.some(
      (existing) =>
        existing.toolCall.id === exchange.toolCall.id ||
        existing.toolResult.toolCallId === exchange.toolResult.toolCallId
    )
  ) {
    throw new Error(`Tool exchange "${exchange.toolCall.id}" is already sealed.`);
  }
  spine.exchanges.push(
    projectOneToolExchange(
      {
        ...exchange,
        ...(assistantText === undefined ? {} : { assistantText })
      },
      "compact"
    )
  );
  spine.boundary = buildSealedBoundary(spine.exchanges);
}

/**
 * The only D1 in-turn builder. The compact protocol spine is append-only;
 * newest-three full observations are independent suffix overlays.
 */
export function buildInTurnToolExchangeProjection(
  spine: SealedToolExchangeSpine,
  completedExchanges: readonly ProviderGatewayToolExchange[]
): InTurnToolExchangeProjection {
  if (spine.exchanges.length !== completedExchanges.length) {
    throw new Error(
      `Sealed spine length ${String(spine.exchanges.length)} does not match completed exchange length ${String(completedExchanges.length)}.`
    );
  }
  return {
    spine: spine.exchanges,
    overlays: completedExchanges
      .slice(-TOOL_OBSERVATION_IN_TURN_FULL_COUNT)
      .map((exchange, index, newest) => ({
        ordinal: completedExchanges.length - newest.length + index + 1,
        exchange: projectOneToolExchange(exchange, "full")
      })),
    boundary: spine.boundary
  };
}
