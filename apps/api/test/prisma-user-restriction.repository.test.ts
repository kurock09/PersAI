import assert from "node:assert/strict";
import { PrismaUserRestrictionRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-user-restriction.repository";

async function run(): Promise<void> {
  const now = new Date("2026-06-14T12:00:00.000Z");
  const repository = new PrismaUserRestrictionRepository({
    userRestriction: {
      findUnique: async ({ where }: { where: { userId_kind: { userId: string } } }) => {
        if (where.userId_kind.userId === "active-user") {
          return {
            id: "restriction-1",
            userId: "active-user",
            kind: "safety",
            status: "active",
            blockedUntil: null,
            reasonCode: "hack_abuse",
            source: "admin",
            sourceAssistantId: null,
            sourceModerationCaseId: null,
            clearedAt: null,
            clearedByUserId: null,
            createdAt: now,
            updatedAt: now
          };
        }
        if (where.userId_kind.userId === "expired-user") {
          return {
            id: "restriction-2",
            userId: "expired-user",
            kind: "safety",
            status: "active",
            blockedUntil: new Date("2026-06-14T11:00:00.000Z"),
            reasonCode: "unsolicited_adult_spam",
            source: "moderation_auto",
            sourceAssistantId: "assistant-1",
            sourceModerationCaseId: "case-1",
            clearedAt: null,
            clearedByUserId: null,
            createdAt: now,
            updatedAt: now
          };
        }
        if (where.userId_kind.userId === "cleared-user") {
          return {
            id: "restriction-3",
            userId: "cleared-user",
            kind: "safety",
            status: "cleared",
            blockedUntil: null,
            reasonCode: "violence_extremism",
            source: "admin",
            sourceAssistantId: null,
            sourceModerationCaseId: null,
            clearedAt: now,
            clearedByUserId: "admin-1",
            createdAt: now,
            updatedAt: now
          };
        }
        return null;
      }
    }
  } as never);

  const active = await repository.findActiveSafetyRestriction("active-user", now);
  assert.ok(active !== null);
  assert.equal(active.reasonCode, "hack_abuse");

  assert.equal(await repository.findActiveSafetyRestriction("expired-user", now), null);
  assert.equal(await repository.findActiveSafetyRestriction("cleared-user", now), null);
  assert.equal(await repository.findActiveSafetyRestriction("missing-user", now), null);
}

run()
  .then(() => {
    console.log("prisma-user-restriction.repository.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
