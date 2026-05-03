import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { InternalRuntimeToolQuotaController } from "../src/modules/workspace-management/interface/http/internal-runtime-tool-quota.controller";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "gateway-token";

  const successController = new InternalRuntimeToolQuotaController(
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode: string; dailyCallLimit: number };
      },
      async execute() {
        return { ok: true, currentCount: 2, limit: 3 };
      }
    } as never,
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode: string; units: number };
      },
      async execute() {
        return {
          ok: true,
          allowed: true,
          currentUsedUnits: 1,
          limitUnits: 10,
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period"
        };
      }
    } as never,
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode: string; units: number };
      },
      async release() {
        return { ok: true };
      },
      async markReconciliationRequired() {
        return { ok: true };
      }
    } as never,
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode?: string };
      },
      async execute() {
        return {
          ok: true,
          planCode: "pro",
          tools: [
            {
              toolCode: "web_search",
              activationStatus: "active",
              dailyCallLimit: 3,
              currentCount: 2,
              allowed: true
            }
          ],
          buckets: [
            {
              bucketCode: "token_budget",
              displayName: "Token budget",
              unit: "tokens",
              used: 1250,
              limit: 5000,
              percent: 25,
              usageAvailable: true,
              status: "ok"
            }
          ]
        };
      }
    } as never
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

  const check = await successController.checkToolDailyQuota(
    { headers: { authorization: "Bearer gateway-token" } },
    { assistantId: "assistant-1", toolCode: "web_search" }
  );
  assert.equal(check.planCode, "pro");
  assert.equal(check.tools[0]?.toolCode, "web_search");
  assert.equal(check.buckets[0]?.bucketCode, "token_budget");
  assert.equal(check.buckets.length, 1);

  const reserve = await successController.reserveMonthlyMediaQuota(
    { headers: { authorization: "Bearer gateway-token" } },
    { assistantId: "assistant-1", toolCode: "image_generate", units: 1 }
  );
  assert.equal(reserve.allowed, true);
  assert.equal(reserve.limitUnits, 10);

  assert.deepEqual(
    await successController.releaseMonthlyMediaQuota(
      { headers: { authorization: "Bearer gateway-token" } },
      { assistantId: "assistant-1", toolCode: "image_generate", units: 1 }
    ),
    { ok: true }
  );

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
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode: string; units: number };
      },
      async execute() {
        return {
          ok: true,
          allowed: true,
          currentUsedUnits: 1,
          limitUnits: 10,
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period"
        };
      }
    } as never,
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode: string; units: number };
      },
      async release() {
        return { ok: true };
      },
      async markReconciliationRequired() {
        return { ok: true };
      }
    } as never,
    {
      parseInput(body: unknown) {
        return body as { assistantId: string; toolCode?: string };
      },
      async execute() {
        return { ok: true, planCode: null, tools: [], buckets: [] };
      }
    } as never
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
