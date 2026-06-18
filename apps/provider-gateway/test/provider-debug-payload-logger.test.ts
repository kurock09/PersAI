import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import { ProviderDebugPayloadLogger } from "../src/modules/providers/provider-debug-payload-logger";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withMathRandom<T>(value: number, fn: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function withDebugCapture<T>(fn: (events: unknown[]) => T): T {
  const events: unknown[] = [];
  // ADR-119 Slice 14: dumps now emit via `logger.log()` (info) so they surface
  // without LOG_LEVEL=debug. The capture name stays for backwards compatibility
  // with existing call sites.
  const prototype = Logger.prototype as unknown as {
    log(message: unknown): void;
  };
  const originalLog = prototype.log;
  prototype.log = (message: unknown) => {
    events.push(message);
  };
  try {
    return fn(events);
  } finally {
    prototype.log = originalLog;
  }
}

export async function runProviderDebugPayloadLoggerTest(): Promise<void> {
  const logger = new ProviderDebugPayloadLogger("persai.debug.provider.test");

  withEnv(
    {
      PERSAI_DEBUG_PROVIDER_PAYLOAD: undefined,
      PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: undefined
    },
    () => {
      assert.equal(logger.shouldDump(), false);
    }
  );

  // ADR-119 Slice 14: any common truthy spelling enables the dumper.
  for (const value of ["1", "true", "TRUE", "True", "yes", "YES", "on", "ON", " true "]) {
    withEnv(
      { PERSAI_DEBUG_PROVIDER_PAYLOAD: value, PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "1.0" },
      () => {
        withMathRandom(0.5, () => {
          assert.equal(
            logger.shouldDump(),
            true,
            `expected truthy for spelling: ${JSON.stringify(value)}`
          );
        });
      }
    );
  }

  for (const value of ["", "0", "false", "FALSE", "no", "off", "anything-else"]) {
    withEnv({ PERSAI_DEBUG_PROVIDER_PAYLOAD: value }, () => {
      assert.equal(
        logger.shouldDump(),
        false,
        `expected falsy for spelling: ${JSON.stringify(value)}`
      );
    });
  }

  withEnv(
    { PERSAI_DEBUG_PROVIDER_PAYLOAD: "true", PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "1.0" },
    () => {
      withMathRandom(0.5, () => {
        for (let index = 0; index < 10; index += 1) {
          assert.equal(logger.shouldDump(), true);
        }
      });
    }
  );

  withEnv(
    { PERSAI_DEBUG_PROVIDER_PAYLOAD: "true", PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "0.0" },
    () => {
      withMathRandom(0, () => {
        for (let index = 0; index < 10; index += 1) {
          assert.equal(logger.shouldDump(), false);
        }
      });
    }
  );

  withEnv(
    { PERSAI_DEBUG_PROVIDER_PAYLOAD: "true", PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "not-a-number" },
    () => {
      withMathRandom(0, () => {
        assert.equal(logger.shouldDump(), true);
      });
      withMathRandom(0.99, () => {
        assert.equal(logger.shouldDump(), false);
      });
    }
  );

  withEnv(
    { PERSAI_DEBUG_PROVIDER_PAYLOAD: "true", PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "1.0" },
    () => {
      withMathRandom(0, () => {
        withDebugCapture((events) => {
          const base64 = "iVBORw0KGgo...";
          logger.dumpRequest({
            provider: "anthropic",
            requestId: "request-redact",
            payload: {},
            systemPromptText: null,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: base64
                    }
                  }
                ]
              }
            ]
          });
          const serialized = JSON.stringify(events[0]);
          assert.match(serialized, /<redacted:image\/png:base64:LENGTH=14>/);
          assert.equal(serialized.includes(base64), false);
        });
      });
    }
  );

  withEnv(
    { PERSAI_DEBUG_PROVIDER_PAYLOAD: "true", PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "1.0" },
    () => {
      withMathRandom(0, () => {
        withDebugCapture((events) => {
          logger.dumpRequest({
            provider: "openai",
            requestId: "request-truncate",
            payload: {},
            systemPromptText: `${"a".repeat(500)}${"b".repeat(500)}${"c".repeat(500)}`,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: "x".repeat(600)
                  },
                  {
                    type: "tool_use",
                    input: {
                      value: "y".repeat(600)
                    }
                  }
                ]
              }
            ]
          });
          const event = events[0] as {
            system: {
              systemPromptFirst500: string;
              systemPromptLast500: string | null;
              systemPromptTotalChars: number;
            };
            messages: Array<{ textPreview: string | null; toolPreview: string | null }>;
          };
          assert.equal(event.system.systemPromptFirst500, "a".repeat(500));
          assert.equal(
            event.system.systemPromptLast500,
            `...[1500 chars total]...${"c".repeat(500)}`
          );
          assert.equal(event.system.systemPromptTotalChars, 1500);
          assert.equal(event.messages[0]?.textPreview, "x".repeat(500));
          assert.equal(event.messages[0]?.toolPreview?.length, 500);
        });

        withDebugCapture((events) => {
          const systemPrompt = "z".repeat(800);
          logger.dumpRequest({
            provider: "openai",
            requestId: "request-short-system",
            payload: {},
            systemPromptText: systemPrompt,
            messages: []
          });
          const event = events[0] as {
            system: {
              systemPromptFirst500: string;
              systemPromptLast500: string | null;
              systemPromptTotalChars: number;
            };
          };
          assert.equal(event.system.systemPromptFirst500, systemPrompt);
          assert.equal(event.system.systemPromptLast500, null);
          assert.equal(event.system.systemPromptTotalChars, 800);
        });
      });
    }
  );
}
