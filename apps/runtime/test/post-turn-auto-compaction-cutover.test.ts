import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ADR-074 Slice M2 — regression guard.
//
// The synchronous post-turn auto-compaction path
// (`executePostTurnAutoCompaction` + `buildAutoCompactionRequest` +
// `RuntimeTurnAutoCompactionState`) was removed when M2 cut over to a fully
// off-band background scheduler. Re-introducing them in `TurnExecutionService`
// would silently restore in-turn LLM calls and reintroduce the user-perceived
// latency that M2 set out to eliminate. This test fails loudly if any of
// those identifiers reappear or if the fire-and-forget enqueue is removed.

function loadTurnExecutionSource(): string {
  return readFileSync(resolve(__dirname, "../src/modules/turns/turn-execution.service.ts"), "utf8");
}

function loadPersaiInternalApiSource(): string {
  return readFileSync(
    resolve(__dirname, "../src/modules/turns/persai-internal-api.client.service.ts"),
    "utf8"
  );
}

function assertSourceForbids(source: string, needle: string, hint: string): void {
  if (source.includes(needle)) {
    throw new Error(
      `ADR-074 M2 cutover regression: forbidden token "${needle}" reappeared in turn-execution.service.ts. ${hint}`
    );
  }
}

function assertSourceContains(source: string, needle: string, hint: string): void {
  assert.ok(
    source.includes(needle),
    `ADR-074 M2 cutover regression: required token "${needle}" missing. ${hint}`
  );
}

async function run(): Promise<void> {
  const turnExecutionSource = loadTurnExecutionSource();

  for (const forbidden of [
    "executePostTurnAutoCompaction(",
    "buildAutoCompactionRequest(",
    "RuntimeTurnAutoCompactionState"
  ]) {
    assertSourceForbids(
      turnExecutionSource,
      forbidden,
      "M2 made auto-compaction off-band; this identifier must not exist."
    );
  }

  assertSourceContains(
    turnExecutionSource,
    "fireBackgroundCompactionEnqueue(",
    "TurnExecutionService must enqueue background compaction off-band after each accepted turn."
  );
  assertSourceContains(
    turnExecutionSource,
    "enqueueBackgroundCompaction(",
    "TurnExecutionService must call PersaiInternalApiClientService.enqueueBackgroundCompaction."
  );
  assertSourceContains(
    turnExecutionSource,
    'trigger: "post_turn"',
    "Post-turn enqueue must use the post_turn trigger so the API scheduler can dedupe correctly."
  );

  // The fire-and-forget path must NEVER `await` the enqueue itself: doing so
  // would re-tie user-perceived latency to background-compaction queue health.
  const fireMethodMatch = /private fireBackgroundCompactionEnqueue\([\s\S]*?\n {2}\}\n/.exec(
    turnExecutionSource
  );
  assert.ok(
    fireMethodMatch,
    "fireBackgroundCompactionEnqueue method body must be present so we can verify it stays fire-and-forget."
  );
  const fireMethodBody = fireMethodMatch[0];
  assert.ok(
    !/await[\s\n]+this\.persaiInternalApiClientService\s*\.enqueueBackgroundCompaction/.test(
      fireMethodBody
    ),
    "ADR-074 M2 cutover regression: enqueueBackgroundCompaction call must remain fire-and-forget (do not `await` it)."
  );
  assert.ok(
    /void this\.persaiInternalApiClientService[\s\n]+\.enqueueBackgroundCompaction/.test(
      fireMethodBody
    ),
    "ADR-074 M2 cutover regression: enqueue call must use `void` to make fire-and-forget intent explicit."
  );

  // ADR-161 A3 confirm-only: 100% auto-compaction enqueue threshold must stay
  // `currentTokens >= compactionTriggerThreshold`. A2's 50% micro-clear must
  // not rewrite this gate.
  assert.ok(
    /freshCurrentTokens < tokenThreshold/.test(fireMethodBody),
    "ADR-161 A3: fireBackgroundCompactionEnqueue must keep the 100% threshold comparison."
  );
  assert.ok(
    !/0\.5\s*\*\s*tokenThreshold|tokenThreshold\s*\*\s*0\.5|MICRO_CLEAR|microClear|micro_clear/.test(
      fireMethodBody
    ),
    "ADR-161 A3: fireBackgroundCompactionEnqueue must not apply the 50% micro-clear ratio."
  );

  // The internal API client must still expose the method we depend on.
  const internalApiSource = loadPersaiInternalApiSource();
  assertSourceContains(
    internalApiSource,
    "async enqueueBackgroundCompaction(",
    "PersaiInternalApiClientService must keep exporting enqueueBackgroundCompaction."
  );
  assertSourceContains(
    internalApiSource,
    "/api/v1/internal/runtime/compaction/enqueue",
    "PersaiInternalApiClientService must POST to the API enqueue endpoint."
  );
}

void run();
