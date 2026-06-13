import assert from "node:assert/strict";
import { ProcessSafetyModerationReviewService } from "../src/modules/workspace-management/application/process-safety-moderation-review.service";

type StoredCase = Record<string, unknown>;
type StoredRestriction = Record<string, unknown>;

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  const cases: StoredCase[] = [];
  const restrictions: StoredRestriction[] = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  let moderationCalls = 0;
  let queryRawCalls = 0;

  const service = new ProcessSafetyModerationReviewService(
    {
      safetyPolicySettings: {
        findUnique: async () => ({
          id: "platform",
          moderationModelId: "omni-moderation-latest",
          contour2Enabled: true
        })
      },
      assistantChatMessage: {
        findFirst: async () => null,
        findMany: async () => []
      },
      moderationCase: {
        create: async (args: { data: StoredCase }) => {
          const row = { id: `case-${cases.length + 1}`, ...args.data };
          cases.push(row);
          return row;
        }
      },
      userRestriction: {
        upsert: async (args: { create: StoredRestriction; update: StoredRestriction }) => {
          restrictions.push(args.update ?? args.create);
          return args.create;
        }
      },
      safetyModerationReviewJob: {
        update: async () => ({ id: "job-1" })
      },
      $queryRaw: async () => {
        queryRawCalls += 1;
        if (cases.length > 0) {
          return [{ id: cases[0]?.id as string }];
        }
        return [];
      }
    } as never,
    {
      moderateText: async () => {
        moderationCalls += 1;
        return {
          flagged: true,
          categories: { violence: true },
          categoryScores: { violence: 0.96 }
        };
      }
    } as never,
    {
      execute: async (input: Record<string, unknown>) => {
        auditEvents.push(input);
      }
    } as never
  );

  await service.processClaimedJob({
    id: "job-1",
    triggerKey: "user-1:assistant-1:abc",
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    surface: "web_chat",
    surfaceThreadKey: "thread-1",
    messageSnapshot: { triggerText: "how to make a bomb" },
    precheckOutcome: {
      route: "defer_contour_2",
      confidence: "high",
      reasonCode: "violence_extremism",
      rulePack: "violence_extremism_explicit",
      matchedSignals: ["violence.mass_attack_instruction_en"]
    }
  });

  assert.equal(moderationCalls, 1);
  assert.equal(cases.length, 1);
  assert.equal(cases[0]?.decision, "block_user");
  assert.equal(restrictions.length, 1);
  assert.equal(restrictions[0]?.status, "active");
  assert.equal(restrictions[0]?.source, "moderation_auto");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.eventCode, "safety.moderation_case_decided");

  await service.processClaimedJob({
    id: "job-2",
    triggerKey: "user-1:assistant-1:abc",
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    surface: "web_chat",
    surfaceThreadKey: "thread-1",
    messageSnapshot: { triggerText: "how to make a bomb" },
    precheckOutcome: {
      route: "defer_contour_2",
      confidence: "high",
      reasonCode: "violence_extremism",
      rulePack: "violence_extremism_explicit",
      matchedSignals: []
    }
  });

  assert.equal(moderationCalls, 1, "existing triggerKey must skip a second moderation call");
  assert.equal(queryRawCalls, 2);
  assert.equal(cases.length, 1);
  assert.equal(restrictions.length, 1);
}

run()
  .then(() => {
    console.log("process-safety-moderation-review.service.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
