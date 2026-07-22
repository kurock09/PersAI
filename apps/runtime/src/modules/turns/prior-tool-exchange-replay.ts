import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import { projectOneToolExchange } from "./project-tool-exchanges-for-model";
import {
  assignMicroClearObservationTier,
  shouldApplyToolObservationMicroClear
} from "./tool-observation-policy";

export interface PriorToolExchangeReplayMessage {
  id: string;
  author: "user" | "assistant" | "system";
  toolExchanges?: readonly ProviderGatewayToolExchange[] | null;
}

export type PriorToolExchangeReplayPressure = {
  priorToolMicroClearActive?: boolean | null | undefined;
  priorToolMicroClearNextArmPercent?: number | null | undefined;
  currentTokens: number | null | undefined;
  totalTokensFresh: boolean | null | undefined;
  compactionTriggerThreshold: number;
};

/**
 * Build model-facing prior tool-exchange replay for hydration.
 *
 * ADR-161 A1/A2: canonical storage stays full. Below 50% pressure (or when
 * tokens are not fresh), every retained exchange projects full. At/above 50%
 * of `compactionTriggerThreshold`, only the newest 5 full results remain;
 * older bodies become placeholders. Once active, clear stays on (no meter
 * re-expand); next arm uses 50%→75%→exhausted hysteresis. Projection is
 * hydrate-time / next-turn facing — never applied to in-turn `toolHistory`.
 */
export function buildPriorToolExchangeReplayMap(
  messages: readonly PriorToolExchangeReplayMessage[],
  currentInboundMessageId: string,
  pressure?: PriorToolExchangeReplayPressure | null
): Map<string, ProviderGatewayToolExchange[]> {
  const currentInboundIndex = messages.findIndex(
    (message) => message.id === currentInboundMessageId
  );
  const history = currentInboundIndex >= 0 ? messages.slice(0, currentInboundIndex) : messages;
  const replayTurns = history
    .filter((message) => message.author === "assistant" && (message.toolExchanges?.length ?? 0) > 0)
    .map((message) => ({
      messageId: message.id,
      toolExchanges: [...(message.toolExchanges ?? [])]
    }));

  const chronological: Array<{
    messageId: string;
    exchange: ProviderGatewayToolExchange;
    index: number;
  }> = [];
  for (const turn of replayTurns) {
    for (const exchange of turn.toolExchanges) {
      chronological.push({
        messageId: turn.messageId,
        exchange,
        index: chronological.length
      });
    }
  }

  const applyMicroClear =
    pressure != null &&
    shouldApplyToolObservationMicroClear({
      priorToolMicroClearActive: pressure.priorToolMicroClearActive,
      priorToolMicroClearNextArmPercent: pressure.priorToolMicroClearNextArmPercent,
      currentTokens: pressure.currentTokens,
      totalTokensFresh: pressure.totalTokensFresh,
      compactionTriggerThreshold: pressure.compactionTriggerThreshold
    });
  const exchangeCount = chronological.length;
  const projectedByMessageId = new Map<string, ProviderGatewayToolExchange[]>();

  for (const item of chronological) {
    const tier = applyMicroClear
      ? assignMicroClearObservationTier({
          index: item.index,
          exchangeCount,
          isError: item.exchange.toolResult.isError === true
        })
      : "full";
    const projected = projectOneToolExchange(item.exchange, tier);
    const existing = projectedByMessageId.get(item.messageId);
    if (existing === undefined) {
      projectedByMessageId.set(item.messageId, [projected]);
    } else {
      existing.push(projected);
    }
  }

  return projectedByMessageId;
}
