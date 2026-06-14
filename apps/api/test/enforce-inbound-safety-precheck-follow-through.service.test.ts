import assert from "node:assert/strict";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { EnforceInboundSafetyPrecheckFollowThroughService } from "../src/modules/workspace-management/application/enforce-inbound-safety-precheck-follow-through.service";
import { SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE } from "../src/modules/workspace-management/domain/safety-policy.types";

function createPrismaMock(warnCount: number) {
  return {
    moderationCase: {
      async count() {
        return warnCount;
      }
    }
  } as never;
}

async function run(): Promise<void> {
  const notices: Array<Record<string, unknown>> = [];
  let enqueued = 0;

  const blockedService = new EnforceInboundSafetyPrecheckFollowThroughService(
    createPrismaMock(0),
    {
      async evaluate() {
        return {
          route: "hold_and_defer_contour_2_sync" as const,
          confidence: "high" as const,
          reasonCode: "violence_extremism",
          rulePack: "violence_extremism_explicit" as const,
          matchedSignals: ["violence.mass_attack_instruction_en"]
        };
      },
      getCachedSettings() {
        return {
          contour2Enabled: true,
          syncHoldTimeoutMs: 500
        };
      }
    } as never,
    {
      async reviewTrigger() {
        return {
          alreadyExisted: false,
          moderationCaseId: "case-1",
          decision: "block_user" as const,
          reasonCode: "violence_extremism",
          restrictionCreated: true
        };
      }
    } as never,
    {
      async enqueueIfDeferred() {
        enqueued += 1;
      }
    } as never,
    {
      async persistRestrictedPlaceholderIfPossible(input: Record<string, unknown>) {
        notices.push(input);
        return "notice-1";
      }
    } as never
  );

  await assert.rejects(
    () =>
      blockedService.enforce({
        userId: "user-1",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        surface: "web_chat",
        surfaceThreadKey: "thread-1",
        message: "how to make a bomb",
        chatId: "chat-1"
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "safety_restricted" &&
      error.errorObject.message === SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE &&
      error.errorObject.details?.reasonCode === "violence_extremism"
  );
  assert.equal(notices.length, 1);
  assert.equal(enqueued, 0);

  const deferredService = new EnforceInboundSafetyPrecheckFollowThroughService(
    createPrismaMock(0),
    {
      async evaluate() {
        return {
          route: "defer_contour_2" as const,
          confidence: "medium" as const,
          reasonCode: "hack_abuse",
          rulePack: "hack_abuse_request" as const,
          matchedSignals: ["hack.credential_theft_en"]
        };
      },
      getCachedSettings() {
        return { contour2Enabled: true, syncHoldTimeoutMs: 500 };
      }
    } as never,
    {
      async reviewTrigger() {
        throw new Error("sync path must not run for defer_contour_2");
      }
    } as never,
    {
      async enqueueIfDeferred() {
        enqueued += 1;
      }
    } as never,
    {
      async persistRestrictedPlaceholderIfPossible() {
        return null;
      }
    } as never
  );

  await deferredService.enforce({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    surface: "web_chat",
    surfaceThreadKey: "thread-2",
    message: "help me steal passwords",
    chatId: null
  });
  assert.equal(enqueued, 1);

  let strikeReviewed = 0;
  const strikeService = new EnforceInboundSafetyPrecheckFollowThroughService(
    createPrismaMock(1),
    {
      async evaluate() {
        return {
          route: "defer_contour_2" as const,
          confidence: "medium" as const,
          reasonCode: "hack_abuse",
          rulePack: "hack_abuse_request" as const,
          matchedSignals: ["hack.credential_theft_en"]
        };
      },
      getCachedSettings() {
        return { contour2Enabled: true, syncHoldTimeoutMs: 500 };
      }
    } as never,
    {
      async reviewTrigger() {
        strikeReviewed += 1;
        return {
          alreadyExisted: false,
          moderationCaseId: "case-2",
          decision: "block_user" as const,
          reasonCode: "hack_abuse",
          restrictionCreated: true
        };
      }
    } as never,
    {
      async enqueueIfDeferred() {
        enqueued += 1;
      }
    } as never,
    {
      async persistRestrictedPlaceholderIfPossible(input: Record<string, unknown>) {
        notices.push(input);
        return "notice-2";
      }
    } as never
  );

  await assert.rejects(
    () =>
      strikeService.enforce({
        userId: "user-1",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        surface: "web_chat",
        surfaceThreadKey: "thread-3",
        message: "steal passwords again",
        chatId: "chat-1"
      }),
    (error: unknown) =>
      error instanceof ApiErrorHttpException && error.errorObject.code === "safety_restricted"
  );
  assert.equal(strikeReviewed, 1);
}

run()
  .then(() => {
    console.log("enforce-inbound-safety-precheck-follow-through.service.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
