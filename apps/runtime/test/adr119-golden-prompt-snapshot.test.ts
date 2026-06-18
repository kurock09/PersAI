/**
 * ADR-119 Golden Test 1b — Runtime-side three-zone prompt structure validation.
 *
 * Validates that the runtime-owned volatile-context components assemble into the
 * correct three-zone structure (AOT prefix / JIT volatile / conversation tail)
 * as defined by ADR-119 D1.
 *
 * NOTE: The byte-exact system-prefix snapshot (Golden Test 1a) lives in
 * apps/api/test/adr119-golden-prompt-snapshot.test.ts because
 * CompilePromptConstructorService is an api-package class that cannot be
 * imported here without cross-package wiring that would break typecheck.
 * This file validates the runtime's own volatile-context construction.
 */

import assert from "node:assert/strict";
import {
  formatDurableMemoryContextualBlock,
  formatDurableMemoryCoreStableBlock,
  isDurableMemoryContextualMessage,
  type MemoryXmlEntry
} from "../src/modules/turns/prompt-cache-stable-blocks";

export async function runAdr119GoldenPromptSnapshotTest(): Promise<void> {
  // -------------------------------------------------------------------------
  // Zone 1 — AOT stable-prefix components (tested via api golden test 1a).
  // Here we validate the runtime's awareness of zone boundaries.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Zone 2 — JIT volatile context: memory entries (ADR-119 Slice 9).
  // -------------------------------------------------------------------------

  const memoryEntries: MemoryXmlEntry[] = [
    {
      id: "mem-gt1-001",
      provenance: "user_explicit",
      writtenAt: "2026-06-01",
      summary: "Alex prefers short, direct answers without filler phrases."
    },
    {
      id: "mem-gt1-002",
      provenance: "auto_extracted",
      writtenAt: "2026-06-10",
      summary: "Working on an Instagram marketing campaign for a cosmetics brand."
    },
    {
      id: "mem-gt1-003",
      provenance: "system_inferred",
      writtenAt: "2026-06-15",
      summary: "Preferred image format: 1080×1080 square for carousel slides."
    }
  ];

  const memoryBlock = formatDurableMemoryContextualBlock(memoryEntries);

  // Each entry must render with provenance attribute.
  assert.ok(
    memoryBlock.includes(
      '<entry id="mem-gt1-001" provenance="user_explicit" written_at="2026-06-01">'
    ),
    "ADR-119 GT1: memory entry must include provenance='user_explicit'"
  );
  assert.ok(
    memoryBlock.includes(
      '<entry id="mem-gt1-002" provenance="auto_extracted" written_at="2026-06-10">'
    ),
    "ADR-119 GT1: memory entry must include provenance='auto_extracted'"
  );
  assert.ok(
    memoryBlock.includes(
      '<entry id="mem-gt1-003" provenance="system_inferred" written_at="2026-06-15">'
    ),
    "ADR-119 GT1: memory entry must include provenance='system_inferred'"
  );

  // The contextual block must be flagged as volatile (not stable).
  const volatileMessage = {
    role: "assistant" as const,
    content: memoryBlock,
    cacheRole: "volatile_context" as const,
    volatileKind: "memory" as const
  };
  assert.equal(
    isDurableMemoryContextualMessage(volatileMessage),
    true,
    "ADR-119 GT1: contextual memory message must be detected as volatile"
  );

  // A stable core block must NOT be detected as contextual.
  const coreBlock = formatDurableMemoryCoreStableBlock([
    "- [Long memory write: preference] Alex prefers short answers."
  ]);
  assert.equal(
    isDurableMemoryContextualMessage({ role: "assistant", content: coreBlock }),
    false,
    "ADR-119 GT1: stable core block must NOT be detected as contextual"
  );

  // -------------------------------------------------------------------------
  // Zone 3 — Conversation tail: stable prefix must not leak into tail.
  // -------------------------------------------------------------------------

  // Stable core block is NOT volatile context → it stays in the stable prefix zone.
  assert.equal(
    isDurableMemoryContextualMessage({ role: "assistant", content: coreBlock }),
    false,
    "ADR-119 GT1: durable_memory_core stays in Zone 1 (not volatile)"
  );

  // A user message is never volatile context.
  assert.equal(
    isDurableMemoryContextualMessage({
      role: "user",
      content: memoryBlock,
      cacheRole: "volatile_context",
      volatileKind: "memory"
    }),
    false,
    "ADR-119 GT1: user role message is Zone 3 (tail), not Zone 2 (volatile)"
  );

  // -------------------------------------------------------------------------
  // Byte-stable: same entries rendered twice produce identical output.
  // -------------------------------------------------------------------------
  const memoryBlock2 = formatDurableMemoryContextualBlock(memoryEntries);
  assert.equal(
    memoryBlock,
    memoryBlock2,
    "ADR-119 GT1: volatile memory block must be byte-stable for identical inputs"
  );
}
