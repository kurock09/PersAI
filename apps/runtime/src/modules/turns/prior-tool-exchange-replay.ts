import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import { estimateProviderGatewayMessageTokens } from "./runtime-context-hydration-policy";
import { isLikelyBinaryContent } from "./sanitize-tool-result-for-model";

export const PRIOR_TOOL_REPLAY_MAX_TURNS = 3;
export const PRIOR_TOOL_REPLAY_TOTAL_BUDGET_TOKENS = 2_000;
export const PRIOR_TOOL_RESULT_MAX_CHARS = 2_000;
export const PRIOR_TOOL_ARGUMENTS_MAX_SERIALIZED_CHARS = 600;

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
      toolExchanges: (message.toolExchanges ?? []).map(capProviderGatewayToolExchange)
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

function capProviderGatewayToolExchange(
  exchange: ProviderGatewayToolExchange
): ProviderGatewayToolExchange {
  return {
    toolCall: {
      ...exchange.toolCall,
      arguments: capToolCallArguments(exchange.toolCall.arguments)
    },
    toolResult: {
      ...exchange.toolResult,
      content: capToolResultContent(exchange.toolResult.content)
    },
    ...(typeof exchange.reasoningContent === "string"
      ? { reasoningContent: exchange.reasoningContent }
      : {})
  };
}

function capToolResultContent(content: string): string {
  if (isLikelyBinaryContent(content)) {
    return "[binary content omitted]";
  }
  if (content.length <= PRIOR_TOOL_RESULT_MAX_CHARS) {
    return content;
  }
  const omittedChars = content.length - PRIOR_TOOL_RESULT_MAX_CHARS;
  return (
    `[tool result truncated: ${String(omittedChars)} chars omitted, showing tail]\n` +
    content.slice(-PRIOR_TOOL_RESULT_MAX_CHARS)
  );
}

function capToolCallArguments(argumentsValue: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(argumentsValue);
  if (serialized.length <= PRIOR_TOOL_ARGUMENTS_MAX_SERIALIZED_CHARS) {
    return argumentsValue;
  }

  let headLength = Math.max(
    0,
    PRIOR_TOOL_ARGUMENTS_MAX_SERIALIZED_CHARS - JSON.stringify({ __truncated_json: "" }).length
  );
  while (headLength >= 0) {
    const omittedChars = serialized.length - headLength;
    const marker = `...[tool arguments truncated: ${String(omittedChars)} chars omitted]`;
    const candidate = {
      __truncated_json: `${serialized.slice(0, headLength)}${marker}`
    };
    if (JSON.stringify(candidate).length <= PRIOR_TOOL_ARGUMENTS_MAX_SERIALIZED_CHARS) {
      return candidate;
    }
    headLength -= 1;
  }

  return {
    __truncated_json: "[tool arguments truncated]"
  };
}
