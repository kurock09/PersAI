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
      // ADR-161 A1: prior turns replay full sanitized protocol pairs.
      // A2 will later placeholder older results (keep last 5); A1 must not
      // leave always-compact projection on this path.
      toolExchanges: (message.toolExchanges ?? []).map((exchange) =>
        projectOneToolExchange(exchange, "full")
      )
    }));

  return new Map(replayTurns.map((turn) => [turn.messageId, turn.toolExchanges] as const));
}
