import assert from "node:assert/strict";
import { PrismaAssistantRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository";
import { DEFAULT_ASSISTANT_ROLE_ID } from "../prisma/assistant-role-seed-data";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function runCreateDefaultsRoleId(): Promise<void> {
  const now = new Date("2026-07-14T00:20:00.000Z");
  let findManyArgs: unknown;
  let createArgs: unknown;

  const prisma = {
    async $transaction<T>(callback: (tx: Record<string, unknown>) => Promise<T>): Promise<T> {
      return callback({
        assistant: {
          async findMany(args: unknown) {
            findManyArgs = args;
            return [];
          },
          async create(args: {
            data: {
              id: string;
              userId: string;
              workspaceId: string;
              handle: string;
              roleId: string;
            };
          }) {
            createArgs = args;
            return {
              id: args.data.id,
              userId: args.data.userId,
              workspaceId: args.data.workspaceId,
              handle: args.data.handle,
              draftDisplayName: null,
              draftInstructions: null,
              draftTraits: null,
              draftAvatarEmoji: null,
              draftAvatarUrl: null,
              draftAssistantGender: null,
              draftVoiceProfile: null,
              draftArchetypeKey: null,
              draftUpdatedAt: null,
              applyStatus: "not_requested",
              applyTargetVersionId: null,
              applyAppliedVersionId: null,
              applyRequestedAt: null,
              applyStartedAt: null,
              applyFinishedAt: null,
              applyErrorCode: null,
              applyErrorMessage: null,
              configDirtyAt: null,
              roleId: args.data.roleId,
              sandboxEgressMode: "restricted",
              createdAt: now,
              updatedAt: now
            };
          }
        }
      });
    }
  };

  const repository = new PrismaAssistantRepository(
    prisma as unknown as WorkspaceManagementPrismaService
  );

  const assistant = await repository.create("user-1", "ws-1");

  assert.equal(assistant.userId, "user-1");
  assert.equal(assistant.workspaceId, "ws-1");
  assert.match(assistant.handle, /^a-[0-9a-f]{8}$/i);
  assert.equal(assistant.roleId, DEFAULT_ASSISTANT_ROLE_ID);
  assert.ok(createArgs && typeof createArgs === "object");
  const createdData = (createArgs as { data: { roleId: string; handle: string } }).data;
  assert.deepEqual(findManyArgs, {
    where: {
      workspaceId: "ws-1",
      handle: { startsWith: createdData.handle }
    },
    select: { handle: true }
  });
  assert.equal(createdData.roleId, DEFAULT_ASSISTANT_ROLE_ID);
  assert.match(createdData.handle, /^a-[0-9a-f]{8}$/i);
}

async function main(): Promise<void> {
  await runCreateDefaultsRoleId();
}

void main();
