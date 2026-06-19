import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildPromptCacheStableBlockToken,
  formatCrossSessionCarryOverStableBlock,
  formatDurableMemoryCoreStableBlock,
  formatSharedCompactionStableBlock,
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

// ADR-120 Slice 1 — the always-on pushed contextual short-memory block
// (`durable_memory_contextual` / `<persai_memory>`) was retired end to end.
// These helpers build a per-turn VOLATILE message (the surviving kinds are
// `active_scenario` and `system_reminder`) so we can assert the cache-prefix
// walk still skips volatile content without folding it into the stable key.
function buildVolatileScenarioMessage(content: string): {
  role: "assistant";
  content: string;
  cacheRole: "volatile_context";
  volatileKind: "active_scenario";
} {
  return {
    role: "assistant",
    content,
    cacheRole: "volatile_context",
    volatileKind: "active_scenario"
  };
}

export async function runPromptCacheStableBlocksTest(): Promise<void> {
  // The cache prefix walk should yield deterministic tokens for the
  // always-on core memory block and the shared compaction summary, while a
  // per-turn volatile block must NOT contribute its own family token even
  // when it is sandwiched between stable blocks and the user question.
  const coreContent = formatDurableMemoryCoreStableBlock([
    "- [Long memory write: fact] User's name is Alex.",
    "- [Long memory write: preference] Alex prefers concise answers."
  ]);
  const sharedSummaryContent = formatSharedCompactionStableBlock(
    "Stable facts:\n- Earlier project debrief."
  );

  const tokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: sharedSummaryContent },
    buildVolatileScenarioMessage("<persai_active_scenario>step one</persai_active_scenario>"),
    { role: "user", content: "Plan a Tbilisi trip" }
  ]);
  assert.deepEqual(tokens, [
    buildExpectedCoreToken(coreContent),
    buildExpectedSharedSummaryToken(sharedSummaryContent)
  ]);

  // Without the core block (e.g. brand-new assistant) a volatile-only prefix
  // must still leave the stable prefix empty rather than silently promoting
  // the volatile content into a stable token.
  const noCoreTokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    buildVolatileScenarioMessage("<persai_active_scenario>step one</persai_active_scenario>"),
    { role: "user", content: "Plan a Tbilisi trip" }
  ]);
  assert.deepEqual(noCoreTokens, []);

  // Per-turn rotation of volatile content must NOT change the stable token
  // emitted for the core block — that's the whole point of M1's split.
  const rotatedTokens = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: coreContent },
    { role: "assistant", content: sharedSummaryContent },
    buildVolatileScenarioMessage(
      "<persai_active_scenario>different volatile content this turn</persai_active_scenario>"
    ),
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

  // -------------------------------------------------------------------------
  // ADR-119 Golden Test 2 (re-asserted under ADR-120 Slice 1) — cache-prefix
  // byte-stability across volatile-context state variants.
  //
  // The stable prefix (durable_memory_core + rolling_session_synopsis) must be
  // byte-identical regardless of which volatile-context state variant is active.
  // ADR-120 Slice 1 removed the contextual-memory volatile variant; the surviving
  // volatile kinds (active_scenario, system_reminder) still must not invalidate
  // the stable prefix.
  // -------------------------------------------------------------------------

  const GT2_CORE_CONTENT = formatDurableMemoryCoreStableBlock([
    "- [Long memory write: fact] User name is Alex.",
    "- [Long memory write: preference] Alex prefers concise answers."
  ]);
  const GT2_SUMMARY_CONTENT = formatSharedCompactionStableBlock(
    "Stable facts:\n- Prefers direct responses."
  );

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

  // Variant (b): Skill engaged with active scenario — volatile content present.
  const gt2VariantB = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: GT2_CORE_CONTENT },
    { role: "assistant", content: GT2_SUMMARY_CONTENT },
    buildVolatileScenarioMessage(
      '<persai_active_scenario><step number="1"><directive>Briefing step</directive></step></persai_active_scenario>'
    ),
    { role: "user", content: "Let's start the Instagram carousel." }
  ]);
  assert.deepEqual(
    gt2VariantB,
    [GT2_EXPECTED_CORE_TOKEN, GT2_EXPECTED_SUMMARY_TOKEN],
    "ADR-119 GT2(b): variant 'active scenario' must yield same stable tokens (volatile scenario does not invalidate)"
  );

  // Variant (c): system_reminder volatile context — a different volatile kind.
  const gt2VariantC = resolveLeadingHydratedPromptCacheStableBlockTokens([
    { role: "assistant", content: GT2_CORE_CONTENT },
    { role: "assistant", content: GT2_SUMMARY_CONTENT },
    {
      role: "user",
      content: "<system-reminder>Follow the scenario steps in order.</system-reminder>",
      cacheRole: "volatile_context",
      volatileKind: "system_reminder"
    },
    { role: "user", content: "Apply the brand palette to the carousel." }
  ]);
  assert.deepEqual(
    gt2VariantC,
    [GT2_EXPECTED_CORE_TOKEN, GT2_EXPECTED_SUMMARY_TOKEN],
    "ADR-119 GT2(c): variant 'system_reminder' must yield same stable tokens"
  );

  // Across all 3 variants: stable tokens are byte-identical.
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
}
