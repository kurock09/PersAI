import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildPromptCacheStableBlockToken,
  formatDurableMemoryContextualBlock,
  formatDurableMemoryCoreStableBlock,
  formatSharedCompactionStableBlock,
  isDurableMemoryContextualMessage,
  resolveLeadingHydratedPromptCacheStableBlockTokens
} from "../src/modules/turns/prompt-cache-stable-blocks";

function buildExpectedCoreToken(content: string): string {
  return buildPromptCacheStableBlockToken({
    family: "durable_memory_core",
    hash: createHash("sha256").update(content.trim()).digest("hex")
  });
}

function buildExpectedSharedSummaryToken(content: string): string {
  return buildPromptCacheStableBlockToken({
    family: "shared_compaction_summary",
    hash: createHash("sha256").update(content.trim()).digest("hex")
  });
}

export async function runPromptCacheStableBlocksTest(): Promise<void> {
  // The cache prefix walk should yield deterministic tokens for the
  // always-on core memory block and the shared compaction summary, while the
  // per-turn relevance-retrieved contextual block must NOT contribute its own
  // family token even when it is sandwiched between stable blocks.
  const coreContent = formatDurableMemoryCoreStableBlock([
    "- [Memory write: fact] User's name is Alex.",
    "- [Memory write: preference] Alex prefers concise answers."
  ]);
  const sharedSummaryContent = formatSharedCompactionStableBlock(
    "Stable facts:\n- Earlier project debrief."
  );
  const contextualContent = formatDurableMemoryContextualBlock([
    "- [Web chat memory] Last week Alex visited Tbilisi and discussed photography spots."
  ]);

  const tokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: sharedSummaryContent },
    { role: "assistant", content: contextualContent },
    { role: "user", content: "Plan a Tbilisi trip" }
  ]);
  assert.deepEqual(tokens, [
    buildExpectedCoreToken(coreContent),
    buildExpectedSharedSummaryToken(sharedSummaryContent)
  ]);

  // Without the core block (e.g. brand-new assistant) a contextual-only prefix
  // must still leave the stable prefix empty rather than silently promoting
  // the contextual content into a stable token.
  const noCoreTokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: contextualContent },
    { role: "user", content: "Plan a Tbilisi trip" }
  ]);
  assert.deepEqual(noCoreTokens, []);

  // The contextual block must still be detectable so the runtime can
  // distinguish it from regular assistant turns when ordering messages.
  assert.equal(
    isDurableMemoryContextualMessage({ role: "assistant", content: contextualContent }),
    true
  );
  assert.equal(
    isDurableMemoryContextualMessage({ role: "assistant", content: coreContent }),
    false
  );
  assert.equal(
    isDurableMemoryContextualMessage({ role: "user", content: contextualContent }),
    false
  );

  // Per-turn rotation of contextual content must NOT change the stable token
  // emitted for the core block — that's the whole point of M1's split.
  const rotatedContextual = formatDurableMemoryContextualBlock([
    "- [Web chat memory] Different relevance hit from another turn."
  ]);
  const rotatedTokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: sharedSummaryContent },
    { role: "assistant", content: rotatedContextual },
    { role: "user", content: "next turn" }
  ]);
  assert.deepEqual(rotatedTokens, tokens);
}
