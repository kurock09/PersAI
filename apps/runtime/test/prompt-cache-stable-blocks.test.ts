import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildPromptCacheStableBlockToken,
  formatCrossSessionCarryOverStableBlock,
  formatDurableMemoryContextualBlock,
  formatDurableMemoryCoreStableBlock,
  formatSharedCompactionStableBlock,
  isDurableMemoryContextualMessage,
  resolveLeadingHydratedPromptCacheStableBlockTokens,
  type MemoryXmlEntry
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
  // per-turn recent short-memory block must NOT contribute its own
  // family token even when it is sandwiched between stable blocks.
  const coreContent = formatDurableMemoryCoreStableBlock([
    "- [Long memory write: fact] User's name is Alex.",
    "- [Long memory write: preference] Alex prefers concise answers."
  ]);
  const sharedSummaryContent = formatSharedCompactionStableBlock(
    "Stable facts:\n- Earlier project debrief."
  );
  const contextualEntries: MemoryXmlEntry[] = [
    {
      id: "mem-001",
      provenance: "system_inferred",
      writtenAt: "2026-06-10",
      summary: "Prefers walking routes over museum-heavy plans."
    },
    {
      id: "mem-002",
      provenance: "auto_extracted",
      writtenAt: "2026-06-11",
      summary: "Last week Alex visited Tbilisi and discussed photography spots."
    },
    {
      id: "mem-003",
      provenance: "user_explicit",
      writtenAt: "2026-06-12",
      summary: "Send a shortlist of old-town photo locations later."
    }
  ];
  const contextualContent = formatDurableMemoryContextualBlock(contextualEntries);
  assert.equal(
    contextualContent,
    [
      '<entry id="mem-001" provenance="system_inferred" written_at="2026-06-10">',
      "Prefers walking routes over museum-heavy plans.",
      "</entry>",
      '<entry id="mem-002" provenance="auto_extracted" written_at="2026-06-11">',
      "Last week Alex visited Tbilisi and discussed photography spots.",
      "</entry>",
      '<entry id="mem-003" provenance="user_explicit" written_at="2026-06-12">',
      "Send a shortlist of old-town photo locations later.",
      "</entry>"
    ].join("\n")
  );

  const tokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: sharedSummaryContent },
    {
      role: "assistant",
      content: contextualContent,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    },
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
    {
      role: "assistant",
      content: contextualContent,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    },
    { role: "user", content: "Plan a Tbilisi trip" }
  ]);
  assert.deepEqual(noCoreTokens, []);

  // The contextual block must still be detectable so the runtime can
  // distinguish it from regular assistant turns when ordering messages.
  assert.equal(
    isDurableMemoryContextualMessage({
      role: "assistant",
      content: contextualContent,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    }),
    true
  );
  assert.equal(
    isDurableMemoryContextualMessage({ role: "assistant", content: coreContent }),
    false
  );
  assert.equal(
    isDurableMemoryContextualMessage({
      role: "user",
      content: contextualContent,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    }),
    false
  );

  // Per-turn rotation of contextual content must NOT change the stable token
  // emitted for the core block — that's the whole point of M1's split.
  const rotatedEntries: MemoryXmlEntry[] = [
    {
      id: "mem-rot-001",
      provenance: "auto_extracted",
      writtenAt: "2026-06-15",
      summary: "Different relevance hit from another turn."
    }
  ];
  const rotatedContextual = formatDurableMemoryContextualBlock(rotatedEntries);
  const rotatedTokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: sharedSummaryContent },
    {
      role: "assistant",
      content: rotatedContextual,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    },
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

  // ADR-119 Slice 9 — XML entry rendering: each entry emits <entry id provenance written_at> shape.
  const xmlEntry: MemoryXmlEntry = {
    id: "mem-abc123",
    provenance: "user_explicit",
    writtenAt: "2026-06-10",
    summary: "Алексей предпочитает короткие сообщения, минимум emoji."
  };
  const xmlEntry2: MemoryXmlEntry = {
    id: "mem-def456",
    provenance: "system_inferred",
    writtenAt: "2026-06-12",
    summary: "Working on a marketing course launch in Q3 2026."
  };
  const xmlBlock = formatDurableMemoryContextualBlock([xmlEntry, xmlEntry2]);
  assert.ok(
    xmlBlock.includes('<entry id="mem-abc123" provenance="user_explicit" written_at="2026-06-10">')
  );
  assert.ok(xmlBlock.includes("Алексей предпочитает"));
  assert.ok(
    xmlBlock.includes(
      '<entry id="mem-def456" provenance="system_inferred" written_at="2026-06-12">'
    )
  );
  assert.ok(xmlBlock.includes("Working on a marketing course launch"));
  // Both entries must be separated by a newline (entry order preserved).
  assert.ok(xmlBlock.indexOf("mem-abc123") < xmlBlock.indexOf("mem-def456"));

  // Byte-stable: rendering the same input twice produces identical output.
  const xmlBlock2 = formatDurableMemoryContextualBlock([xmlEntry, xmlEntry2]);
  assert.equal(xmlBlock, xmlBlock2, "formatDurableMemoryContextualBlock must be byte-stable");

  // Empty summary entries are filtered out.
  const emptyEntry: MemoryXmlEntry = {
    id: "mem-empty",
    provenance: "legacy",
    writtenAt: "2026-01-01",
    summary: ""
  };
  const xmlBlockWithEmpty = formatDurableMemoryContextualBlock([xmlEntry, emptyEntry]);
  assert.ok(!xmlBlockWithEmpty.includes("mem-empty"), "empty-summary entries must be filtered out");
}
