import assert from "node:assert/strict";
import { EnqueueRuntimeDeferredMediaJobService } from "../src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service";

async function run(): Promise<void> {
  let enqueueCalls = 0;
  const service = new EnqueueRuntimeDeferredMediaJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-11T00:00:00.000Z")
        };
      },
      async findChatById(chatId: string) {
        return {
          id: chatId,
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          surface: "web" as const
        };
      }
    } as never,
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        enqueueCalls += 1;
        return { id: "job-1" };
      }
    } as never,
    {
      async build() {
        return {
          message: "Image edit is exhausted for the current monthly period. It resets Jun 1, 2026.",
          guidance:
            'Use a request that does not need media generation. You can also buy "Image pack" for $10 on /app/packages, or upgrade to Pro for a larger monthly limit.'
        };
      }
    } as never,
    {
      async execute() {
        return {
          planCode: "pro",
          monthlyMediaQuotas: {
            planCode: "pro",
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
            periodSource: "subscription_period" as const,
            tools: [
              {
                toolCode: "image_edit",
                displayName: "Image edit",
                usedUnits: 30,
                reservedUnits: 0,
                settledUnits: 30,
                releasedUnits: 0,
                reconciliationRequiredUnits: 0,
                limitUnits: 30,
                effectiveLimitUnits: 30,
                remainingUnits: 0,
                usageAvailable: true,
                status: "limit_reached" as const
              }
            ]
          }
        };
      }
    } as never,
    {
      async execute() {
        return {
          planCode: "pro",
          tools: [
            {
              toolCode: "image_edit",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Please recolor the logo",
    attachments: [],
    directToolExecution: {
      toolCode: "image_edit",
      request: {
        toolCode: "image_edit",
        prompt: "Recolor the logo orange",
        sourceImage: "previous attachment #1"
      } as never
    }
  });

  assert.deepEqual(result, {
    accepted: false,
    code: "monthly_media_quota_exceeded",
    message: "Image edit is exhausted for the current monthly period. It resets Jun 1, 2026.",
    guidance:
      'Use a request that does not need media generation. You can also buy "Image pack" for $10 on /app/packages, or upgrade to Pro for a larger monthly limit.'
  });
  assert.equal(enqueueCalls, 0);
}

void run();
