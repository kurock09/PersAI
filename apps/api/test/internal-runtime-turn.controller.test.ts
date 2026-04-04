import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { InternalRuntimeTurnController } from "../src/modules/workspace-management/interface/http/internal-runtime-turn.controller";
import { RenderAssistantInboundSurfaceMessageService } from "../src/modules/workspace-management/application/render-assistant-inbound-surface-message.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "gateway-token";

  const successController = new InternalRuntimeTurnController(
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; threadId: string; message: string };
      },
      async execute() {
        return { assistantMessage: "Привет!", respondedAt: "2026-03-31T00:00:00.000Z" };
      }
    } as never,
    new RenderAssistantInboundSurfaceMessageService()
  );

  const success = await successController.handleTelegramTurn(
    { headers: { authorization: "Bearer gateway-token" } },
    { assistantId: "assistant-1", threadId: "chat-1", message: "hi" }
  );
  assert.deepEqual(success, {
    ok: true,
    assistantMessage: "Привет!",
    respondedAt: "2026-03-31T00:00:00.000Z"
  });

  const failureController = new InternalRuntimeTurnController(
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; threadId: string; message: string };
      },
      async execute() {
        throw new ApiErrorHttpException(429, {
          code: "rate_limited",
          category: "conflict",
          message: "Too many requests."
        });
      }
    } as never,
    new RenderAssistantInboundSurfaceMessageService()
  );

  const failure = await failureController.handleTelegramTurn(
    { headers: { authorization: "Bearer gateway-token" } },
    { assistantId: "assistant-1", threadId: "chat-1", message: "hi" }
  );
  assert.deepEqual(failure, {
    ok: false,
    code: "rate_limited",
    message: "Too many requests.",
    renderedMessage: "Requests are temporarily limited right now. Please try again in a moment."
  });
}

void run();
