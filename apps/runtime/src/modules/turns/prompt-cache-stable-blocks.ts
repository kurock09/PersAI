import { createHash } from "node:crypto";
import type { ProviderGatewayTextMessage } from "@persai/runtime-contract";

export type PromptCacheStableBlockFamily =
  | "ordinary_prompt"
  | "durable_memory"
  | "shared_compaction_summary";

const PROMPT_CACHE_STABLE_BLOCK_VERSIONS: Record<PromptCacheStableBlockFamily, number> = {
  ordinary_prompt: 1,
  durable_memory: 1,
  shared_compaction_summary: 1
};

const DURABLE_MEMORY_PREFIX_HEADER = "[Durable user context retained across conversations]";
const SHARED_COMPACTION_PREFIX_HEADER =
  "[Earlier conversation summary retained by shared compaction]";

const HYDRATED_STABLE_BLOCK_HEADERS: Array<{
  family: Extract<PromptCacheStableBlockFamily, "durable_memory" | "shared_compaction_summary">;
  header: string;
}> = [
  {
    family: "durable_memory",
    header: DURABLE_MEMORY_PREFIX_HEADER
  },
  {
    family: "shared_compaction_summary",
    header: SHARED_COMPACTION_PREFIX_HEADER
  }
];

export function buildPromptCacheStableBlockToken(input: {
  family: PromptCacheStableBlockFamily;
  hash: string;
}): string {
  return `${input.family}.v${PROMPT_CACHE_STABLE_BLOCK_VERSIONS[input.family]}.${input.hash}`;
}

export function formatDurableMemoryStableBlock(lines: string[]): string {
  return `${DURABLE_MEMORY_PREFIX_HEADER}\n${lines.join("\n")}`;
}

export function formatSharedCompactionStableBlock(summaryText: string): string {
  return `${SHARED_COMPACTION_PREFIX_HEADER}\n${summaryText}`;
}

export function resolveLeadingHydratedPromptCacheStableBlockTokens(
  messages: ProviderGatewayTextMessage[]
): string[] {
  const tokens: string[] = [];
  for (const message of messages) {
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
