import assert from "node:assert/strict";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { UpdateAssistantNotificationPreferenceService } from "../src/modules/workspace-management/application/update-assistant-notification-preference.service";

// ADR-074 Slice T2 — verify that every successful manual preference update
// writes `preferredNotificationChannelChosenAt` (the D-marker).
//
// This test focuses ONLY on the chosenAt write semantics. Existing channel
// validation, audit-log emission, and conflict handling are not the
// subject; we only assert that they continue to work and that the new
// timestamp is included exactly when (and only when) the row is written.

type AssistantRow = {
  id: string;
  workspaceId: string;
  preferredNotificationChannel: "web" | "telegram";
  preferredNotificationChannelChosenAt: Date | null;
  channelSurfaceBindings: Array<{ providerKey: string }>;
};

class FakePrismaService {
  rows = new Map<string, AssistantRow>();
  updates: Array<{
    where: { id: string };
    data: {
      preferredNotificationChannel?: string;
      preferredNotificationChannelChosenAt?: Date;
    };
  }> = [];

  assistant = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<AssistantRow | null> =>
      this.rows.get(where.id) ?? null,
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: {
        preferredNotificationChannel?: string;
        preferredNotificationChannelChosenAt?: Date;
      };
    }): Promise<void> => {
      this.updates.push({ where, data });
      const row = this.rows.get(where.id);
      if (row !== undefined) {
        if (data.preferredNotificationChannel !== undefined) {
          row.preferredNotificationChannel =
            data.preferredNotificationChannel as AssistantRow["preferredNotificationChannel"];
        }
        if (data.preferredNotificationChannelChosenAt !== undefined) {
          row.preferredNotificationChannelChosenAt = data.preferredNotificationChannelChosenAt;
        }
      }
    }
  };
}

class FakeAuditService {
  events: Array<Record<string, unknown>> = [];
  async execute(event: Record<string, unknown>): Promise<void> {
    this.events.push(event);
  }
}

class FakeResolveActiveAssistantService {
  async execute(input: { userId: string }): Promise<{ assistantId: string }> {
    return { assistantId: `assistant-${input.userId}` };
  }
}

function makeService(
  prisma: FakePrismaService,
  audit: FakeAuditService
): UpdateAssistantNotificationPreferenceService {
  return new UpdateAssistantNotificationPreferenceService(
    prisma as unknown as ConstructorParameters<
      typeof UpdateAssistantNotificationPreferenceService
    >[0],
    audit as unknown as ConstructorParameters<
      typeof UpdateAssistantNotificationPreferenceService
    >[1],
    new FakeResolveActiveAssistantService() as unknown as ConstructorParameters<
      typeof UpdateAssistantNotificationPreferenceService
    >[2]
  );
}

async function runManualUpdateWritesChosenAt(): Promise<void> {
  const prisma = new FakePrismaService();
  prisma.rows.set("assistant-user-1", {
    id: "assistant-user-1",
    workspaceId: "workspace-1",
    preferredNotificationChannel: "web",
    preferredNotificationChannelChosenAt: null,
    channelSurfaceBindings: [{ providerKey: "telegram" }]
  });
  const audit = new FakeAuditService();
  const service = makeService(prisma, audit);

  const before = Date.now();
  const result = await service.execute("user-1", { channel: "telegram" });
  const after = Date.now();

  assert.equal(result.selectedChannel, "telegram");
  assert.equal(prisma.updates.length, 1);
  const update = prisma.updates[0];
  assert.equal(update.data.preferredNotificationChannel, "telegram");
  assert.ok(
    update.data.preferredNotificationChannelChosenAt instanceof Date,
    "chosenAt timestamp must be written on every successful manual update"
  );
  const chosenAtMs = update.data.preferredNotificationChannelChosenAt.getTime();
  assert.ok(
    chosenAtMs >= before && chosenAtMs <= after,
    `chosenAt timestamp ${new Date(chosenAtMs).toISOString()} must be inside the call window [${new Date(before).toISOString()}, ${new Date(after).toISOString()}]`
  );
}

async function runFlippingBackToWebStillWritesChosenAt(): Promise<void> {
  // Founder-after-bind scenario: TG was auto-selected (chosenAt set). User
  // opens Settings and clicks `web` — we must record this as another
  // explicit choice so any subsequent re-bind respects it.
  const prisma = new FakePrismaService();
  prisma.rows.set("assistant-user-1", {
    id: "assistant-user-1",
    workspaceId: "workspace-1",
    preferredNotificationChannel: "telegram",
    preferredNotificationChannelChosenAt: new Date("2026-04-22T10:00:00.000Z"),
    channelSurfaceBindings: [{ providerKey: "telegram" }]
  });
  const audit = new FakeAuditService();
  const service = makeService(prisma, audit);

  const result = await service.execute("user-1", { channel: "web" });

  assert.equal(result.selectedChannel, "web");
  assert.equal(prisma.updates.length, 1);
  assert.equal(prisma.updates[0].data.preferredNotificationChannel, "web");
  assert.ok(
    prisma.updates[0].data.preferredNotificationChannelChosenAt instanceof Date,
    "every manual update writes a fresh chosenAt, even when channel is being downgraded back to web"
  );
}

async function runRejectedUpdateDoesNotWriteChosenAt(): Promise<void> {
  // Channel not in availableChannels → ConflictException → no DB write.
  const prisma = new FakePrismaService();
  prisma.rows.set("assistant-user-1", {
    id: "assistant-user-1",
    workspaceId: "workspace-1",
    preferredNotificationChannel: "web",
    preferredNotificationChannelChosenAt: null,
    channelSurfaceBindings: []
  });
  const audit = new FakeAuditService();
  const service = makeService(prisma, audit);

  await assert.rejects(() => service.execute("user-1", { channel: "telegram" }), ConflictException);
  assert.equal(prisma.updates.length, 0, "rejected update must not write chosenAt");
  const row = prisma.rows.get("assistant-user-1");
  assert.equal(row?.preferredNotificationChannelChosenAt, null);
}

async function runMissingAssistantThrowsNotFound(): Promise<void> {
  const prisma = new FakePrismaService();
  const audit = new FakeAuditService();
  const service = makeService(prisma, audit);

  await assert.rejects(() => service.execute("user-1", { channel: "web" }), NotFoundException);
  assert.equal(prisma.updates.length, 0);
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["manual update writes chosenAt timestamp", runManualUpdateWritesChosenAt],
    ["flipping back to web still writes a fresh chosenAt", runFlippingBackToWebStillWritesChosenAt],
    [
      "rejected update (channel not connected) does not write chosenAt",
      runRejectedUpdateDoesNotWriteChosenAt
    ],
    ["missing assistant throws NotFoundException", runMissingAssistantThrowsNotFound]
  ];

  let failures = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`fail - ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exitCode = 1;
  }
}

void main();
