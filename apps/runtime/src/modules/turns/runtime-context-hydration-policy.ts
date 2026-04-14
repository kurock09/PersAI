import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_CONFIG,
  resolveRuntimeSharedCompactionSummaryBudgetTokens,
  type ProviderGatewayMessageContent,
  type ProviderGatewayTextMessage,
  type RuntimeContextHydrationConfig
} from "@persai/runtime-contract";

const APPROX_CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 12;
const DIRECT_IMAGE_BLOCK_TOKENS = 425;
const DIRECT_PDF_BLOCK_TOKENS = 900;

function isValidConfig(value: unknown): value is RuntimeContextHydrationConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.preset === "string" &&
    typeof row.targetContextBudget === "number" &&
    Number.isInteger(row.targetContextBudget) &&
    row.targetContextBudget > 0 &&
    typeof row.compactionTriggerThreshold === "number" &&
    Number.isInteger(row.compactionTriggerThreshold) &&
    row.compactionTriggerThreshold > 0 &&
    typeof row.keepRecentMinimum === "number" &&
    Number.isInteger(row.keepRecentMinimum) &&
    row.keepRecentMinimum > 0 &&
    typeof row.knowledgeHydrationBudget === "number" &&
    Number.isInteger(row.knowledgeHydrationBudget) &&
    row.knowledgeHydrationBudget >= 0 &&
    (row.sharedCompactionSummaryBudgetTokens === undefined ||
      (typeof row.sharedCompactionSummaryBudgetTokens === "number" &&
        Number.isInteger(row.sharedCompactionSummaryBudgetTokens) &&
        row.sharedCompactionSummaryBudgetTokens > 0)) &&
    typeof row.autoCompactionWeb === "boolean" &&
    typeof row.autoCompactionTelegram === "boolean"
  );
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN));
}

export function resolveRuntimeContextHydrationConfig(
  bundle: AssistantRuntimeBundle | null | undefined
): RuntimeContextHydrationConfig {
  const raw = bundle?.runtime?.contextHydration;
  if (!isValidConfig(raw)) {
    return DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_CONFIG;
  }
  return raw;
}

export function resolveSharedCompactionSummaryCharBudget(
  contextHydration: Pick<
    RuntimeContextHydrationConfig,
    "targetContextBudget" | "sharedCompactionSummaryBudgetTokens"
  >
): number {
  return Math.max(
    1,
    resolveRuntimeSharedCompactionSummaryBudgetTokens(contextHydration) * APPROX_CHARS_PER_TOKEN
  );
}

export function estimateProviderGatewayContentTokens(
  content: ProviderGatewayMessageContent
): number {
  if (typeof content === "string") {
    return estimateTextTokens(content);
  }
  let total = 0;
  for (const block of content) {
    switch (block.type) {
      case "text":
        total += estimateTextTokens(block.text);
        break;
      case "image":
        total += DIRECT_IMAGE_BLOCK_TOKENS;
        break;
      case "pdf":
        total += DIRECT_PDF_BLOCK_TOKENS;
        break;
      default:
        break;
    }
  }
  return total;
}

export function estimateProviderGatewayMessageTokens(message: ProviderGatewayTextMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateProviderGatewayContentTokens(message.content);
}
