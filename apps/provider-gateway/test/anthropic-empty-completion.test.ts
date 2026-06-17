import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";

// ADR-074 F2: regression coverage for "anthropic_empty_completion".
// Same contract as openai-empty-completion.test.ts — empty completions must
// resolve to text=null + stopReason="completed" (and a single warn) instead of
// throwing 500 / yielding `failed` events.

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS: 5,
    PROVIDER_GATEWAY_BOOT_WARMUP_RETRY_DELAY_MS: 2_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_RECOVERY_INTERVAL_MS: 10_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://production-sfo.browserless.io",
    PROVIDER_GATEWAY_OPENAI_API_KEY: undefined,
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: "anthropic-test-key",
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    systemPrompt: null,
    messages: [{ role: "user", content: "ping" }]
  };
}

function installFakeAnthropic(
  client: AnthropicProviderClient,
  responseFactory: () => unknown
): void {
  (
    client as unknown as {
      client: {
        messages: {
          stream: (payload: unknown, options?: unknown) => { finalMessage: () => Promise<unknown> };
          create: (payload: unknown, options?: unknown) => Promise<unknown>;
        };
      };
    }
  ).client = {
    messages: {
      stream: () => ({
        finalMessage: async () => responseFactory()
      }),
      create: async () => responseFactory()
    }
  };
}

async function collectStream(
  stream: AsyncGenerator<ProviderGatewayTextStreamEvent>
): Promise<ProviderGatewayTextStreamEvent[]> {
  const events: ProviderGatewayTextStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function runEmptyNonStreamingTest(): Promise<void> {
  const client = new AnthropicProviderClient(createConfig());
  await client.warm();
  installFakeAnthropic(client, () => ({
    content: [{ type: "thinking", thinking: "internal" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 0 }
  }));

  const result = await client.generateText(createRequest());

  assert.equal(result.text, null);
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.toolCalls, []);
  assert.equal(result.usage?.outputTokens, 0);
}

async function runToolCallsStillSurfaceTest(): Promise<void> {
  const client = new AnthropicProviderClient(createConfig());
  await client.warm();
  installFakeAnthropic(client, () => ({
    content: [
      {
        type: "tool_use",
        id: "tu-1",
        name: "scheduled_action",
        input: { audience: "user" }
      }
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 9, output_tokens: 1 }
  }));

  const result = await client.generateText(createRequest());

  assert.equal(result.stopReason, "tool_calls");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.name, "scheduled_action");
}

async function runEmptyStreamingTest(): Promise<void> {
  const client = new AnthropicProviderClient(createConfig());
  await client.warm();
  installFakeAnthropic(client, () =>
    (async function* (): AsyncGenerator<unknown> {
      yield { type: "message_start", message: { usage: { input_tokens: 7, output_tokens: 0 } } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} };
      yield { type: "message_stop" };
    })()
  );

  const events = await collectStream(client.streamText(createRequest()));
  const lastEvent = events.at(-1);

  assert.ok(lastEvent !== undefined, "stream should produce at least one event");
  assert.equal(lastEvent.type, "completed");
  if (lastEvent.type === "completed") {
    assert.equal(lastEvent.result.text, null);
    assert.equal(lastEvent.result.stopReason, "completed");
  }
  assert.equal(
    events.some((event) => event.type === "failed"),
    false
  );
}

export async function runAnthropicEmptyCompletionTest(): Promise<void> {
  await runEmptyNonStreamingTest();
  await runToolCallsStillSurfaceTest();
  await runEmptyStreamingTest();
}
