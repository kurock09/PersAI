import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import { projectOneToolExchange } from "./project-tool-exchanges-for-model";

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
    .map((message) => ({
      messageId: message.id,
      // A canonical assistant turn has one immutable compact replay shape.
      // Later turns therefore append history without reprioritizing or
      // evicting an earlier provider-visible tool protocol pair.
      toolExchanges: (message.toolExchanges ?? []).map((exchange) =>
        projectOneToolExchange(exchange, "compact")
      )
    }));

  return new Map(replayTurns.map((turn) => [turn.messageId, turn.toolExchanges] as const));
}
