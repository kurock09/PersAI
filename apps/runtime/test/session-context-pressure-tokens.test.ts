import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveSessionContextPressureTokens } from "../src/modules/turns/session-context-pressure-tokens";

describe("resolveSessionContextPressureTokens", () => {
  test("prefers main_turn inputTokens over final-step totalTokens", () => {
    assert.equal(
      resolveSessionContextPressureTokens({
        usage: {
          providerKey: "deepseek",
          modelKey: "deepseek-v4-pro",
          inputTokens: 48_000,
          outputTokens: 2_000,
          totalTokens: 50_000
        },
        usageAccounting: {
          inputTokens: 90_000,
          cacheCreationInputTokens: null,
          cachedInputTokens: null,
          outputTokens: 5_000,
          totalTokens: 95_000,
          entries: [
            {
              stepType: "main_turn",
              modelRole: "premium_reply",
              providerKey: "deepseek",
              modelKey: "deepseek-v4-pro",
              inputTokens: 12_000,
              cacheCreationInputTokens: null,
              cachedInputTokens: 4_000,
              outputTokens: 400,
              totalTokens: 12_400
            },
            {
              stepType: "tool_loop_followup",
              modelRole: "premium_reply",
              providerKey: "deepseek",
              modelKey: "deepseek-v4-pro",
              inputTokens: 48_000,
              cacheCreationInputTokens: null,
              cachedInputTokens: 4_000,
              outputTokens: 2_000,
              totalTokens: 50_000
            }
          ]
        }
      }),
      12_000
    );
  });

  test("falls back to usage.inputTokens when accounting is absent", () => {
    assert.equal(
      resolveSessionContextPressureTokens({
        usage: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
      }),
      10
    );
  });

  test("falls back to totalTokens only when inputTokens is missing", () => {
    assert.equal(
      resolveSessionContextPressureTokens({
        usage: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          inputTokens: null,
          outputTokens: 20,
          totalTokens: 30
        }
      }),
      30
    );
  });

  test("returns null when no usable token fields exist", () => {
    assert.equal(
      resolveSessionContextPressureTokens({
        usage: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          inputTokens: null,
          outputTokens: null,
          totalTokens: null
        }
      }),
      null
    );
  });
});
