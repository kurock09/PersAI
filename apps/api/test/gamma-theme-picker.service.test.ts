import assert from "node:assert/strict";
import { GammaThemePickerService } from "../src/modules/workspace-management/application/gamma/gamma-theme-picker.service";

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  const originalAppEnv = process.env.APP_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalClerkSecretKey = process.env.CLERK_SECRET_KEY;
  const originalInternalApiToken = process.env.PERSAI_INTERNAL_API_TOKEN;
  const originalGatewayBaseUrl = process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL;

  try {
    process.env.APP_ENV = "local";
    process.env.DATABASE_URL = "postgresql://local:test@localhost:5432/persai";
    process.env.CLERK_SECRET_KEY = "test_clerk_secret";
    process.env.PERSAI_INTERNAL_API_TOKEN = "test_internal_token";
    process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL = "http://provider-gateway.local";
    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      if (typeof init?.body === "string" && init.body.length > 0) {
        requests.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return new Response(
        JSON.stringify({
          text: JSON.stringify({
            themeId: "school-calm",
            reason: "Clear, calm, readable school theme."
          })
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    const service = new GammaThemePickerService(
      {
        async listStandardThemes() {
          return [
            {
              id: "school-calm",
              name: "School Calm",
              type: "standard" as const,
              colorKeywords: ["blue", "green"],
              toneKeywords: ["clean", "friendly", "readable"]
            },
            {
              id: "dark-luxury",
              name: "Dark Luxury",
              type: "standard" as const,
              colorKeywords: ["black", "gold"],
              toneKeywords: ["luxury", "dramatic", "bold"]
            }
          ];
        }
      } as never,
      {
        async execute() {
          return {
            primary: {
              provider: "openai",
              model: "gpt-5.4-mini"
            }
          };
        }
      } as never
    );

    const result = await service.pickTheme({
      prompt: "Create a school biology deck for 6th grade.",
      sourceUserMessageText: "Нужна школьная презентация по биологии для 6 класса",
      visualStyle: "professional_modern",
      imagePolicy: "pictographic",
      visualDensity: "balanced"
    });

    assert.deepEqual(result, {
      themeId: "school-calm",
      reason: "Clear, calm, readable school theme."
    });
    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.match(
      String(request.systemPrompt),
      /For school, classroom, student, lesson, biology, history, geography, or educational decks/i
    );
    assert.match(
      String(request.systemPrompt),
      /For investor, startup, sales, board, or executive decks/i
    );
    const userMessage = (request.messages as Array<{ content: string }>)[0]!.content;
    assert.match(userMessage, /Selection rules:/);
    assert.match(
      userMessage,
      /School and educational decks should usually feel clean, approachable, and readable/i
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalClerkSecretKey === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = originalClerkSecretKey;
    }
    if (originalInternalApiToken === undefined) {
      delete process.env.PERSAI_INTERNAL_API_TOKEN;
    } else {
      process.env.PERSAI_INTERNAL_API_TOKEN = originalInternalApiToken;
    }
    if (originalGatewayBaseUrl === undefined) {
      delete process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL;
    } else {
      process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL = originalGatewayBaseUrl;
    }
  }
}

void run();
