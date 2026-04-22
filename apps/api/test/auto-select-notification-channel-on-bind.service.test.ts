import assert from "node:assert/strict";
import { AutoSelectNotificationChannelOnBindService } from "../src/modules/workspace-management/application/auto-select-notification-channel-on-bind.service";

// ADR-074 Slice T2 — unit tests for the auto-select helper.
//
// The helper is a pure compare-and-set on `Assistant.preferredNotificationChannel`
// gated by the `preferredNotificationChannelChosenAt` D-marker. Tests use a
// minimal Prisma fake that records observed calls and lets us drive both
// branches of the conditional `updateMany`.

type AssistantRow = {
  id: string;
  preferredNotificationChannel: "web" | "telegram" | "whatsapp";
  preferredNotificationChannelChosenAt: Date | null;
};

type UpdateManyCall = {
  whereId: string;
  whereChosenAtNull: boolean;
  data: {
    preferredNotificationChannel?: string;
    preferredNotificationChannelChosenAt?: Date | null;
  };
};

class FakeWorkspaceManagementPrismaService {
  rows = new Map<string, AssistantRow>();
  findUniqueCalls: Array<{ id: string }> = [];
  updateManyCalls: UpdateManyCall[] = [];
  /** When set, the next `updateMany` returns count=0 to simulate a race. */
  forceUpdateManyZero = false;

  assistant = {
    findUnique: async ({
      where,
      select
    }: {
      where: { id: string };
      select: {
        preferredNotificationChannel?: boolean;
        preferredNotificationChannelChosenAt?: boolean;
      };
    }): Promise<AssistantRow | null> => {
      this.findUniqueCalls.push({ id: where.id });
      const row = this.rows.get(where.id);
      if (row === undefined) {
        return null;
      }
      // Echo only requested fields (mimics Prisma `select`).
      void select;
      return {
        id: row.id,
        preferredNotificationChannel: row.preferredNotificationChannel,
        preferredNotificationChannelChosenAt: row.preferredNotificationChannelChosenAt
      };
    },
    updateMany: async ({
      where,
      data
    }: {
      where: {
        id: string;
        preferredNotificationChannelChosenAt: null;
      };
      data: {
        preferredNotificationChannel: string;
        preferredNotificationChannelChosenAt: Date;
      };
    }): Promise<{ count: number }> => {
      this.updateManyCalls.push({
        whereId: where.id,
        whereChosenAtNull: where.preferredNotificationChannelChosenAt === null,
        data
      });
      if (this.forceUpdateManyZero) {
        this.forceUpdateManyZero = false;
        return { count: 0 };
      }
      const row = this.rows.get(where.id);
      if (row === undefined) {
        return { count: 0 };
      }
      if (row.preferredNotificationChannelChosenAt !== null) {
        return { count: 0 };
      }
      row.preferredNotificationChannel =
        data.preferredNotificationChannel as AssistantRow["preferredNotificationChannel"];
      row.preferredNotificationChannelChosenAt = data.preferredNotificationChannelChosenAt;
      return { count: 1 };
    }
  };
}

function makeService(
  prisma: FakeWorkspaceManagementPrismaService
): AutoSelectNotificationChannelOnBindService {
  return new AutoSelectNotificationChannelOnBindService(
    prisma as unknown as ConstructorParameters<typeof AutoSelectNotificationChannelOnBindService>[0]
  );
}

async function runChosenAtNullPromotesChannelAndWritesTimestamp(): Promise<void> {
  const prisma = new FakeWorkspaceManagementPrismaService();
  prisma.rows.set("assistant-1", {
    id: "assistant-1",
    preferredNotificationChannel: "web",
    preferredNotificationChannelChosenAt: null
  });
  const service = makeService(prisma);

  const result = await service.execute({
    assistantId: "assistant-1",
    bindingChannel: "telegram"
  });

  assert.deepEqual(result, { changed: true, reason: "auto_set" });
  const row = prisma.rows.get("assistant-1");
  assert.equal(row?.preferredNotificationChannel, "telegram");
  assert.ok(
    row?.preferredNotificationChannelChosenAt instanceof Date,
    "chosenAt timestamp written"
  );
  assert.equal(prisma.updateManyCalls.length, 1);
  assert.equal(
    prisma.updateManyCalls[0].whereChosenAtNull,
    true,
    "where clause must guard on chosenAt IS NULL for atomic compare-and-set"
  );
}

