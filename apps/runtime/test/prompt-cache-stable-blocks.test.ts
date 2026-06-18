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

  // -------------------------------------------------------------------------
  // ADR-119 Golden Test 2 — Cache-prefix byte-stability across 5 state variants.
  //
  // The stable prefix (BP1 = identity/voice/character_notes, BP2 = protocols/
  // contracts) must be byte-identical regardless of which volatile-context
  // state variant is active. Only the volatile tail changes.
  // -------------------------------------------------------------------------

  // Shared stable content used across all 5 variants.
  const GT2_CORE_CONTENT = formatDurableMemoryCoreStableBlock([
    "- [Long memory write: fact] User name is Alex.",
    "- [Long memory write: preference] Alex prefers concise answers."
  ]);
  const GT2_SUMMARY_CONTENT = formatSharedCompactionStableBlock(
    "Stable facts:\n- Prefers direct responses."
  );

  // Stable token values (computed once; all 5 variants must produce these exact tokens).
  const GT2_EXPECTED_CORE_TOKEN = buildExpectedCoreToken(GT2_CORE_CONTENT);
  const GT2_EXPECTED_SUMMARY_TOKEN = buildExpectedSharedSummaryToken(GT2_SUMMARY_CONTENT);

  // Variant (a): no Skill engaged — no volatile context other than user message.
  const gt2VariantA = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: GT2_CORE_CONTENT },
    { role: "assistant", content: GT2_SUMMARY_CONTENT },
    { role: "user", content: "Hello, can you help me with marketing?" }
  ]);
  assert.deepEqual(
    gt2VariantA,
    [GT2_EXPECTED_CORE_TOKEN, GT2_EXPECTED_SUMMARY_TOKEN],
    "ADR-119 GT2(a): variant 'no Skill engaged' must yield identical stable tokens"
  );

  // Variant (b): Skill engaged, no scenario — memory entries added (volatile).
  const gt2MemEntries: MemoryXmlEntry[] = [
    {
      id: "m1",
      provenance: "system_inferred",
      writtenAt: "2026-06-01",
      summary: "Alex works in marketing."
    }
  ];
  const gt2MemContent = formatDurableMemoryContextualBlock(gt2MemEntries);
  const gt2VariantB = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: GT2_CORE_CONTENT },
    { role: "assistant", content: GT2_SUMMARY_CONTENT },
    {
      role: "assistant",
      content: gt2MemContent,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    },
    { role: "user", content: "Help me with the Marketer Skill." }
  ]);
  assert.deepEqual(
    gt2VariantB,
    [GT2_EXPECTED_CORE_TOKEN, GT2_EXPECTED_SUMMARY_TOKEN],
    "ADR-119 GT2(b): variant 'Skill engaged, no scenario' must yield same stable tokens (volatile memory does not invalidate)"
  );

  // Variant (c): Skill engaged with active scenario — different volatile content.
  const gt2VariantC = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: GT2_CORE_CONTENT },
    { role: "assistant", content: GT2_SUMMARY_CONTENT },
    {
      role: "assistant",
      content: gt2MemContent,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    },
    {
      role: "assistant",
      content:
        '<persai_active_scenario><step number="1"><directive>Briefing step</directive></step></persai_active_scenario>',
      cacheRole: "volatile_context",
      volatileKind: "active_scenario"
    },
    { role: "user", content: "Let's start the Instagram carousel." }
  ]);
  assert.deepEqual(
    gt2VariantC,
    [GT2_EXPECTED_CORE_TOKEN, GT2_EXPECTED_SUMMARY_TOKEN],
    "ADR-119 GT2(c): variant 'Skill engaged with active scenario' must yield same stable tokens"
  );

  // Variant (d): Skill released — back to plain user message, no volatile context.
  const gt2VariantD = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: GT2_CORE_CONTENT },
    { role: "assistant", content: GT2_SUMMARY_CONTENT },
    { role: "user", content: "Let's talk about something else." }
  ]);
  assert.deepEqual(
    gt2VariantD,
    [GT2_EXPECTED_CORE_TOKEN, GT2_EXPECTED_SUMMARY_TOKEN],
    "ADR-119 GT2(d): variant 'Skill released' must yield same stable tokens"
  );

  // Variant (e): memory entries retrieved — different memory content than (b).
  const gt2MemEntriesE: MemoryXmlEntry[] = [
    {
      id: "m2",
      provenance: "auto_extracted",
      writtenAt: "2026-06-10",
      summary: "Prefers 1080x1080 carousel format."
    },
    {
      id: "m3",
      provenance: "user_explicit",
      writtenAt: "2026-06-12",
      summary: "Brand palette: coral and cream."
    }
  ];
  const gt2MemContentE = formatDurableMemoryContextualBlock(gt2MemEntriesE);
  const gt2VariantE = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: GT2_CORE_CONTENT },
    { role: "assistant", content: GT2_SUMMARY_CONTENT },
    {
      role: "assistant",
      content: gt2MemContentE,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    },
    { role: "user", content: "Apply the brand palette to the carousel." }
  ]);
  assert.deepEqual(
    gt2VariantE,
    [GT2_EXPECTED_CORE_TOKEN, GT2_EXPECTED_SUMMARY_TOKEN],
    "ADR-119 GT2(e): variant 'different memory entries retrieved' must yield same stable tokens (volatile memory rotation does not invalidate stable prefix)"
  );

  // Across all 5 variants: stable tokens are byte-identical.
  assert.deepEqual(
    gt2VariantA,
    gt2VariantB,
    "ADR-119 GT2: variants A and B stable tokens are byte-identical"
  );
  assert.deepEqual(
    gt2VariantB,
    gt2VariantC,
    "ADR-119 GT2: variants B and C stable tokens are byte-identical"
  );
  assert.deepEqual(
    gt2VariantC,
    gt2VariantD,
    "ADR-119 GT2: variants C and D stable tokens are byte-identical"
  );
  assert.deepEqual(
    gt2VariantD,
    gt2VariantE,
    "ADR-119 GT2: variants D and E stable tokens are byte-identical"
  );

  // -------------------------------------------------------------------------
  // ADR-119 Golden Test 6 — Memory.provenance set + XML rendering.
  //
  // Every rendered <entry> must carry the provenance attribute byte-stably.
  // (Primary coverage in the XML entry assertions above; GT6 adds explicit labeling
  // and the "all four provenance values render" assertion.)
  // -------------------------------------------------------------------------

  const gt6AllProvenanceEntries: MemoryXmlEntry[] = [
    {
      id: "gt6-ue",
      provenance: "user_explicit",
      writtenAt: "2026-06-01",
      summary: "User said something explicitly."
    },
    {
      id: "gt6-si",
      provenance: "system_inferred",
      writtenAt: "2026-06-02",
      summary: "System inferred a preference."
    },
    {
      id: "gt6-ae",
      provenance: "auto_extracted",
      writtenAt: "2026-06-03",
      summary: "Auto-extracted from conversation."
    },
    {
      id: "gt6-lg",
      provenance: "legacy",
      writtenAt: "2026-06-04",
      summary: "Legacy entry without provenance tracking."
    }
  ];
  const gt6Block = formatDurableMemoryContextualBlock(gt6AllProvenanceEntries);

  assert.ok(
    gt6Block.includes('provenance="user_explicit"'),
    "ADR-119 GT6: user_explicit provenance rendered in XML"
  );
  assert.ok(
    gt6Block.includes('provenance="system_inferred"'),
    "ADR-119 GT6: system_inferred provenance rendered in XML"
  );
  assert.ok(
    gt6Block.includes('provenance="auto_extracted"'),
    "ADR-119 GT6: auto_extracted provenance rendered in XML"
  );
  assert.ok(
    gt6Block.includes('provenance="legacy"'),
    "ADR-119 GT6: legacy provenance rendered in XML"
  );

  // Byte-stable: same provenance entries rendered twice produce identical output.
  const gt6Block2 = formatDurableMemoryContextualBlock(gt6AllProvenanceEntries);
  assert.equal(
    gt6Block,
    gt6Block2,
    "ADR-119 GT6: <persai_memory> entries must be byte-stable for identical inputs"
  );

  // Order preserved — provenance values appear in input order.
  assert.ok(
    gt6Block.indexOf("gt6-ue") < gt6Block.indexOf("gt6-si"),
    "ADR-119 GT6: entry order preserved (user_explicit before system_inferred)"
  );
  assert.ok(
    gt6Block.indexOf("gt6-si") < gt6Block.indexOf("gt6-ae"),
    "ADR-119 GT6: entry order preserved (system_inferred before auto_extracted)"
  );
  assert.ok(
    gt6Block.indexOf("gt6-ae") < gt6Block.indexOf("gt6-lg"),
    "ADR-119 GT6: entry order preserved (auto_extracted before legacy)"
  );
}
