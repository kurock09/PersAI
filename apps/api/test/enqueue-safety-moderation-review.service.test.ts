import assert from "node:assert/strict";
import { EnqueueSafetyModerationReviewService } from "../src/modules/workspace-management/application/enqueue-safety-moderation-review.service";

async function run(): Promise<void> {
  const upserts: Array<Record<string, unknown>> = [];
  const service = new EnqueueSafetyModerationReviewService({
    safetyModerationReviewJob: {
      upsert: async (args: Record<string, unknown>) => {
        upserts.push(args);
        return { id: "job-1" };
      }
    }
  } as never);

  await service.enqueueIfDeferred({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: null,
    surface: "web_chat",
    surfaceThreadKey: "thread-1",
    message: "how to make a bomb",
    precheck: {
      route: "allow",
      confidence: "none",
      reasonCode: "none",
      rulePack: null,
      matchedSignals: []
    }
  });
  assert.equal(upserts.length, 0);

  await service.enqueueIfDeferred({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    surface: "web_chat",
    surfaceThreadKey: "thread-1",
    message: "how to make a bomb",
    precheck: {
      route: "defer_contour_2",
      confidence: "high",
      reasonCode: "violence_extremism",
      rulePack: "violence_extremism_explicit",
      matchedSignals: ["violence.mass_attack_instruction_en"]
    }
  });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.create?.status, "pending");
}

run()
  .then(() => {
    console.log("enqueue-safety-moderation-review.service.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
