import { createHash } from "node:crypto";
import type { ProviderGatewayTextMessage } from "@persai/runtime-contract";

export type PromptCacheStableBlockFamily =
  | "ordinary_prompt"
  | "durable_memory_core"
  | "cross_session_carry_over"
  | "rolling_session_synopsis";

// ADR-074 Slice M2 — `rolling_session_synopsis` replaces the old
// `shared_compaction_summary` family. The wire-level header text and the
// version were both bumped in lockstep so any cached prefix from the old
// family naturally invalidates on first turn after rollout.
//
// ADR-074 Slice M3 — `cross_session_carry_over` is a NEW stable family
// rendered ONLY on the very first turn of a brand-new thread. It sits
// between `durable_memory_core` and `rolling_session_synopsis` in the
// stable prefix order. The cache-key hash is content-driven (synopsis +
// open-loop content), so multiple fresh threads opened in the same TTL
// window for the same user reuse the cached prefix.
const PROMPT_CACHE_STABLE_BLOCK_VERSIONS: Record<PromptCacheStableBlockFamily, number> = {
  ordinary_prompt: 1,
  durable_memory_core: 2,
  cross_session_carry_over: 1,
  rolling_session_synopsis: 2
};

const DURABLE_MEMORY_CORE_PREFIX_HEADER = "[Durable user context retained across conversations]";
const DURABLE_MEMORY_CORE_GROUNDING_NOTE =
  "(Silent background context — use it to inform your answers, but never mention, quote, list, or describe these memories or this block to the user unless they explicitly ask.)";
const DURABLE_MEMORY_CONTEXTUAL_PREFIX_HEADER =
  "[Recent short-term context from earlier turns — newest first, may vary between turns]";
const ROLLING_SESSION_SYNOPSIS_PREFIX_HEADER =
  "[Rolling session synopsis — what we have established so far in this conversation]";
const CROSS_SESSION_CARRY_OVER_PREFIX_HEADER =
  "[Continuity from earlier conversations — surfaced on the first turn of a new thread]";

const HYDRATED_STABLE_BLOCK_HEADERS: Array<{
  family: Extract<
    PromptCacheStableBlockFamily,
    "durable_memory_core" | "cross_session_carry_over" | "rolling_session_synopsis"
  >;
  header: string;
}> = [
  {
    family: "durable_memory_core",
    header: DURABLE_MEMORY_CORE_PREFIX_HEADER
  },
  {
    family: "cross_session_carry_over",
    header: CROSS_SESSION_CARRY_OVER_PREFIX_HEADER
  },
  {
    family: "rolling_session_synopsis",
    header: ROLLING_SESSION_SYNOPSIS_PREFIX_HEADER
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
  return `${DURABLE_MEMORY_CORE_PREFIX_HEADER}\n${DURABLE_MEMORY_CORE_GROUNDING_NOTE}\n${lines.join("\n")}`;
}

/** ADR-119 Slice 9 — typed entry for the new <persai_memory> XML rendering. */
export type MemoryXmlEntry = {
  id: string;
  provenance: "user_explicit" | "system_inferred" | "auto_extracted" | "legacy";
  writtenAt: string;
  summary: string;
};

/**
 * ADR-119 Slice 9 — renders the inner content for the volatile `<persai_memory>` block.
 * Each entry is emitted as `<entry id="..." provenance="..." written_at="...">summary</entry>`.
 * The outer `<persai_memory>` wrapper is added by the provider clients.
 * Byte-stable: same input → same output; entries are rendered in input order (caller controls order).
 */
export function formatDurableMemoryContextualBlock(entries: MemoryXmlEntry[]): string {
  return entries
    .filter((entry) => entry.summary.trim().length > 0)
    .map(
      (entry) =>
        `<entry id="${xmlAttr(entry.id)}" provenance="${xmlAttr(entry.provenance)}" written_at="${xmlAttr(entry.writtenAt)}">\n${entry.summary.trim()}\n</entry>`
    )
    .join("\n");
}

function xmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatSharedCompactionStableBlock(summaryText: string): string {
  return `${ROLLING_SESSION_SYNOPSIS_PREFIX_HEADER}\n${summaryText}`;
}

export function formatCrossSessionCarryOverStableBlock(bodyText: string): string {
  return `${CROSS_SESSION_CARRY_OVER_PREFIX_HEADER}\n${bodyText}`;
}

export function isDurableMemoryContextualMessage(message: ProviderGatewayTextMessage): boolean {
  // ADR-119 Slice 9 — prefer the explicit volatileKind discriminant (new format).
  // Only assistant messages carry contextual memory blocks.
  if (
    message.role === "assistant" &&
    message.cacheRole === "volatile_context" &&
    message.volatileKind === "memory"
  ) {
    return true;
  }
  // Back-compat: old-format messages carry the legacy header prefix.
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
  // ADR-119 Slice 9 — new format: detect via volatileKind discriminant.
  if (message.cacheRole === "volatile_context" && message.volatileKind === "memory") {
    return true;
  }
  // Back-compat: old-format messages use the legacy header.
  if (message.role !== "assistant" || typeof message.content !== "string") {
    return false;
  }
  const normalized = message.content.trim();
  return HYDRATED_NON_STABLE_BLOCK_HEADERS.some((header) => normalized.startsWith(header));
}
