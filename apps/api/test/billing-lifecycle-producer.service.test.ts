/**
 * ADR-088 Slice 3 — BillingLifecycleProducerService focused tests.
 * Verifies: correct intent shape per rule, optional push intent, policy disabled,
 * dedupe key collisions, traceId, respectQuietHours.
 * Pattern: tsx + node:assert/strict + void run() IIFE (no vitest).
 */
import assert from "node:assert/strict";
import { BillingLifecycleProducerService } from "../src/modules/workspace-management/application/billing-lifecycle-producer.service";
import type { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";

// ── Helpers ────────────────────────────────────────────────────────────────

type IntentInput = Record<string, unknown>;

function makeEvent(
  overrides: Partial<{
    id: string;
    workspaceId: string;
    userId: string | null;
    subscriptionId: string | null;
    eventCode: string;
    nextStatus: string | null;
    nextPlanCode: string | null;
    nextPeriodEndsAt: Date | null;
    createdAt: Date;
    userEmail: string | null;
    trialEndsAt: Date | null;
    graceEndsAt: Date | null;
  }> = {}
) {
  return {
    id: overrides.id ?? "event-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    userId: overrides.userId ?? "user-1",
    subscriptionId: overrides.subscriptionId ?? "sub-1",
    eventCode: overrides.eventCode ?? "payment_recovered",
    nextStatus: overrides.nextStatus ?? "active",
    nextPlanCode: overrides.nextPlanCode ?? "pro",
    nextPeriodEndsAt: overrides.nextPeriodEndsAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-05-08T12:00:00.000Z"),
    user: { email: overrides.userEmail ?? "user@example.com" },
    subscription: {
      graceEndsAt: overrides.graceEndsAt ?? null,
      trialEndsAt: overrides.trialEndsAt ?? null
    }
  };
}

function makeService(opts: {
  event: ReturnType<typeof makeEvent> | null;
  policyEnabled?: boolean;
  assistantPushEnabled?: boolean;
  rulesOverride?: Record<string, { enabled: boolean; offsetDays: number | null }>;
  createdIntents: IntentInput[];
  existingDedupeKeys?: Set<string>;
}) {
  const { event, policyEnabled = true, assistantPushEnabled = false, createdIntents } = opts;

  const prisma = {
    workspaceSubscriptionLifecycleEvent: {
      async findUnique() {
        return event;
      }
    },
    notificationPolicy: {
      async findUnique(_args: { where: { source: string } }) {
        if (!policyEnabled) {
          return { enabled: false, config: {} };
        }
        return {
          enabled: true,
          config: {
            assistantPushEnabled,
            rules: opts.rulesOverride ?? {
              trial_ending: { enabled: true, offsetDays: 3 },
              trial_expired: { enabled: true, offsetDays: null },
              renewal_failed: { enabled: true, offsetDays: null },
              grace_ending: { enabled: true, offsetDays: 1 },
              grace_expired: { enabled: true, offsetDays: null },
              payment_recovered: { enabled: true, offsetDays: null }
            }
          }
        };
      }
    },
    planCatalogPlan: {
      async findUnique() {
        return { displayName: "Pro" };
      }
    },
    assistant: {
      async findFirst() {
        return { id: "assistant-1" };
      }
    }
  };

  const existingDedupeKeys = opts.existingDedupeKeys ?? new Set<string>();

  const intentService = {
    async createIntent(input: IntentInput) {
      const dedupeKey = String(input["dedupeKey"]);
      if (existingDedupeKeys.has(dedupeKey)) {
        // Simulate dedupe — return existing (no-op)
        return { id: "existing", lifecycleStatus: "pending", dedupeKey };
      }
      existingDedupeKeys.add(dedupeKey);
      createdIntents.push(input);
      return {
        id: `intent-${createdIntents.length}`,
        lifecycleStatus: "pending",
        dedupeKey
      };
    }
  } as Pick<NotificationIntentService, "createIntent"> as NotificationIntentService;

  return new BillingLifecycleProducerService(prisma as never, intentService);
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. payment_recovered produces one email intent with correct shape
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({ eventCode: "payment_recovered", id: "ev-pr-1", workspaceId: "ws-1" }),
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-pr-1");

    assert.equal(intents.length, 1, "one intent for payment_recovered with no push");
    const i = intents[0]!;
    assert.equal(i["class"], "transactional");
    assert.equal(i["source"], "billing_lifecycle");
    assert.equal(i["priority"], "scheduled");
    assert.equal(i["renderStrategy"], "template");
    assert.equal(i["templateId"], "billing.payment_recovered");
    assert.deepEqual(i["allowedChannels"], ["email"]);
    assert.equal(i["respectQuietHours"], false);
    assert.equal(i["traceId"], "ev-pr-1");
    assert.equal(i["dedupeKey"], "payment_recovered:ws-1:ev-pr-1");
    const facts = i["factPayload"] as Record<string, unknown>;
    assert.equal(facts["rule"], "payment_recovered");
    assert.equal(facts["workspaceId"], "ws-1");
    assert.equal(facts["planDisplayName"], "Pro");
    assert.equal(facts["recipientEmail"], "user@example.com");
    console.log("✓ payment_recovered → correct email intent shape");
  }

  // 2. renewal_failed produces email intent with rule=renewal_failed
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({
        eventCode: "renewal_failed",
        id: "ev-rf-1",
        workspaceId: "ws-2",
        graceEndsAt: new Date("2026-05-20T00:00:00.000Z")
      }),
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-rf-1");

    assert.equal(intents.length, 1);
    assert.equal(intents[0]!["templateId"], "billing.renewal_failed");
    assert.equal(intents[0]!["dedupeKey"], "renewal_failed:ws-2:ev-rf-1");
    console.log("✓ renewal_failed → correct email intent");
  }

  // 3. grace_started produces grace_ending intent
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({
        eventCode: "grace_started",
        id: "ev-gs-1",
        workspaceId: "ws-3",
        graceEndsAt: new Date("2026-05-15T00:00:00.000Z")
      }),
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-gs-1");

    assert.equal(intents.length, 1);
    assert.equal(intents[0]!["templateId"], "billing.grace_ending");
    assert.equal(intents[0]!["traceId"], "ev-gs-1");
    console.log("✓ grace_started → grace_ending intent");
  }

  // 4. trial_started produces trial_ending intent
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({
        eventCode: "trial_started",
        id: "ev-ts-1",
        workspaceId: "ws-4",
        trialEndsAt: new Date("2026-05-25T00:00:00.000Z")
      }),
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-ts-1");

    assert.equal(intents.length, 1);
    assert.equal(intents[0]!["templateId"], "billing.trial_ending");
    console.log("✓ trial_started → trial_ending intent");
  }

  // 5. trial_expired produces trial_expired intent
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({ eventCode: "trial_expired", id: "ev-te-1", workspaceId: "ws-5" }),
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-te-1");

    assert.equal(intents.length, 1);
    assert.equal(intents[0]!["templateId"], "billing.trial_expired");
    console.log("✓ trial_expired → trial_expired intent");
  }

  // 6. grace_expired produces grace_expired intent
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({ eventCode: "grace_expired", id: "ev-ge-1", workspaceId: "ws-6" }),
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-ge-1");

    assert.equal(intents.length, 1);
    assert.equal(intents[0]!["templateId"], "billing.grace_expired");
    console.log("✓ grace_expired → grace_expired intent");
  }

  // 7. assistantPushEnabled=true creates SECOND intent for push
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({ eventCode: "payment_recovered", id: "ev-push-1", workspaceId: "ws-push" }),
      assistantPushEnabled: true,
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-push-1");

    assert.equal(intents.length, 2, "two intents when assistantPushEnabled");
    const email = intents[0]!;
    const push = intents[1]!;
    assert.equal(email["class"], "transactional");
    assert.equal(push["class"], "conversational");
    assert.equal(push["priority"], "immediate");
    assert.equal(push["templateId"], "billing.payment_recovered.short");
    assert.deepEqual(push["allowedChannels"], ["web_notification_center"]);
    assert.equal(push["traceId"], "ev-push-1", "same traceId on both intents");
    assert.equal(push["dedupeKey"], "payment_recovered:ws-push:ev-push-1:push");
    assert.equal(push["respectQuietHours"], false);
    console.log("✓ assistantPushEnabled=true → email + push intents with matching traceId");
  }

  // 8. policy disabled → no intents
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({
        eventCode: "payment_recovered",
        id: "ev-disabled-1",
        workspaceId: "ws-disabled"
      }),
      policyEnabled: false,
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-disabled-1");

    assert.equal(intents.length, 0, "no intents when policy disabled");
    console.log("✓ policy disabled → no intents");
  }

  // 9. null event → no intents
  {
    const intents: IntentInput[] = [];
    const svc = makeService({ event: null, createdIntents: intents });
    await svc.emitForLifecycleEventId("nonexistent-event");

    assert.equal(intents.length, 0, "no intents when event not found");
    console.log("✓ null event → no intents");
  }

  // 10. dedupe: same (rule, workspace, eventId) called twice → one intent only
  {
    const intents: IntentInput[] = [];
    const seenKeys = new Set<string>();
    const svc = makeService({
      event: makeEvent({
        eventCode: "payment_recovered",
        id: "ev-dedup-1",
        workspaceId: "ws-dedup"
      }),
      createdIntents: intents,
      existingDedupeKeys: seenKeys
    });
    await svc.emitForLifecycleEventId("ev-dedup-1");
    await svc.emitForLifecycleEventId("ev-dedup-1");

    assert.equal(intents.length, 1, "deduped — only one intent created");
    console.log("✓ duplicate (rule, workspace, eventId) → dedupe prevents second intent");
  }

  // 11. rule disabled via config → no intent for that rule
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({
        eventCode: "payment_recovered",
        id: "ev-disabled-rule",
        workspaceId: "ws-7"
      }),
      rulesOverride: {
        trial_ending: { enabled: true, offsetDays: 3 },
        trial_expired: { enabled: true, offsetDays: null },
        renewal_failed: { enabled: true, offsetDays: null },
        grace_ending: { enabled: true, offsetDays: 1 },
        grace_expired: { enabled: true, offsetDays: null },
        payment_recovered: { enabled: false, offsetDays: null }
      },
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-disabled-rule");

    assert.equal(intents.length, 0, "no intent when rule disabled in policy config");
    console.log("✓ rule disabled in policy config → no intent");
  }

  // 12. unknown event code → no intent
  {
    const intents: IntentInput[] = [];
    const svc = makeService({
      event: makeEvent({ eventCode: "unknown_event", id: "ev-unknown", workspaceId: "ws-8" }),
      createdIntents: intents
    });
    await svc.emitForLifecycleEventId("ev-unknown");

    assert.equal(intents.length, 0, "no intent for unrecognized event code");
    console.log("✓ unknown event code → no intent");
  }

  console.log("\n✅ All billing-lifecycle-producer.service tests passed");
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
