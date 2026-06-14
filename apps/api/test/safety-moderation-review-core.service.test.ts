import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafetyModerationReviewCoreService } from "../src/modules/workspace-management/application/safety-moderation-review-core.service";

describe("SafetyModerationReviewCoreService warn delivery", () => {
  it("does not deliver warn notice when moderation case already exists for triggerKey", async () => {
    let deliverCalls = 0;
    const service = new SafetyModerationReviewCoreService(
      {
        async $queryRaw() {
          return [{ id: "case-existing" }];
        }
      } as never,
      {} as never,
      {} as never,
      {
        async deliverWarnNoticeIfPossible() {
          deliverCalls += 1;
        }
      } as never
    );

    const result = await service.reviewTrigger({
      triggerKey: "user-1:assistant-1:abc",
      userId: "user-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: null,
      surface: "telegram",
      surfaceThreadKey: "telegram:123:session:main",
      triggerText: "hack account",
      precheck: {
        route: "defer_contour_2",
        reasonCode: "hack_abuse",
        rulePack: "hack_abuse_warn_first",
        confidence: "medium"
      }
    });

    assert.equal(result.alreadyExisted, true);
    assert.equal(deliverCalls, 0);
  });
});
