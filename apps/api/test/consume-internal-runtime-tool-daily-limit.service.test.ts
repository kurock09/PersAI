import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ConsumeInternalRuntimeToolDailyLimitService } from "../src/modules/workspace-management/application/consume-internal-runtime-tool-daily-limit.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "../src/modules/workspace-management/application/resolve-internal-runtime-tool-daily-policy.service";

async function run(): Promise<void> {
  const consumeCalls: Array<{
    toolCode: string;
    dailyCallLimit: number | null;
    units: number | undefined;
  }> = [];
  const quotaGroundedLimitCopyService = {
    async build() {
      return null;
    }
  } as never;

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
    sandboxEgressMode: "restricted",
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
      async consumeToolDailyLimit(input: {
        toolCode: string;
        dailyCallLimit: number | null;
        units?: number;
      }) {
        consumeCalls.push({
          toolCode: input.toolCode,
          dailyCallLimit: input.dailyCallLimit,
          units: input.units
        });
        return {
          allowed: true,
          currentCount: 2,
          limit: input.dailyCallLimit
        };
      }
    } as never,
    quotaGroundedLimitCopyService
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    toolCode: "web_search",
    dailyCallLimit: 5,
    units: 1
  });
  assert.deepEqual(result, {
    ok: true,
    currentCount: 2,
    limit: 2
  });
  assert.deepEqual(consumeCalls, [{ toolCode: "web_search", dailyCallLimit: 2, units: 1 }]);

  // ── ADR-074 L1.1: parseInput accepts an absent `units` (treated as 1
  // for backward compat with older runtime workers) and a null
  // `dailyCallLimit` (always-count mode).
  const parsed = service.parseInput({
    assistantId: "assistant-1",
    toolCode: "image_generate"
  });
  assert.equal(parsed.units, 1, "ADR-074 L1.1: missing `units` defaults to 1.");
  assert.equal(parsed.dailyCallLimit, null, "ADR-074 L1.1: missing `dailyCallLimit` is null.");

  // ── ADR-074 L1.1: image_generate-style weighted call (units=4 for
  // a single tool call producing 4 artifacts) is forwarded verbatim to
  // the tracker.
  const weightedCalls: Array<{ units: number | undefined; limit: number | null }> = [];
  const weightedService = new ConsumeInternalRuntimeToolDailyLimitService(
    {
      async execute() {
        return {
          assistant,
          planCode: "starter_trial",
          tools: [
            {
              toolCode: "image_generate",
              activationStatus: "active" as const,
              dailyCallLimit: 50
            }
          ]
        };
      }
    } as never,
    {
      async consumeToolDailyLimit(input: { dailyCallLimit: number | null; units?: number }) {
        weightedCalls.push({ units: input.units, limit: input.dailyCallLimit });
        return { allowed: true, currentCount: 4, limit: input.dailyCallLimit };
      }
    } as never,
    quotaGroundedLimitCopyService
  );
  await weightedService.execute({
    assistantId: "assistant-1",
    toolCode: "image_generate",
    dailyCallLimit: 50,
    units: 4
  });
  assert.deepEqual(weightedCalls, [{ units: 4, limit: 50 }]);

  // ── ADR-074 L1.1: when the plan has NO daily cap, the request still
  // succeeds (always-count mode) and the API returns `limit: null`.
  const unlimitedCalls: Array<{ limit: number | null }> = [];
  const unlimitedService = new ConsumeInternalRuntimeToolDailyLimitService(
    {
      async execute() {
        return {
          assistant,
          planCode: "starter_trial",
          tools: [
            {
              toolCode: "tts",
              activationStatus: "active" as const,
              dailyCallLimit: null
            }
          ]
        };
      }
    } as never,
    {
      async consumeToolDailyLimit(input: { dailyCallLimit: number | null }) {
        unlimitedCalls.push({ limit: input.dailyCallLimit });
        return { allowed: true, currentCount: 17, limit: null };
      }
    } as never,
    quotaGroundedLimitCopyService
  );
  const unlimitedResult = await unlimitedService.execute({
    assistantId: "assistant-1",
    toolCode: "tts",
    dailyCallLimit: null,
    units: 1
  });
  assert.deepEqual(unlimitedResult, { ok: true, currentCount: 17, limit: null });
  assert.deepEqual(unlimitedCalls, [{ limit: null }]);

  // ── Platform-managed system tools are not plan activations. They must
  // still be consumable for observability on every plan.
  const platformManagedResolver = new ResolveInternalRuntimeToolDailyPolicyService(
    {
      async resolveByAssistantId() {
        return {
          assistant,
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId
        };
      }
    } as never,
    {
      async findByAssistantId() {
        return {
          assistantPlanOverrideCode: null,
          quotaPlanCode: null
        };
      }
    } as never,
    {
      async execute() {
        return {
          planCode: "starter_trial"
        };
      }
    } as never,
    {
      async findByCode() {
        return {
          toolActivations: []
        };
      }
    } as never
  );
  const platformManagedPolicy = await platformManagedResolver.execute({
    assistantId: "assistant-1",
    toolCode: "memory_write"
  });
  assert.deepEqual(platformManagedPolicy.tools, [
    {
      toolCode: "memory_write",
      displayName: "memory_write",
      activationStatus: "active",
      dailyCallLimit: null
    }
  ]);

  // ── Tool deactivated mid-flight remains a hard rejection (only blocking
  // path left after L1.1).
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
        {} as never,
        quotaGroundedLimitCopyService
      ).execute({
        assistantId: "assistant-1",
        toolCode: "web_search",
        dailyCallLimit: 5,
        units: 1
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "tool_daily_limit_reached" &&
      error.errorObject.message.includes("no longer active")
  );

  // ── parseInput rejects non-positive `units` so a buggy runtime cannot
  // zero or reverse the daily counter.
  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        toolCode: "image_generate",
        dailyCallLimit: 50,
        units: 0
      }),
    /units must be a positive integer/
  );
  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        toolCode: "image_generate",
        dailyCallLimit: 50,
        units: -3
      }),
    /units must be a positive integer/
  );
}

void run();
