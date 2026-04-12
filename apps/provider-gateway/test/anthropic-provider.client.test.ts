import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
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
    systemPrompt: "Be concise.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "look at this"
          },
          {
            type: "image",
            mimeType: "image/jpeg",
            dataBase64: "aGVsbG8=",
            filename: "photo.jpg"
          },
          {
            type: "pdf",
            mimeType: "application/pdf",
            dataBase64: "cGRmLWRhdGE=",
            filename: "report.pdf"
          }
        ]
      },
      {
        role: "assistant",
        content: "what should I inspect?"
      },
      {
        role: "user",
        content: "the connector pins"
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

export async function runAnthropicProviderClientTest(): Promise<void> {
  const client = new AnthropicProviderClient(createConfig());
  let capturedGenerateInput: unknown = null;
  let capturedStreamInput: unknown = null;

  (client as unknown as { client: unknown }).client = {
    messages: {
      create: async (payload: { stream?: boolean; messages: unknown }) => {
        if (payload.stream) {
          capturedStreamInput = payload.messages;
          return (async function* (): AsyncGenerator<unknown> {
            yield {
              type: "message_start",
              message: {
                usage: {
                  input_tokens: 10,
                  output_tokens: 0
                }
              }
            };
            yield {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: "partial "
              }
            };
            yield {
              type: "message_delta",
              usage: {
                output_tokens: 5
              }
            };
            yield {
              type: "message_stop"
            };
          })();
        }

        capturedGenerateInput = payload.messages;
        return {
          content: [
            {
              type: "text",
              text: "done"
            }
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5
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
      content: [
        {
          type: "text",
          text: "look at this"
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "aGVsbG8="
          }
        },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "cGRmLWRhdGE="
          },
          title: "report.pdf"
        }
      ]
    },
    {
      role: "assistant",
      content: "what should I inspect?"
    },
    {
      role: "user",
      content: "the connector pins"
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