async function runChosenAtAlreadySetIsNoOp(): Promise<void> {
  const prisma = new FakeWorkspaceManagementPrismaService();
  const previouslyChosenAt = new Date("2026-04-20T10:00:00.000Z");
  prisma.rows.set("assistant-1", {
    id: "assistant-1",
    preferredNotificationChannel: "web",
    preferredNotificationChannelChosenAt: previouslyChosenAt
  });
  const service = makeService(prisma);

  const result = await service.execute({
    assistantId: "assistant-1",
    bindingChannel: "telegram"
  });

  assert.deepEqual(result, { changed: false, reason: "already_chosen" });
  const row = prisma.rows.get("assistant-1");
  assert.equal(
    row?.preferredNotificationChannel,
    "web",
    "explicit prior choice (web) must be preserved"
  );
  assert.equal(
    row?.preferredNotificationChannelChosenAt,
    previouslyChosenAt,
    "chosenAt must not be overwritten on already-chosen path"
  );
  assert.equal(prisma.updateManyCalls.length, 0, "no updateMany call when chosenAt is already set");
}

async function runChannelAlreadyMatchesWritesMarkerOnly(): Promise<void> {
  const prisma = new FakeWorkspaceManagementPrismaService();
  prisma.rows.set("assistant-1", {
    id: "assistant-1",
    preferredNotificationChannel: "telegram",
    preferredNotificationChannelChosenAt: null
  });
  const service = makeService(prisma);

  const result = await service.execute({
    assistantId: "assistant-1",
    bindingChannel: "telegram"
  });

  assert.deepEqual(result, { changed: false, reason: "channel_already_matches" });
  const row = prisma.rows.get("assistant-1");
  assert.equal(row?.preferredNotificationChannel, "telegram");
  assert.ok(
    row?.preferredNotificationChannelChosenAt instanceof Date,
    "chosenAt is written so the next call short-circuits as already_chosen"
  );
  assert.equal(prisma.updateManyCalls.length, 1);
}

async function runAssistantNotFoundIsBestEffortNoOp(): Promise<void> {
  const prisma = new FakeWorkspaceManagementPrismaService();
  const service = makeService(prisma);

  const result = await service.execute({
    assistantId: "missing-assistant",
    bindingChannel: "telegram"
  });

  assert.deepEqual(result, { changed: false, reason: "assistant_not_found" });
  assert.equal(prisma.updateManyCalls.length, 0);
}

async function runConcurrentUpdateRaceFallsBackToAlreadyChosen(): Promise<void> {
  // Simulates: helper #1 reads `chosenAt = null`, helper #2 (or a manual
  // preference update) flips it before helper #1's updateMany lands. The
  // conditional updateMany returns count=0 and we must report
  // already_chosen rather than a phantom auto_set.
  const prisma = new FakeWorkspaceManagementPrismaService();
  prisma.rows.set("assistant-1", {
    id: "assistant-1",
    preferredNotificationChannel: "web",
    preferredNotificationChannelChosenAt: null
  });
  prisma.forceUpdateManyZero = true;
  const service = makeService(prisma);

  const result = await service.execute({
    assistantId: "assistant-1",
    bindingChannel: "telegram"
  });

  assert.deepEqual(result, { changed: false, reason: "already_chosen" });
}

async function runNonPromotableChannelIsRejected(): Promise<void> {
  // Defensive: callers must never pass `web`. If they do, treat as no-op
  // (we cannot "promote" to the default).
  const prisma = new FakeWorkspaceManagementPrismaService();
  prisma.rows.set("assistant-1", {
    id: "assistant-1",
    preferredNotificationChannel: "web",
    preferredNotificationChannelChosenAt: null
  });
  const service = makeService(prisma);

  const result = await service.execute({
    assistantId: "assistant-1",
    bindingChannel: "web" as "telegram"
  });

  assert.equal(result.changed, false);
  assert.equal(result.reason, "already_chosen");
  assert.equal(prisma.findUniqueCalls.length, 0, "rejection must short-circuit before any DB read");
  assert.equal(prisma.updateManyCalls.length, 0);
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    [
      "chosenAt NULL → promotes channel + writes timestamp",
      runChosenAtNullPromotesChannelAndWritesTimestamp
    ],
    ["chosenAt already set → no-op", runChosenAtAlreadySetIsNoOp],
    ["channel already matches → writes marker only", runChannelAlreadyMatchesWritesMarkerOnly],
    ["assistant not found → best-effort no-op", runAssistantNotFoundIsBestEffortNoOp],
    ["concurrent update race → already_chosen", runConcurrentUpdateRaceFallsBackToAlreadyChosen],
    ["non-promotable channel `web` → rejected without DB touch", runNonPromotableChannelIsRejected]
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
