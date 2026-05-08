/**
 * ADR-088 Slice 1 closeout — NotificationIntentService focused tests.
 * Covers: dedupe, quiet-hours deferral, scheduled delivery, skippable skip,
 * immediate override of quiet hours.
 */
import assert from "node:assert/strict";
import { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";
import { NotificationRoutingService } from "../src/modules/workspace-management/application/notifications/notification-routing.service";
import { ResolveWorkspaceNotificationChannelsService } from "../src/modules/workspace-management/application/notifications/resolve-workspace-notification-channels.service";

// ── Minimal in-memory Prisma mock ──────────────────────────────────────────

type StoredIntent = {
  id: string;
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  source: string;
  class: string;
  priority: string;
  lifecycleStatus: string;
  renderStrategy: string;
  renderInstructionRef: string | null;
  templateId: string | null;
  factPayload: unknown;
  policySnapshot: unknown;
  allowedChannels: string[];
  escalationAfterMinutes: number | null;
  escalationChannel: string | null;
  dedupeKey: string | null;
  scheduledAt: Date | null;
  respectQuietHours: boolean;
  surface: string | null;
  surfaceThreadKey: string | null;
  chatId: string | null;
  traceId: string | null;
  failureReason: string | null;
  createdAt: Date;
  claimedAt: Date | null;
  deliveredAt: Date | null;
  deadLetteredAt: Date | null;
};

let idCounter = 0;
function makePrisma(opts?: {
  policy?: Record<string, unknown>;
  quietHours?: Record<string, unknown>;
  channels?: unknown[];
}) {
  const store: StoredIntent[] = [];
  return {
    notificationPolicy: {
      findUnique: async () => opts?.policy ?? null
    },
    notificationQuietHours: {
      findFirst: async () => opts?.quietHours ?? null
    },
    notificationChannelRegistry: {
      findMany: async () => opts?.channels ?? []
    },
    notificationIntent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          id: `intent-${++idCounter}`,
          createdAt: new Date(),
          claimedAt: null,
          deliveredAt: null,
          deadLetteredAt: null
        } as unknown as StoredIntent;
        store.push(row);
        return row;
      },
      findFirst: async (q: {
        where: {
          workspaceId?: string;
          dedupeKey?: string;
          lifecycleStatus?: { in?: string[] };
        };
      }) => {
        return (
          store.find(
            (r) =>
              r.workspaceId === q.where.workspaceId &&
              r.dedupeKey === q.where.dedupeKey &&
              (!q.where.lifecycleStatus?.in ||
                q.where.lifecycleStatus.in.includes(r.lifecycleStatus))
          ) ?? null
        );
      }
    }
  };
}

function makeService(opts?: {
  policy?: Record<string, unknown>;
  quietHours?: Record<string, unknown>;
  channels?: unknown[];
}) {
  const prisma = makePrisma(opts);
  const routing = new NotificationRoutingService();
  const channelResolver = new ResolveWorkspaceNotificationChannelsService(prisma as never);
  return new NotificationIntentService(prisma as never, routing, channelResolver);
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Basic creation — logs intent.created, returns record
  {
    const svc = makeService();
    const result = await svc.createIntent({
      workspaceId: "ws-1",
      source: "idle_reengagement",
      class: "conversational",
      priority: "skippable",
      renderStrategy: "grounded_llm",
      factPayload: { message: "Hello" }
    });
    assert.ok(result.id, "intent has id");
    assert.equal(result.lifecycleStatus, "pending", "new intent is pending");
    assert.equal(result.source, "idle_reengagement");
    console.log("✓ basic creation");
  }

  // 2. Deduplification — second call with same dedupeKey returns existing record
  {
    const svc = makeService();
    const first = await svc.createIntent({
      workspaceId: "ws-1",
      source: "quota_advisory",
      class: "conversational",
      priority: "immediate",
      renderStrategy: "grounded_llm",
      factPayload: {},
      dedupeKey: "qa:ws-1:period-1"
    });
    const second = await svc.createIntent({
      workspaceId: "ws-1",
      source: "quota_advisory",
      class: "conversational",
      priority: "immediate",
      renderStrategy: "grounded_llm",
      factPayload: {},
      dedupeKey: "qa:ws-1:period-1"
    });
    assert.equal(first.id, second.id, "dedupe: same id returned on second call");
    console.log("✓ deduplication");
  }

  // 3. Quiet-hours deferral — skippable intent created during quiet hours is deferred
  {
    const now = new Date();
    // Use UTC hours: the service compares against defaultTimezone="UTC"
    const startHour = now.getUTCHours();
    const pad = (n: number) => String(n).padStart(2, "0");
    const startLocal = `${pad(startHour)}:00`;
    const endLocal = `${pad((startHour + 2) % 24)}:00`;
    const svc = makeService({
      quietHours: {
        enabled: true,
        startLocal,
        endLocal,
        timezoneMode: "workspace_default",
        defaultTimezone: "UTC",
        appliesToSources: ["idle_reengagement"]
      }
    });
    const result = await svc.createIntent({
      workspaceId: "ws-1",
      source: "idle_reengagement",
      class: "conversational",
      priority: "skippable",
      renderStrategy: "grounded_llm",
      factPayload: {},
      respectQuietHours: true
    });
    assert.equal(
      result.lifecycleStatus,
      "deferred_quiet_hours",
      "skippable intent deferred during quiet hours"
    );
    assert.ok(result.scheduledAt !== null, "scheduledAt set for deferred intent");
    console.log("✓ quiet-hours deferral");
  }

  // 4. Immediate priority overrides quiet hours
  {
    const now = new Date();
    // Use UTC hours: the service compares against defaultTimezone="UTC"
    const startHour = now.getUTCHours();
    const pad = (n: number) => String(n).padStart(2, "0");
    const startLocal = `${pad(startHour)}:00`;
    const endLocal = `${pad((startHour + 2) % 24)}:00`;
    const svc = makeService({
      quietHours: {
        enabled: true,
        startLocal,
        endLocal,
        timezoneMode: "workspace_default",
        defaultTimezone: "UTC",
        appliesToSources: ["quota_advisory"]
      }
    });
    const result = await svc.createIntent({
      workspaceId: "ws-1",
      source: "quota_advisory",
      class: "conversational",
      priority: "immediate",
      renderStrategy: "grounded_llm",
      factPayload: {}
    });
    assert.equal(result.lifecycleStatus, "pending", "immediate priority overrides quiet hours");
    console.log("✓ immediate overrides quiet hours");
  }

  // 5. Scheduled intent sets scheduledAt
  {
    const svc = makeService();
    const scheduledAt = new Date(Date.now() + 3600_000);
    const result = await svc.createIntent({
      workspaceId: "ws-1",
      source: "reminder",
      class: "conversational",
      priority: "scheduled",
      renderStrategy: "static_fallback",
      factPayload: {},
      scheduledAt
    });
    assert.ok(result.scheduledAt !== null, "scheduled intent has scheduledAt");
    assert.equal(result.lifecycleStatus, "pending");
    console.log("✓ scheduled intent");
  }

  console.log("\n✅ All notification-intent.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
