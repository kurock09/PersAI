import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeTextGenerationUsageForApi } from "../src/modules/workspace-management/application/text-generation-usage-accounting";

function v2Entry(input: {
  providerKey: "openai" | "anthropic" | "deepseek";
  uncached: number;
  write: number;
  read: number;
  output: number;
}) {
  const totalInputTokens = input.uncached + input.write + input.read;
  return {
    schemaVersion: 2 as const,
    stepType: "main_turn",
    modelRole: "normal_reply" as const,
    providerKey: input.providerKey,
    modelKey: `${input.providerKey}-text`,
    toolCode: null,
    totalInputTokens,
    uncachedInputTokens: input.uncached,
    cacheWriteInputTokens: input.write,
    cacheReadInputTokens: input.read,
    outputTokens: input.output,
    totalTokens: totalInputTokens + input.output
  };
}

function v2Envelope(entries: ReturnType<typeof v2Entry>[]) {
  const sum = (key: keyof ReturnType<typeof v2Entry>) =>
    entries.reduce((total, entry) => total + (typeof entry[key] === "number" ? entry[key] : 0), 0);
  return {
    schemaVersion: 2 as const,
    entries,
    totalInputTokens: sum("totalInputTokens"),
    uncachedInputTokens: sum("uncachedInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    cacheReadInputTokens: sum("cacheReadInputTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens")
  };
}

describe("ADR-161 S4 text usage consumer seam", () => {
  test("accepts canonical non-overlapping OpenAI, Anthropic, and DeepSeek entries", () => {
    const envelope = v2Envelope([
      v2Entry({ providerKey: "openai", uncached: 20, write: 10, read: 70, output: 5 }),
      v2Entry({ providerKey: "anthropic", uncached: 30, write: 20, read: 50, output: 7 }),
      v2Entry({ providerKey: "deepseek", uncached: 40, write: 0, read: 60, output: 9 })
    ]);
    const decoded = decodeTextGenerationUsageForApi({
      textUsageAccounting: envelope,
      legacyUsageAccounting: undefined
    });
    assert.equal(decoded.kind, "v2");
    if (decoded.kind !== "v2") return;
    assert.equal(decoded.usage.totalInputTokens, 300);
    assert.equal(decoded.usage.cacheWriteInputTokens, 30);
    assert.equal(decoded.usage.cacheReadInputTokens, 180);
  });

  test("fails closed for malformed totals and unknown explicit versions", () => {
    const malformed = v2Envelope([
      v2Entry({ providerKey: "openai", uncached: 1, write: 1, read: 1, output: 1 })
    ]);
    malformed.totalInputTokens = 999;
    assert.deepEqual(
      decodeTextGenerationUsageForApi({
        textUsageAccounting: malformed,
        legacyUsageAccounting: undefined
      }),
      { kind: "invalid", reason: "usage_v2_aggregate_totalInputTokens_mismatch" }
    );
    assert.deepEqual(
      decodeTextGenerationUsageForApi({
        textUsageAccounting: { schemaVersion: 3, entries: [] },
        legacyUsageAccounting: undefined
      }),
      { kind: "invalid", reason: "usage_schema_version_unknown" }
    );
  });

  test("keeps v1 as the bounded legacy seam and never upgrades it into v2", () => {
    const legacy = {
      inputTokens: 100,
      cachedInputTokens: 90,
      outputTokens: 10,
      totalTokens: 110,
      entries: []
    };
    assert.deepEqual(
      decodeTextGenerationUsageForApi({
        textUsageAccounting: undefined,
        legacyUsageAccounting: legacy
      }),
      { kind: "v1", usage: legacy }
    );
  });
});
