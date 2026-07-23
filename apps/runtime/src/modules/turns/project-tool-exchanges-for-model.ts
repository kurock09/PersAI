/**
 * ADR-161 A1/A2 helpers: per-exchange model-facing projection and sealed
 * boundary hashing over append-only tool history.
 *
 * In-turn provider `toolHistory` is the loop's sanitized exchanges after
 * ADR-164 seal/demote (no compact-at-insert, no mid-loop micro clear, no
 * ADR-156 dual-window rewrite). Persisted `toolExchanges` are demoted to
 * spill receipts at turn end when oversized. Cross-turn prior replay uses
 * `prior-tool-exchange-replay.ts`, which projects full below 50% pressure and
 * placeholders older-than-newest-5 at/above 50% of
 * `compactionTriggerThreshold`; spill receipts pass through unchanged.
 * Fresh sanitize (`stringifyToolResultPayloadForModel`) remains a separate path.
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
import { isToolSpillReceiptContent } from "./tool-observation-spill";
import type { ToolObservationTier } from "./tool-observation-policy";

/** Serialized tool-call argument cap for model-facing projection. */
export const TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS = 600;

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

/**
 * Project one exchange to a model-facing tier. Used by hydrate-time micro-clear
 * (`full` / `compact` / `masked` placeholders). Does not mutate `exchange`.
 */
export function projectOneToolExchange(
  exchange: ProviderGatewayToolExchange,
  tier: ToolObservationTier
): ProviderGatewayToolExchange {
  const toolName = exchange.toolCall.name || exchange.toolResult.name;
  const isError = exchange.toolResult.isError === true;
  const rawContent =
    typeof exchange.toolResult.content === "string" ? exchange.toolResult.content : "";

  // ADR-164 P4: persisted spill receipts must stay receipts on prior replay —
  // never re-expand `.tool-spill/` bodies and do not compact/mask away path.
  let projectedContent: string;
  if (isToolSpillReceiptContent(rawContent)) {
    try {
      const receipt = JSON.parse(rawContent) as Record<string, unknown>;
      projectedContent = JSON.stringify(withObservationTierMarker(receipt, tier));
    } catch {
      projectedContent = rawContent;
    }
  } else if (tier === "full") {
    projectedContent = JSON.stringify(projectFullToolResultPayload(rawContent));
  } else {
    projectedContent = JSON.stringify(
      withObservationTierMarker(
        compactOrMaskToolResultContent({
          toolName,
          content: rawContent,
          isError,
          tier
        }),
        tier
      )
    );
  }

  return {
    toolCall: cloneToolCall(exchange.toolCall),
    toolResult: {
      toolCallId: exchange.toolResult.toolCallId,
      name: exchange.toolResult.name,
      content: projectedContent,
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
