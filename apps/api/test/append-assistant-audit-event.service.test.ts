import assert from "node:assert/strict";
import { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import type { AdminSystemNotificationProducerService } from "../src/modules/workspace-management/application/admin-system-notification-producer.service";
import type { SystemEventNotificationProducerService } from "../src/modules/workspace-management/application/system-event-notification-producer.service";

async function run(): Promise<void> {
  {
    const service = new AppendAssistantAuditEventService(
      {} as never,
      {} as SystemEventNotificationProducerService,
      {} as AdminSystemNotificationProducerService
    );

    assert.equal(
      service.resolveAdminSystemEventCode({
        workspaceId: null,
        assistantId: null,
        actorUserId: null,
        eventCategory: "safety",
        eventCode: "safety.moderation_case_decided",
        summary: "Safety auto-restricted user.",
        details: { decision: "block_user", userId: "user-1" }
      }),
      "safety_user_restricted"
    );
    assert.equal(
      service.resolveAdminSystemEventCode({
        workspaceId: null,
        assistantId: null,
        actorUserId: null,
        eventCategory: "safety",
        eventCode: "safety.moderation_case_decided",
        summary: "Safety moderation case decided (warn).",
        details: { decision: "warn", userId: "user-1" }
      }),
      undefined
    );
    assert.equal(
      service.resolveAdminSystemEventCode({
        workspaceId: null,
        assistantId: null,
        actorUserId: null,
        eventCategory: "admin_action",
        eventCode: "admin.safety_user_restricted",
        summary: "Admin applied platform safety restriction.",
        details: { userId: "user-1" }
      }),
      "safety_user_restricted"
    );
    console.log("✓ append audit maps safety restrict events to safety_user_restricted");
  }

  {
    const adminEmitCalls: Array<Record<string, unknown>> = [];
    const service = new AppendAssistantAuditEventService(
      {
        assistantAuditEvent: {
          async create() {
            return {
              id: "audit-1",
              createdAt: new Date("2026-06-14T12:00:00.000Z")
            };
          }
        },
        appUser: {
          async findUnique({ where }: { where: { id: string } }) {
            if (where.id === "user-actor-1") {
              return { email: "actor@example.com" };
            }
            if (where.id === "user-1") {
              return { email: "restricted@example.com" };
            }
            return null;
          }
        }
      } as never,
      {
        async emitFromAuditEvent() {
          return;
        }
      } as SystemEventNotificationProducerService,
      {
        async emitEvent(input: Record<string, unknown>) {
          adminEmitCalls.push(input);
          return 1;
        }
      } as unknown as AdminSystemNotificationProducerService
    );

    await service.execute({
      workspaceId: "ws-1",
      assistantId: "assistant-1",
      actorUserId: "user-actor-1",
      eventCategory: "runtime_apply",
      eventCode: "assistant.runtime.apply_failed",
      summary: "Assistant runtime apply failed.",
      details: { publishedVersionId: "pv-1" }
    });

    assert.equal(adminEmitCalls.length, 1);
    assert.equal(adminEmitCalls[0]?.["eventCode"], "runtime_apply_failed");
    assert.deepEqual(adminEmitCalls[0]?.["details"], {
      publishedVersionId: "pv-1",
      userEmail: "actor@example.com"
    });

    adminEmitCalls.length = 0;
    await service.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: null,
      eventCategory: "safety",
      eventCode: "safety.moderation_case_decided",
      summary: "Safety auto-restricted user.",
      details: { decision: "block_user", userId: "user-1" }
    });

    assert.equal(adminEmitCalls.length, 1);
    assert.equal(adminEmitCalls[0]?.["eventCode"], "safety_user_restricted");
    assert.deepEqual(adminEmitCalls[0]?.["details"], {
      decision: "block_user",
      userId: "user-1",
      userEmail: "restricted@example.com"
    });
    console.log("✓ append audit enriches user-scoped admin_system details with user email");
  }
}

run()
  .then(() => {
    console.log("append-assistant-audit-event.service.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
