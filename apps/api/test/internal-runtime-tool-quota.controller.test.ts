import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { InternalRuntimeToolQuotaController } from "../src/modules/workspace-management/interface/http/internal-runtime-tool-quota.controller";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.OPENCLAW_GATEWAY_TOKEN = "gateway-token";

  const successController = new InternalRuntimeToolQuotaController(
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode: string; dailyCallLimit: number };
      },
      async execute() {
        return { ok: true, currentCount: 2, limit: 3 };
      }
    } as never,
    {} as never
  );

  const success = await successController.consumeToolDailyLimit(
    { headers: { authorization: "Bearer gateway-token" } },
    { assistantId: "assistant-1", toolCode: "web_search", dailyCallLimit: 3 }
  );
  assert.deepEqual(success, {
    ok: true,
    currentCount: 2,
    limit: 3
  });

  const deniedController = new InternalRuntimeToolQuotaController(
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode: string; dailyCallLimit: number };
      },
      async execute() {
        throw new ApiErrorHttpException(409, {
          code: "tool_daily_limit_reached",
          category: "conflict",
          message: 'Daily tool usage limit reached for "web_search".'
        });
      }
    } as never,
    {} as never
  );

  await assert.rejects(
    () =>
      deniedController.consumeToolDailyLimit(
        { headers: { authorization: "Bearer gateway-token" } },
        { assistantId: "assistant-1", toolCode: "web_search", dailyCallLimit: 3 }
      ),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "tool_daily_limit_reached"
  );
}

void run();
