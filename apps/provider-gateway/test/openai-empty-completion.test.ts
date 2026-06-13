import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";

// ADR-074 F2: regression coverage for "openai_empty_completion".
// Before F2 the OpenAI client threw `Error("OpenAI provider response did not contain
// text output.")` whenever the model returned no text and no tool_calls — that bubbled
// up as `AssistantRuntimeError: Provider gateway request failed with status 500.`
// inside the api scheduler, retried 5×, then dead-lettered the task with no signal
// to the user (see GKE 2026-04-23T11:56:55..12:04:39 for taskId fc23766c-...).
// We now treat empty completions as a valid end-of-turn (text=null, stopReason=completed)
// + structured warn — these tests pin that contract.

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
    PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "openai",
    model: "gpt-5.4",
    systemPrompt: null,
    messages: [{ role: "user", content: "ping" }]
  };
}

function installFakeOpenAI(client: OpenAIProviderClient, responseFactory: () => unknown): void {
  (
    client as unknown as {
      client: {
        responses: { create: (payload: unknown, options?: unknown) => Promise<unknown> };
      };
    }
  ).client = {
    responses: {
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
  const client = new OpenAIProviderClient(createConfig());
  await client.warm();
  installFakeOpenAI(client, () => ({
    output: [{ type: "reasoning", id: "r-1" }],
    output_text: "",
    usage: { input_tokens: 12, output_tokens: 0, total_tokens: 12 }
  }));

  const result = await client.generateText(createRequest());

  assert.equal(result.text, null);
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.toolCalls, []);
  assert.equal(result.usage?.outputTokens, 0);
}

async function runToolCallsStillSurfaceTest(): Promise<void> {
  const client = new OpenAIProviderClient(createConfig());
  await client.warm();
  installFakeOpenAI(client, () => ({
    output: [
      {
        type: "function_call",
        call_id: "call-1",
        name: "scheduled_action",
        arguments: '{"audience":"user"}'
      }
    ],
    output_text: "",
    usage: { input_tokens: 9, output_tokens: 1, total_tokens: 10 }
  }));

  const result = await client.generateText(createRequest());

  assert.equal(result.stopReason, "tool_calls");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.name, "scheduled_action");
}

async function runEmptyStreamingTest(): Promise<void> {
  const client = new OpenAIProviderClient(createConfig());
  await client.warm();
  installFakeOpenAI(client, () =>
    (async function* (): AsyncGenerator<unknown> {
      yield {
        type: "response.completed",
        response: {
          output: [{ type: "reasoning", id: "r-2" }],
          output_text: "",
          usage: { input_tokens: 7, output_tokens: 0, total_tokens: 7 }
        }
      };
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

export async function runOpenAIEmptyCompletionTest(): Promise<void> {
  await runEmptyNonStreamingTest();
  await runToolCallsStillSurfaceTest();
  await runEmptyStreamingTest();
}
