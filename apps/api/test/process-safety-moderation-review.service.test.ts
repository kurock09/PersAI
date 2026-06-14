import assert from "node:assert/strict";
import { ProcessSafetyModerationReviewService } from "../src/modules/workspace-management/application/process-safety-moderation-review.service";

async function run(): Promise<void> {
  let reviewCalls = 0;
  const service = new ProcessSafetyModerationReviewService(
    {
      safetyModerationReviewJob: {
        update: async () => ({ id: "job-1" })
      },
      assistantChatMessage: {
        findFirst: async () => null
      }
    } as never,
    {
      async reviewTrigger() {
        reviewCalls += 1;
        return {
          alreadyExisted: false,
          moderationCaseId: "case-1",
          decision: "block_user",
          reasonCode: "violence_extremism",
          restrictionCreated: true
        };
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
      route: "hold_and_defer_contour_2_sync",
      confidence: "high",
      reasonCode: "violence_extremism",
      rulePack: "violence_extremism_explicit",
      matchedSignals: ["violence.mass_attack_instruction_en"]
    }
  });

  assert.equal(reviewCalls, 1);
}

run()
  .then(() => {
    console.log("process-safety-moderation-review.service.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
