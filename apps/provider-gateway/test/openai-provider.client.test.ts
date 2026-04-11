import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
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
    systemPrompt: "Be concise.",
    messages: [
      {
        role: "user",
        content: "hello"
      },
      {
        role: "assistant",
        content: "hi there"
      },
      {
        role: "user",
        content: "tell me more"
      }
    ]
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

export async function runOpenAIProviderClientTest(): Promise<void> {
  const client = new OpenAIProviderClient(createConfig());
  let capturedGenerateInput: unknown = null;
  let capturedStreamInput: unknown = null;

  (client as unknown as { client: unknown }).client = {
    responses: {
      create: async (payload: { stream?: boolean; input: unknown }) => {
        if (payload.stream) {
          capturedStreamInput = payload.input;
          return (async function* (): AsyncGenerator<unknown> {
            yield {
              type: "response.output_text.delta",
              delta: "partial "
            };
            yield {
              type: "response.completed",
              response: {
                output_text: "partial done",
                usage: {
                  input_tokens: 10,
                  output_tokens: 5,
                  total_tokens: 15
                }
              }
            };
          })();
        }

        capturedGenerateInput = payload.input;
        return {
          output_text: "done",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15
          }
        };
      }
    }
  };

  const request = createRequest();
  const result = await client.generateText(request);
  assert.equal(result.text, "done");
  assert.deepEqual(capturedGenerateInput, [
    {
      role: "user",
      content: "hello"
    },
    {
      role: "assistant",
      content: "hi there"
    },
    {
      role: "user",
      content: "tell me more"
    }
  ]);

  const stream = await client.streamText(request);
  const events = await collectStream(stream);
  assert.deepEqual(capturedStreamInput, capturedGenerateInput);
  assert.deepEqual(
    events.map((event) => event.type),
    ["text_delta", "completed"]
  );
}
