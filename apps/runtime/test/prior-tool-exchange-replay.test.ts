import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import { buildPriorToolExchangeReplayMap } from "../src/modules/turns/prior-tool-exchange-replay";
import {
  TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT,
  TOOL_OBSERVATION_MICRO_CLEAR_PRESSURE_RATIO,
  resolveMicroClearNextArmAfterClear,
  shouldApplyToolObservationMicroClear,
  shouldCrossToolObservationMicroClearArm
} from "../src/modules/turns/tool-observation-policy";

function createExchange(input: {
  id: string;
  name?: string;
  content: string;
  isError?: boolean;
}): ProviderGatewayToolExchange {
  return {
    toolCall: {
      id: input.id,
      name: input.name ?? "web_search",
      arguments: { q: input.id }
    },
    toolResult: {
      toolCallId: input.id,
      name: input.name ?? "web_search",
      content: JSON.stringify({ result: input.content }),
      isError: input.isError === true
    }
  };
}

function tierOf(exchange: ProviderGatewayToolExchange): string {
  const parsed = JSON.parse(exchange.toolResult.content) as { _observationTier?: string };
  assert.ok(
    parsed._observationTier === "full" ||
      parsed._observationTier === "compact" ||
      parsed._observationTier === "masked"
  );
  return parsed._observationTier;
}

function flattenReplay(
  map: Map<string, ProviderGatewayToolExchange[]>
): ProviderGatewayToolExchange[] {
  return [...map.values()].flat();
}

/**
 * ADR-161 A2 — hydrate-time micro-clear for prior tool exchanges.
 */
