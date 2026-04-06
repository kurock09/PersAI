import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ConsumeInternalRuntimeToolDailyLimitService } from "../src/modules/workspace-management/application/consume-internal-runtime-tool-daily-limit.service";

async function run(): Promise<void> {
  const consumeCalls: Array<{ toolCode: string; dailyCallLimit: number | null }> = [];

  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded",
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z")
  };

  const service = new ConsumeInternalRuntimeToolDailyLimitService(
    {
      async execute() {
        return {
          assistant,
          planCode: "starter_trial",
          tools: [
            {
              toolCode: "web_search",
              activationStatus: "active" as const,
              dailyCallLimit: 2
            }
          ]
        };
      }
    } as never,
    {
      async consumeToolDailyLimit(input: { toolCode: string; dailyCallLimit: number | null }) {
        consumeCalls.push({
          toolCode: input.toolCode,
          dailyCallLimit: input.dailyCallLimit
        });
        return {
          allowed: true,
          currentCount: 2,
          limit: input.dailyCallLimit
        };
      }
    } as never
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    toolCode: "web_search",
    dailyCallLimit: 5
  });
  assert.deepEqual(result, {
    ok: true,
    currentCount: 2,
    limit: 2
  });
  assert.deepEqual(consumeCalls, [{ toolCode: "web_search", dailyCallLimit: 2 }]);

  await assert.rejects(
    () =>
      new ConsumeInternalRuntimeToolDailyLimitService(
        {
          async execute() {
            return {
              assistant,
              planCode: "starter_trial",
              tools: [
                {
                  toolCode: "web_search",
                  activationStatus: "inactive" as const,
                  dailyCallLimit: 2
                }
              ]
            };
          }
        } as never,
        {} as never
      ).execute({
        assistantId: "assistant-1",
        toolCode: "web_search",
        dailyCallLimit: 5
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "tool_daily_limit_reached" &&
      error.errorObject.message.includes("no longer active")
  );
}

void run();
