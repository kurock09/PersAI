import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildPromptCacheStableBlockToken,
  formatCrossSessionCarryOverStableBlock,
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
    family: "rolling_session_synopsis",
    hash: createHash("sha256").update(content.trim()).digest("hex")
  });
}

function buildExpectedCarryOverToken(content: string): string {
  return buildPromptCacheStableBlockToken({
    family: "cross_session_carry_over",
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

  // ADR-074 Slice M3 — cross_session_carry_over is a NEW stable family. It
  // sits between durable_memory_core and rolling_session_synopsis in the
  // prefix walk and emits its own deterministic token.
  const carryOverContent = formatCrossSessionCarryOverStableBlock(
    "# Continuity from earlier conversations\n- session_1: Decide on retreat venue"
  );
  const m3Tokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: carryOverContent },
    { role: "user", content: "Hi again" }
  ]);
  assert.deepEqual(m3Tokens, [
    buildExpectedCoreToken(coreContent),
    buildExpectedCarryOverToken(carryOverContent)
  ]);

  // Carry-over alone (without core) must still get its own token even though
  // the core slot is empty — the prefix walk continues across stable families.
  const carryOverOnlyTokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: carryOverContent },
    { role: "user", content: "Hi again" }
  ]);
  assert.deepEqual(carryOverOnlyTokens, [buildExpectedCarryOverToken(carryOverContent)]);

  // Two fresh threads opened in the same TTL window with identical
  // continuity content must produce IDENTICAL carry-over tokens (this is the
  // whole point of making M3 stable across new threads).
  const sameCarryOverContent = formatCrossSessionCarryOverStableBlock(
    "# Continuity from earlier conversations\n- session_1: Decide on retreat venue"
  );
  const repeatTokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: sameCarryOverContent },
    { role: "user", content: "Hi again from a brand new thread" }
  ]);
  assert.deepEqual(repeatTokens, m3Tokens);
}
