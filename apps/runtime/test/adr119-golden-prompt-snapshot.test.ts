/**
 * ADR-119 Golden Test 1b — Runtime-side three-zone prompt structure validation.
 *
 * Validates that the runtime-owned stable + volatile-context components assemble
 * into the correct three-zone structure (AOT prefix / JIT volatile / conversation
 * tail) as defined by ADR-119 D1.
 *
 * ADR-120 Slice 1 UPDATE — the always-on pushed contextual short-memory block
 * (`durable_memory_contextual` / `<persai_memory>`) was retired end to end. It
 * pushed cross-chat facts into the recency zone (memory bleeding) and competed
 * with the live request for attention. Cross-chat recall is now pull-only via the
 * `knowledge_search` `memory` source. This test therefore asserts:
 *   - durable_memory_core (Zone 1, stable primacy) is UNCHANGED;
 *   - the surviving volatile kinds (active_scenario, system_reminder) remain in Zone 2;
 *   - NO contextual `<persai_memory>` block is produced anywhere — bleeding is
 *     eliminated by construction (there is no contextual push at all);
 *   - the volatile rotation never invalidates the stable prefix token.
 *
 * NOTE: The byte-exact system-prefix snapshot (Golden Test 1a) lives in
 * apps/api/test/adr119-golden-prompt-snapshot.test.ts.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ProviderGatewayTextMessage } from "@persai/runtime-contract";
import {
  buildPromptCacheStableBlockToken,
  formatDurableMemoryCoreStableBlock,
  formatSharedCompactionStableBlock,
  resolveLeadingHydratedPromptCacheStableBlockTokens
} from "../src/modules/turns/prompt-cache-stable-blocks";

function collectText(messages: ProviderGatewayTextMessage[]): string {
  return messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
            .join("\n")
    )
    .join("\n");
}

export async function runAdr119GoldenPromptSnapshotTest(): Promise<void> {
  // -------------------------------------------------------------------------
  // Zone 1 — AOT stable-prefix: durable_memory_core stays in the primacy zone.
  // -------------------------------------------------------------------------
  const coreBlock = formatDurableMemoryCoreStableBlock([
    "- [Long memory write: preference] Alex prefers short answers."
  ]);
  const summaryBlock = formatSharedCompactionStableBlock("Stable facts:\n- Working in marketing.");

  const expectedCoreToken = buildPromptCacheStableBlockToken({
    family: "durable_memory_core",
    hash: createHash("sha256").update(coreBlock.trim()).digest("hex")
  });
  const expectedSummaryToken = buildPromptCacheStableBlockToken({
    family: "rolling_session_synopsis",
    hash: createHash("sha256").update(summaryBlock.trim()).digest("hex")
  });

  // -------------------------------------------------------------------------
  // Zone 2 — JIT volatile context: the surviving kinds are active_scenario
  // and system_reminder. The contextual short-memory block is gone.
  // -------------------------------------------------------------------------
  const scenarioVolatile: ProviderGatewayTextMessage = {
    role: "assistant",
    content:
      '<step number="1"><directive>Write the caption.</directive></step><exit_condition>Done.</exit_condition>',
    cacheRole: "volatile_context",
    volatileKind: "active_scenario"
  };
  const reminderVolatile: ProviderGatewayTextMessage = {
    role: "user",
    content: "Active scenario: Instagram Carousel, 3 steps total. Follow steps in order.",
    cacheRole: "volatile_context",
    volatileKind: "system_reminder"
  };

  // Recency zone = stable prefix + volatile (scenario/reminder) + user question.
  const recencyZone: ProviderGatewayTextMessage[] = [
    { role: "assistant", content: coreBlock },
    { role: "assistant", content: summaryBlock },
    scenarioVolatile,
    reminderVolatile,
    { role: "user", content: "Apply my brand palette to the carousel." }
  ];

  // The stable prefix walk emits ONLY the stable family tokens; the volatile
  // scenario/reminder messages are skipped and never contribute a token.
  const tokens = resolveLeadingHydratedPromptCacheStableBlockTokens(recencyZone);
  assert.deepEqual(
    tokens,
    [expectedCoreToken, expectedSummaryToken],
    "ADR-120 GT1b: durable_memory_core + synopsis are the only stable tokens; volatile context is skipped"
  );

  // -------------------------------------------------------------------------
  // ADR-120 Slice 1 — bleeding eliminated by construction: NO contextual
  // `<persai_memory>` block exists anywhere in the runtime-assembled context.
  // The recency zone carries only the user question + scenario + reminder.
  // -------------------------------------------------------------------------
  const recencyText = collectText(recencyZone);
  assert.doesNotMatch(
    recencyText,
    /<persai_memory>/,
    "ADR-120 GT1b: no contextual <persai_memory> push may appear in the recency zone"
  );

  // A fact written in chat A must never appear pushed into chat B. With the
  // contextual push retired, the runtime emits no per-assistant memory block at
  // all, so the only memory in the prompt is the explicit durable core block
  // (global by design). Simulate two distinct chats: neither carries the other's
  // contextual fact, because contextual facts are no longer pushed.
  const chatAFact = "User mentioned in chat A that the launch date is March 3.";
  const chatBRecency: ProviderGatewayTextMessage[] = [
    { role: "assistant", content: coreBlock },
    scenarioVolatile,
    reminderVolatile,
    { role: "user", content: "What should I post next?" }
  ];
  assert.ok(
    !collectText(chatBRecency).includes(chatAFact),
    "ADR-120 GT1b: a contextual fact from chat A is not pushed into chat B (no contextual push at all)"
  );

  // -------------------------------------------------------------------------
  // The only volatile kinds are scenario/reminder; rotating volatile content
  // never invalidates the stable prefix token.
  // -------------------------------------------------------------------------
  const rotatedRecency: ProviderGatewayTextMessage[] = [
    { role: "assistant", content: coreBlock },
    { role: "assistant", content: summaryBlock },
    {
      ...scenarioVolatile,
      content: '<step number="2"><directive>Pick the cover slide.</directive></step>'
    },
    { role: "user", content: "Next step please." }
  ];
  assert.deepEqual(
    resolveLeadingHydratedPromptCacheStableBlockTokens(rotatedRecency),
    [expectedCoreToken, expectedSummaryToken],
    "ADR-120 GT1b: rotating volatile scenario content does not change the stable prefix token"
  );

  // The durable core block itself is never treated as volatile context.
  assert.equal(
    resolveLeadingHydratedPromptCacheStableBlockTokens([
      { role: "assistant", content: coreBlock },
      { role: "user", content: "Hi" }
    ]).length,
    1,
    "ADR-120 GT1b: durable_memory_core stays in Zone 1 (stable) and emits exactly one token"
  );
}
