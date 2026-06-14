import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeliverSafetyInboundWarnNoticeService } from "../src/modules/workspace-management/application/deliver-safety-inbound-warn-notice.service";

describe("DeliverSafetyInboundWarnNoticeService", () => {
  it("persists warn notice for web surface", async () => {
    let persisted = false;
    const service = new DeliverSafetyInboundWarnNoticeService(
      {
        async persistWarnNoticeIfPossible() {
          persisted = true;
          return "message-1";
        }
      } as never,
      {} as never,
      {} as never,
      {} as never
    );

    await service.deliverWarnNoticeIfPossible({
      userId: "user-1",
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      chatId: "chat-1",
      surface: "web",
      surfaceThreadKey: null,
      reasonCode: "hack_abuse",
      moderationCaseId: "case-1"
    });

    assert.equal(persisted, true);
  });

  it("sends telegram warn notice instead of persisting web chat message", async () => {
    let persisted = false;
    let sentText: string | null = null;
    const service = new DeliverSafetyInboundWarnNoticeService(
      {
        async persistWarnNoticeIfPossible() {
          persisted = true;
          return "message-1";
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            botToken: "token",
            outbound: true
          };
        }
      } as never,
      {
        async forUserInWorkspace() {
          return "ru";
        }
      } as never,
      {
        async sendPlainText(_botToken: string, _chatId: string, text: string) {
          sentText = text;
        }
      } as never
    );

    await service.deliverWarnNoticeIfPossible({
      userId: "user-1",
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      chatId: null,
      surface: "telegram",
      surfaceThreadKey: "telegram:12345:session:main",
      reasonCode: "hack_abuse",
      moderationCaseId: "case-1"
    });

    assert.equal(persisted, false);
    assert.notEqual(sentText, null);
    assert.match(sentText ?? "", /Внимание/);
  });
});
