import { createHash } from "node:crypto";
import type { ProviderGatewayTextMessage } from "@persai/runtime-contract";

export type PromptCacheStableBlockFamily =
  | "ordinary_prompt"
  | "durable_memory_core"
  | "shared_compaction_summary";

const PROMPT_CACHE_STABLE_BLOCK_VERSIONS: Record<PromptCacheStableBlockFamily, number> = {
  ordinary_prompt: 1,
  durable_memory_core: 1,
  shared_compaction_summary: 1
};

const DURABLE_MEMORY_CORE_PREFIX_HEADER = "[Durable user context retained across conversations]";
const DURABLE_MEMORY_CONTEXTUAL_PREFIX_HEADER =
  "[Relevant memories retrieved for this turn — may vary between turns]";
const SHARED_COMPACTION_PREFIX_HEADER =
  "[Earlier conversation summary retained by shared compaction]";

const HYDRATED_STABLE_BLOCK_HEADERS: Array<{
  family: Extract<
    PromptCacheStableBlockFamily,
    "durable_memory_core" | "shared_compaction_summary"
  >;
  header: string;
}> = [
  {
    family: "durable_memory_core",
    header: DURABLE_MEMORY_CORE_PREFIX_HEADER
  },
  {
    family: "shared_compaction_summary",
    header: SHARED_COMPACTION_PREFIX_HEADER
  }
];

const HYDRATED_NON_STABLE_BLOCK_HEADERS: string[] = [DURABLE_MEMORY_CONTEXTUAL_PREFIX_HEADER];

export function buildPromptCacheStableBlockToken(input: {
  family: PromptCacheStableBlockFamily;
  hash: string;
}): string {
  return `${input.family}.v${PROMPT_CACHE_STABLE_BLOCK_VERSIONS[input.family]}.${input.hash}`;
}

export function formatDurableMemoryCoreStableBlock(lines: string[]): string {
  return `${DURABLE_MEMORY_CORE_PREFIX_HEADER}\n${lines.join("\n")}`;
}

export function formatDurableMemoryContextualBlock(lines: string[]): string {
  return `${DURABLE_MEMORY_CONTEXTUAL_PREFIX_HEADER}\n${lines.join("\n")}`;
}

export function formatSharedCompactionStableBlock(summaryText: string): string {
  return `${SHARED_COMPACTION_PREFIX_HEADER}\n${summaryText}`;
}

export function isDurableMemoryContextualMessage(message: ProviderGatewayTextMessage): boolean {
  if (message.role !== "assistant" || typeof message.content !== "string") {
    return false;
  }
  return message.content.trim().startsWith(DURABLE_MEMORY_CONTEXTUAL_PREFIX_HEADER);
}

export function resolveLeadingHydratedPromptCacheStableBlockTokens(
  messages: ProviderGatewayTextMessage[]
): string[] {
  const tokens: string[] = [];
  for (const message of messages) {
    if (isHydratedNonStableHeaderMessage(message)) {
      // Skip non-stable hydrated blocks (e.g. relevance-retrieved contextual memory)
      // without breaking the stable prefix walk — they may legitimately appear
      // between stable blocks and the first user/assistant turn.
      continue;
    }
    const token = resolveHydratedPromptCacheStableBlockToken(message);
    if (token === null) {
      break;
    }
    tokens.push(token);
  }
  return tokens;
}

function resolveHydratedPromptCacheStableBlockToken(
  message: ProviderGatewayTextMessage
): string | null {
  if (message.role !== "assistant" || typeof message.content !== "string") {
    return null;
  }
  const normalized = message.content.trim();
  for (const candidate of HYDRATED_STABLE_BLOCK_HEADERS) {
    if (!normalized.startsWith(candidate.header)) {
      continue;
    }
    return buildPromptCacheStableBlockToken({
      family: candidate.family,
      hash: createHash("sha256").update(normalized).digest("hex")
    });
  }
  return null;
}

function isHydratedNonStableHeaderMessage(message: ProviderGatewayTextMessage): boolean {
  if (message.role !== "assistant" || typeof message.content !== "string") {
    return false;
  }
  const normalized = message.content.trim();
  return HYDRATED_NON_STABLE_BLOCK_HEADERS.some((header) => normalized.startsWith(header));
}
