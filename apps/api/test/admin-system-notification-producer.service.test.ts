import assert from "node:assert/strict";
import { NotificationClass } from "@prisma/client";
import { AdminSystemNotificationProducerService } from "../src/modules/workspace-management/application/admin-system-notification-producer.service";
import type { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";

type IntentInput = Record<string, unknown>;

function makeRealtimeService(config: { eventCodes: string[]; recipientAssistantIds: string[] }) {
  const calls: IntentInput[] = [];
  const service = new AdminSystemNotificationProducerService(
    {
      notificationPolicy: {
        async findUnique() {
          return {
            enabled: true,
            channels: ["user_preferred"],
            config: {
              recipientAssistantIds: config.recipientAssistantIds,
              eventCodes: config.eventCodes,
              dailyReportEnabled: false,
              dailyReportTimeLocal: "21:00"
            }
          };
        }
      },
      assistant: {
        async findMany() {
          return config.recipientAssistantIds.map((id, index) => ({
            id,
            userId: `user-${index + 1}`,
            workspaceId: `ws-${index + 1}`,
            draftDisplayName: null,
            workspace: { timezone: "UTC" }
          }));
        }
      }
    } as never,
    {
      async createIntent(input: IntentInput) {
        calls.push(input);
        return {} as never;
      }
    } as unknown as NotificationIntentService
  );
  return { service, calls };
}

async function run(): Promise<void> {
  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["runtime_apply_failed"],
      recipientAssistantIds: ["assistant-1", "assistant-2"]
    });
    const emitted = await service.emitEvent({
      eventCode: "runtime_apply_failed",
      summary: "Runtime apply failed for assistant X.",
      details: { sourceWorkspaceId: "ws-src" },
      traceId: "audit-1",
      notificationClass: NotificationClass.operational
    });

    assert.equal(emitted, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.["source"], "admin_system");
    assert.equal(calls[0]?.["assistantId"], "assistant-1");
    assert.equal(calls[1]?.["assistantId"], "assistant-2");
    assert.equal(calls[0]?.["class"], "operational");
    assert.equal(calls[0]?.["dedupeKey"], "admin_system:runtime_apply_failed:audit-1:assistant-1");
    assert.deepEqual(calls[0]?.["allowedChannels"], ["user_preferred"]);
    console.log("✓ admin_system realtime events fan out to configured recipients");
  }

  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["payment_activated"],
      recipientAssistantIds: ["assistant-1"]
    });
    const emitted = await service.emitEvent({
      eventCode: "runtime_apply_failed",
      summary: "Should not emit"
    });

    assert.equal(emitted, 0);
    assert.equal(calls.length, 0);
    console.log("✓ admin_system skips realtime events that are not enabled in config");
  }

  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["grace_expired"],
      recipientAssistantIds: ["assistant-1"]
    });
    const emitted = await service.emitEvent({
      eventCode: "grace_expired",
      summary: "Grace period expired for FREE.",
      details: {
        sourceWorkspaceId: "ws-src",
        sourceUserId: "user-src-1",
        recipientEmail: "alex@agse.ru",
        planDisplayName: "FREE"
      },
      traceId: "lifecycle-grace-1"
    });

    assert.equal(emitted, 1);
    assert.equal(
      (calls[0]?.["factPayload"] as Record<string, unknown>)?.["message"],
      "Grace period expired for FREE. - user: alex@agse.ru"
    );
    console.log("✓ user-scoped admin_system events append user label to summary");
  }

  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["new_user_registered"],
      recipientAssistantIds: ["assistant-1"]
    });
    await service.emitEvent({
      eventCode: "new_user_registered",
      summary: "New user registered: alex@agse.ru",
      details: {
        sourceUserId: "user-src-1",
        email: "alex@agse.ru"
      },
      traceId: "assistant-created:1"
    });

    assert.equal(
      (calls[0]?.["factPayload"] as Record<string, unknown>)?.["message"],
      "New user registered: alex@agse.ru"
    );
    console.log("✓ user-scoped admin_system events do not duplicate user label");
  }

  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["new_user_registered"],
      recipientAssistantIds: ["assistant-1"]
    });
    const emitted = await service.emitEvent({
      eventCode: "assistant_created",
      summary: "User alex@agse.ru created a new assistant",
      details: {
        sourceUserId: "user-src-1",
        email: "alex@agse.ru",
        isFirstAssistantInWorkspace: false
      },
      traceId: "assistant-created:2"
    });

    assert.equal(emitted, 1);
    assert.equal(
      (calls[0]?.["factPayload"] as Record<string, unknown>)?.["message"],
      "User alex@agse.ru created a new assistant"
    );
    console.log("✓ assistant_created inherits enablement from new_user_registered");
  }

  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["runtime_apply_failed"],
      recipientAssistantIds: ["assistant-1"]
    });
    await service.emitEvent({
      eventCode: "runtime_apply_failed",
      summary: "Runtime apply failed for assistant X.",
      details: {
        userEmail: "actor@example.com"
      },
      traceId: "audit-runtime-2"
    });

    assert.equal(
      (calls[0]?.["factPayload"] as Record<string, unknown>)?.["message"],
      "Runtime apply failed for assistant X. - user: actor@example.com"
    );
    console.log("✓ user-scoped runtime_apply events append user email label");
  }

  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["runtime_apply_failed"],
      recipientAssistantIds: ["assistant-1"]
    });
    await service.emitEvent({
      eventCode: "runtime_apply_failed",
      summary: "Runtime apply failed for assistant X.",
      details: {
        userId: "user-src-uuid-only"
      },
      traceId: "audit-runtime-1"
    });

    assert.equal(
      (calls[0]?.["factPayload"] as Record<string, unknown>)?.["message"],
      "Runtime apply failed for assistant X."
    );
    console.log("✓ user-scoped admin_system events skip label when email is missing");
  }

  {
    const { service, calls } = makeRealtimeService({
      eventCodes: ["safety_user_restricted"],
      recipientAssistantIds: ["assistant-1"]
    });
    await service.emitEvent({
      eventCode: "safety_user_restricted",
      summary: "Safety auto-restricted user.",
      details: {
        userId: "user-src-1",
        userEmail: "restricted@example.com",
        reasonCode: "violence_extremism"
      },
      traceId: "safety-restrict-1"
    });

    assert.equal(
      (calls[0]?.["factPayload"] as Record<string, unknown>)?.["message"],
      "Safety auto-restricted user. - user: restricted@example.com"
    );
    console.log("✓ safety_user_restricted admin_system events append user email label");
  }

  {
    const createIntentCalls: IntentInput[] = [];
    let aggregateCall = 0;
    let auditCountCall = 0;
    const service = new AdminSystemNotificationProducerService(
      {
        notificationPolicy: {
          async findUnique() {
            return {
              enabled: true,
              channels: ["user_preferred"],
              config: {
                recipientAssistantIds: ["assistant-1"],
                eventCodes: ["runtime_apply_failed"],
                dailyReportEnabled: true,
                dailyReportTimeLocal: "21:00"
              }
            };
          }
        },
        assistant: {
          async findMany() {
            return [
              {
                id: "assistant-1",
                userId: "user-1",
                workspaceId: "ws-1",
                draftDisplayName: null,
                workspace: { timezone: "UTC" }
              }
            ];
          }
        },
        workspacePaymentIntent: {
          async groupBy() {
            return [{ currency: "RUB", _sum: { amountMinor: 12345 }, _count: { _all: 2 } }];
          },
          async count() {
            return 2;
          }
        },
        modelCostLedgerEvent: {
          async aggregate() {
            aggregateCall += 1;
            return {
              _sum: {
                actualCostMicros: aggregateCall === 1 ? BigInt(2_500_000) : BigInt(10_000_000)
              }
            };
          }
        },
        appUser: {
          async count() {
            return 3;
          }
        },
        assistantAuditEvent: {
          async count() {
            auditCountCall += 1;
            return auditCountCall === 1 ? 1 : 2;
          }
        },
        notificationDeadLetter: {
          async count() {
            return 4;
          }
        },
        async $queryRaw() {
          return [
            {
              startedAt: new Date("2026-05-21T00:00:00.000Z"),
              endedAt: new Date("2026-05-22T00:00:00.000Z")
            }
          ];
        }
      } as never,
      {
        async createIntent(input: IntentInput) {
          createIntentCalls.push(input);
          return {} as never;
        }
      } as unknown as NotificationIntentService
    );

    const emitted = await service.processDueDailyReports(new Date("2026-05-21T21:02:00.000Z"));

    assert.equal(emitted, 1);
    assert.equal(createIntentCalls.length, 1);
    assert.equal(createIntentCalls[0]?.["assistantId"], "assistant-1");
    assert.equal(createIntentCalls[0]?.["source"], "admin_system");
    assert.equal(createIntentCalls[0]?.["class"], "administrative");
    const factPayload = createIntentCalls[0]?.["factPayload"] as Record<string, unknown>;
    const message = factPayload["message"];
    assert.equal(typeof message, "string");
    assert.match(String(message), /New users: 3/);
    assert.match(String(message), /Revenue: RUB 123\.45/);
    console.log("✓ admin_system daily report emits once inside the configured local window");
  }

  {
    const createIntentCalls: IntentInput[] = [];
    const service = new AdminSystemNotificationProducerService(
      {
        notificationPolicy: {
          async findUnique() {
            return {
              enabled: true,
              channels: ["admin_webhook"],
              config: {
                recipientAssistantIds: ["assistant-1"],
                eventCodes: ["runtime_apply_failed"],
                dailyReportEnabled: false,
                dailyReportTimeLocal: "21:00"
              }
            };
          }
        },
        assistant: {
          async findMany() {
            return [
              {
                id: "assistant-1",
                userId: "user-1",
                workspaceId: "ws-1",
                draftDisplayName: null,
                workspace: { timezone: "UTC" }
              }
            ];
          }
        }
      } as never,
      {
        async createIntent(input: IntentInput) {
          createIntentCalls.push(input);
          return {} as never;
        }
      } as unknown as NotificationIntentService
    );

    // Use a dynamically-computed future date so this test does not become a
    // date time-bomb. The service routes priority to "scheduled" only when
    // scheduledAt is strictly in the future relative to Date.now(); a
    // hardcoded calendar date silently flips the assertion to "immediate"
    // once that date has passed.
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
    await service.emitEvent({
      eventCode: "runtime_apply_failed",
      summary: "Scheduled admin event",
      traceId: "audit-scheduled",
      notificationClass: NotificationClass.operational,
      scheduledAt
    });

    assert.equal(createIntentCalls.length, 1);
    assert.equal(createIntentCalls[0]?.["priority"], "scheduled");
    assert.equal(
      (createIntentCalls[0]?.["scheduledAt"] as Date).toISOString(),
      scheduledAt.toISOString()
    );
    assert.deepEqual(createIntentCalls[0]?.["allowedChannels"], ["user_preferred"]);
    console.log("✓ admin_system scheduled events keep user_preferred routing and scheduledAt");
  }

  {
    const createIntentCalls: IntentInput[] = [];
    let aggregateCall = 0;
    let auditCountCall = 0;
    const service = new AdminSystemNotificationProducerService(
      {
        notificationPolicy: {
          async findUnique() {
            return {
              enabled: true,
              channels: ["user_preferred"],
              config: {
                recipientAssistantIds: ["assistant-1"],
                eventCodes: ["runtime_apply_failed"],
                dailyReportEnabled: true,
                dailyReportTimeLocal: "21:00"
              }
            };
          }
        },
        assistant: {
          async findMany() {
            return [
              {
                id: "assistant-1",
                userId: "user-1",
                workspaceId: "ws-1",
                draftDisplayName: null,
                workspace: { timezone: "UTC" }
              }
            ];
          }
        },
        workspacePaymentIntent: {
          async groupBy() {
            return [{ currency: "RUB", _sum: { amountMinor: 1000 }, _count: { _all: 1 } }];
          },
          async count() {
            return 1;
          }
        },
        modelCostLedgerEvent: {
          async aggregate() {
            aggregateCall += 1;
            return {
              _sum: {
                actualCostMicros: aggregateCall === 1 ? BigInt(1_000_000) : BigInt(2_000_000)
              }
            };
          }
        },
        appUser: {
          async count() {
            return 1;
          }
        },
        assistantAuditEvent: {
          async count() {
            auditCountCall += 1;
            return auditCountCall === 1 ? 0 : 0;
          }
        },
        notificationDeadLetter: {
          async count() {
            return 0;
          }
        },
        async $queryRaw() {
          return [
            {
              startedAt: new Date("2026-05-21T00:00:00.000Z"),
              endedAt: new Date("2026-05-22T00:00:00.000Z")
            }
          ];
        }
      } as never,
      {
        async createIntent(input: IntentInput) {
          createIntentCalls.push(input);
          return {} as never;
        }
      } as unknown as NotificationIntentService
    );

    const emitted = await service.processDueDailyReports(new Date("2026-05-21T23:10:00.000Z"));

    assert.equal(emitted, 1);
    assert.equal(createIntentCalls.length, 1);
    assert.equal(createIntentCalls[0]?.["dedupeKey"], "admin_system_daily:2026-05-21:assistant-1");
    console.log("✓ admin_system daily report still emits later the same day after restart");
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
