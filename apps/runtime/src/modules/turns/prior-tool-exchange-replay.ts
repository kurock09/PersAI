import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import { projectToolExchangesForModel } from "./project-tool-exchanges-for-model";
import { estimateProviderGatewayMessageTokens } from "./runtime-context-hydration-policy";

export const PRIOR_TOOL_REPLAY_MAX_TURNS = 3;
export const PRIOR_TOOL_REPLAY_TOTAL_BUDGET_TOKENS = 2_000;

export interface PriorToolExchangeReplayMessage {
  id: string;
  author: "user" | "assistant" | "system";
  toolExchanges?: readonly ProviderGatewayToolExchange[] | null;
}

export function buildPriorToolExchangeReplayMap(
  messages: readonly PriorToolExchangeReplayMessage[],
  currentInboundMessageId: string
): Map<string, ProviderGatewayToolExchange[]> {
  const currentInboundIndex = messages.findIndex(
    (message) => message.id === currentInboundMessageId
  );
  const history = currentInboundIndex >= 0 ? messages.slice(0, currentInboundIndex) : messages;
  const replayTurns = history
    .filter((message) => message.author === "assistant" && (message.toolExchanges?.length ?? 0) > 0)
    .slice(-PRIOR_TOOL_REPLAY_MAX_TURNS)
    .map((message) => ({
      messageId: message.id,
      toolExchanges: projectToolExchangesForModel(message.toolExchanges ?? [], {
        mode: "cross_turn"
      })
    }));

  while (
    replayTurns.length > 0 &&
    estimateReplayWindowTokens(replayTurns.map((turn) => turn.toolExchanges)) >
      PRIOR_TOOL_REPLAY_TOTAL_BUDGET_TOKENS
  ) {
    replayTurns.shift();
  }

  return new Map(replayTurns.map((turn) => [turn.messageId, turn.toolExchanges] as const));
}

function estimateReplayWindowTokens(
  toolExchangesByTurn: readonly ProviderGatewayToolExchange[][]
): number {
  return toolExchangesByTurn.reduce((total, toolExchanges) => {
    return (
      total +
      estimateProviderGatewayMessageTokens({
        role: "assistant",
        content: JSON.stringify(toolExchanges)
      })
    );
  }, 0);
}