export async function runPriorToolExchangeReplayTest(): Promise<void> {
  assert.equal(TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT, 5);
  assert.equal(TOOL_OBSERVATION_MICRO_CLEAR_PRESSURE_RATIO, 0.5);

  assert.equal(
    shouldApplyToolObservationMicroClear({
      currentTokens: 3_999,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    false,
    "below 50% must not micro-clear"
  );
  assert.equal(
    shouldApplyToolObservationMicroClear({
      currentTokens: 4_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    true,
    "exactly 50% must micro-clear"
  );
  assert.equal(
    shouldApplyToolObservationMicroClear({
      currentTokens: 9_000,
      totalTokensFresh: false,
      compactionTriggerThreshold: 8_000
    }),
    false,
    "stale tokens must not micro-clear"
  );
  assert.equal(
    shouldApplyToolObservationMicroClear({
      currentTokens: null,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    false,
    "missing tokens must not micro-clear"
  );
  assert.equal(
    shouldApplyToolObservationMicroClear({
      priorToolMicroClearActive: true,
      currentTokens: 2_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    true,
    "active micro-clear stays on after meter drops"
  );
  assert.equal(
    shouldCrossToolObservationMicroClearArm({
      currentTokens: 2_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    false,
    "falling meter must not re-cross 50% arm"
  );
  assert.equal(
    shouldCrossToolObservationMicroClearArm({
      currentTokens: 4_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    true,
    "crossing 50% arms micro-clear"
  );
  assert.equal(
    resolveMicroClearNextArmAfterClear({
      lastArmPercent: 50,
      currentTokens: 1_600,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    50,
    "clear to <=45% keeps next arm at 50%"
  );
  assert.equal(
    resolveMicroClearNextArmAfterClear({
      lastArmPercent: 50,
      currentTokens: 3_601,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    75,
    "clear still >45% escalates next arm to 75%"
  );
  assert.equal(
    resolveMicroClearNextArmAfterClear({
      lastArmPercent: 75,
      currentTokens: 5_601,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    0,
    "clear at 75% still >70% exhausts micro-clear (wait for S3)"
  );
  assert.equal(
    shouldCrossToolObservationMicroClearArm({
      priorToolMicroClearNextArmPercent: 0,
      currentTokens: 9_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    }),
    false,
    "exhausted arm never re-crosses"
  );

  const messages = [
    { id: "u-1", author: "user" as const },
    {
      id: "a-1",
      author: "assistant" as const,
      toolExchanges: [
        createExchange({ id: "call-1", content: "one" }),
        createExchange({ id: "call-2", content: "two" })
      ]
    },
    { id: "u-2", author: "user" as const },
    {
      id: "a-2",
      author: "assistant" as const,
      toolExchanges: [
        createExchange({ id: "call-3", content: "three" }),
        createExchange({ id: "call-4", content: "four" }),
        createExchange({ id: "call-5", content: "five" }),
        createExchange({ id: "call-6", content: "six" }),
        createExchange({ id: "call-7", content: "seven" })
      ]
    },
    { id: "u-3", author: "user" as const }
  ];

  // Below 50% and inactive: all prior full (A1 behavior).
  {
    const map = buildPriorToolExchangeReplayMap(messages, "u-3", {
      currentTokens: 3_999,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    });
    const projected = flattenReplay(map);
    assert.equal(projected.length, 7);
    assert.deepEqual(
      projected.map(tierOf),
      ["full", "full", "full", "full", "full", "full", "full"],
      "below 50%: every prior exchange stays full"
    );
    assert.equal(map.get("a-1")?.[0]?.toolCall.id, "call-1");
    assert.equal(map.get("a-2")?.[4]?.toolCall.id, "call-7");
  }

  // Active with low meter: keep micro-clear (no re-expand oscillation).
  {
    const map = buildPriorToolExchangeReplayMap(messages, "u-3", {
      priorToolMicroClearActive: true,
      priorToolMicroClearNextArmPercent: 50,
      currentTokens: 2_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    });
    const projected = flattenReplay(map);
    assert.deepEqual(
      projected.map(tierOf),
      ["masked", "masked", "full", "full", "full", "full", "full"],
      "active clear keeps oldest bodies masked after meter drops"
    );
  }

  // No pressure input / null pressure: all full.
  {
    const map = buildPriorToolExchangeReplayMap(messages, "u-3", null);
    assert.deepEqual(flattenReplay(map).map(tierOf), [
      "full",
      "full",
      "full",
      "full",
      "full",
      "full",
      "full"
    ]);
  }

  // At/above 50%: only newest 5 full; older placeholder (masked).
  {
    const map = buildPriorToolExchangeReplayMap(messages, "u-3", {
      currentTokens: 4_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    });
    const projected = flattenReplay(map);
    assert.deepEqual(
      projected.map(tierOf),
      ["masked", "masked", "full", "full", "full", "full", "full"],
      "at 50%: older-than-newest-5 become placeholders; newest 5 stay full"
    );
    // Protocol ids/names/structure retained on placeholders.
    assert.equal(projected[0]?.toolCall.id, "call-1");
    assert.equal(projected[0]?.toolCall.name, "web_search");
    assert.equal(projected[0]?.toolResult.toolCallId, "call-1");
    assert.equal(projected[0]?.toolResult.name, "web_search");
    const maskedBody = JSON.parse(projected[0]!.toolResult.content) as {
      result?: unknown;
      gist?: unknown;
    };
    assert.equal(maskedBody.result, undefined);
    assert.equal(typeof maskedBody.gist, "string");
    assert.equal(projected[2]?.toolCall.id, "call-3");
    assert.equal(tierOf(projected[2]!), "full");
    const fullBody = JSON.parse(projected[2]!.toolResult.content) as { result?: string };
    assert.equal(fullBody.result, "three");
  }

  // Above 50% behaves the same as the 50% gate.
  {
    const map = buildPriorToolExchangeReplayMap(messages, "u-3", {
      currentTokens: 12_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    });
    assert.deepEqual(flattenReplay(map).map(tierOf), [
      "masked",
      "masked",
      "full",
      "full",
      "full",
      "full",
      "full"
    ]);
  }

  // Errors older than the keep window stay informative (compact), never bare mask.
  {
    const withError = [
      { id: "u-1", author: "user" as const },
      {
        id: "a-1",
        author: "assistant" as const,
        toolExchanges: [
          createExchange({ id: "err-1", content: "boom", isError: true }),
          createExchange({ id: "ok-1", content: "a" }),
          createExchange({ id: "ok-2", content: "b" }),
          createExchange({ id: "ok-3", content: "c" }),
          createExchange({ id: "ok-4", content: "d" }),
          createExchange({ id: "ok-5", content: "e" })
        ]
      },
      { id: "u-2", author: "user" as const }
    ];
    const map = buildPriorToolExchangeReplayMap(withError, "u-2", {
      currentTokens: 5_000,
      totalTokensFresh: true,
      compactionTriggerThreshold: 8_000
    });
    assert.deepEqual(flattenReplay(map).map(tierOf), [
      "compact",
      "full",
      "full",
      "full",
      "full",
      "full"
    ]);
  }

  // Mid-loop / in-turn path must never import or apply micro-clear.
  {
    const turnExecutionSource = readFileSync(
      resolve(__dirname, "../src/modules/turns/turn-execution.service.ts"),
      "utf8"
    );
    assert.equal(
      turnExecutionSource.includes("buildPriorToolExchangeReplayMap"),
      false,
      "turn-execution must not call prior-tool replay (micro-clear is hydrate-time only)"
    );
    assert.equal(
      turnExecutionSource.includes("shouldApplyToolObservationMicroClear"),
      false,
      "turn-execution must not apply micro-clear mid tool-loop"
    );
    assert.equal(
      turnExecutionSource.includes("TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT"),
      false,
      "turn-execution must not reference micro-clear keep-full count"
    );
    const toolLoopMatch = /private buildToolLoopProviderRequest\([\s\S]*?\n {2}\}\n/.exec(
      turnExecutionSource
    );
    assert.ok(toolLoopMatch, "buildToolLoopProviderRequest must exist");
    assert.ok(
      /toolHistory: \[\.\.\.input\.toolHistory\]/.test(toolLoopMatch[0]!),
      "buildToolLoopProviderRequest must pass through full in-turn toolHistory"
    );
  }
}
