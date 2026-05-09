/**
 * ADR-088 Slice 4 — SystemEventNotificationProducerService focused tests.
 * Verifies: correct class per audit event code, workspaceId=null early-return,
 * unknown event code early-return, factPayload shape, traceId, allowedChannels.
 * Pattern: tsx + node:assert/strict + void run() IIFE (no vitest).
 */
import assert from "node:assert/strict";
import { SystemEventNotificationProducerService } from "../src/modules/workspace-management/application/system-event-notification-producer.service";
import type { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";

type IntentInput = Record<string, unknown>;

function makeService(createIntent?: (input: IntentInput) => Promise<void>) {
  const calls: IntentInput[] = [];
  const stub = {
    createIntent: async (input: IntentInput) => {
      calls.push(input);
      if (createIntent) await createIntent(input);
      return {} as never;
    }
  } as unknown as NotificationIntentService;
  return {
    service: new SystemEventNotificationProducerService(stub),
    calls
  };
}

function baseInput(
  overrides: Partial<{
    auditEventId: string;
    workspaceId: string | null;
    assistantId: string | null;
    actorUserId: string | null;
    eventCode: string;
    summary: string;
    details: Record<string, unknown>;
    createdAt: string;
  }> = {}
) {
  return {
    auditEventId: overrides.auditEventId ?? "audit-1",
    workspaceId: overrides.workspaceId !== undefined ? overrides.workspaceId : "ws-1",
    assistantId: overrides.assistantId ?? null,
    actorUserId: overrides.actorUserId ?? "user-1",
    eventCode: overrides.eventCode ?? "assistant.runtime.apply_failed",
    summary: overrides.summary ?? "Apply failed for workspace ws-1",
    details: overrides.details ?? { reason: "timeout" },
    createdAt: overrides.createdAt ?? "2026-05-09T10:00:00.000Z"
  };
}

void (async function run() {
  // 1. workspaceId=null → no intent created
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(baseInput({ workspaceId: null }));
    assert.equal(calls.length, 0, "workspaceId=null: no intent");
  }

  // 2. Unknown event code → no intent created
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(baseInput({ eventCode: "some.unknown.event" }));
    assert.equal(calls.length, 0, "unknown event code: no intent");
  }

  // 3. apply_failed → source=system_event, class=operational
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(baseInput({ eventCode: "assistant.runtime.apply_failed" }));
    assert.equal(calls.length, 1, "apply_failed: one intent created");
    assert.equal(calls[0]!["source"], "system_event");
    assert.equal(calls[0]!["class"], "operational");
    assert.equal(calls[0]!["priority"], "immediate");
    assert.equal(calls[0]!["renderStrategy"], "static_fallback");
    assert.deepEqual(calls[0]!["allowedChannels"], ["admin_webhook"]);
    assert.equal(calls[0]!["respectQuietHours"], false);
    assert.equal(calls[0]!["traceId"], "audit-1");
  }

  // 4. apply_degraded → class=operational
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(baseInput({ eventCode: "assistant.runtime.apply_degraded" }));
    assert.equal(calls[0]!["class"], "operational", "apply_degraded → operational");
  }

  // 5. apply_succeeded → class=operational
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(baseInput({ eventCode: "assistant.runtime.apply_succeeded" }));
    assert.equal(calls[0]!["class"], "operational", "apply_succeeded → operational");
  }

  // 6. admin.plan_created → class=administrative
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(baseInput({ eventCode: "admin.plan_created" }));
    assert.equal(calls[0]!["class"], "administrative", "admin.plan_created → administrative");
  }

  // 7. admin.plan_updated → class=administrative
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(baseInput({ eventCode: "admin.plan_updated" }));
    assert.equal(calls[0]!["class"], "administrative", "admin.plan_updated → administrative");
  }

  // 8. factPayload.message = summary
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(
      baseInput({ summary: "Runtime apply failed for assistant X" })
    );
    const fp = calls[0]!["factPayload"] as Record<string, unknown>;
    assert.equal(
      fp["message"],
      "Runtime apply failed for assistant X",
      "factPayload.message = summary"
    );
    assert.equal(fp["eventCode"], "assistant.runtime.apply_failed");
  }

  // 9. workspaceId + assistantId passed through correctly
  {
    const { service, calls } = makeService();
    await service.emitFromAuditEvent(
      baseInput({ workspaceId: "ws-99", assistantId: "ast-42", actorUserId: "usr-7" })
    );
    assert.equal(calls[0]!["workspaceId"], "ws-99");
    assert.equal(calls[0]!["assistantId"], "ast-42");
    assert.equal(calls[0]!["userId"], "usr-7");
  }

  // 10. createIntent error → swallowed (no throw from emitFromAuditEvent)
  {
    const { service } = makeService(async () => {
      throw new Error("DB error");
    });
    await assert.doesNotReject(
      () => service.emitFromAuditEvent(baseInput()),
      "createIntent error is swallowed"
    );
  }

  console.log("system-event-notification-producer: all 10 assertions passed.");
})();
