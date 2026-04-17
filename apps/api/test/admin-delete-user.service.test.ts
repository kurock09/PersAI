import assert from "node:assert/strict";
import { AdminDeleteUserService } from "../src/modules/workspace-management/application/admin-delete-user.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function run(): Promise<void> {
  const rawSql: string[] = [];
  const auditUpdateCalls: Array<unknown> = [];
  const deleted: string[] = [];
  const releasedBytes: bigint[] = [];
  const releasedKnowledgeBytes: bigint[] = [];
  const deletedPrefixes: string[] = [];
  const recordDelete = (label: string) => async () => {
    deleted.push(label);
  };

  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded" as const,
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const tx = {
    assistantPlatformRolloutItem: {
      deleteMany: recordDelete("assistantPlatformRolloutItem")
    },
    assistantAbuseGuardState: {
      deleteMany: recordDelete("assistantAbuseGuardState")
    },
    assistantAbuseAssistantState: {
      deleteMany: recordDelete("assistantAbuseAssistantState")
    },
    assistantAbusePeerState: {
      deleteMany: recordDelete("assistantAbusePeerState")
    },
    assistantChatMessageAttachment: {
      deleteMany: recordDelete("assistantChatMessageAttachment")
    },
    assistantChatMessage: {
      deleteMany: recordDelete("assistantChatMessage")
    },
    assistantChat: {
      deleteMany: recordDelete("assistantChat")
    },
    assistantMemoryRegistryItem: {
      deleteMany: recordDelete("assistantMemoryRegistryItem")
    },
    assistantTaskRegistryItem: {
      deleteMany: recordDelete("assistantTaskRegistryItem")
    },
    assistantKnowledgeSource: {
      deleteMany: recordDelete("assistantKnowledgeSource")
    },
    runtimeTurnReceipt: {
      deleteMany: recordDelete("runtimeTurnReceipt")
    },
    runtimeSessionCompaction: {
      deleteMany: recordDelete("runtimeSessionCompaction")
    },
    runtimeSession: {
      deleteMany: recordDelete("runtimeSession")
    },
    runtimeBundleState: {
      deleteMany: recordDelete("runtimeBundleState")
    },
    assistantMaterializedSpec: {
      deleteMany: recordDelete("assistantMaterializedSpec")
    },
    assistantPublishedVersion: {
      deleteMany: recordDelete("assistantPublishedVersion"),
      updateMany: recordDelete("assistantPublishedVersion.updateMany")
    },
    assistantChannelSurfaceBinding: {
      deleteMany: recordDelete("assistantChannelSurfaceBinding")
    },
    assistantGovernance: {
      deleteMany: recordDelete("assistantGovernance")
    },
    assistantTelegramGroup: {
      deleteMany: recordDelete("assistantTelegramGroup")
    },
    assistantAuditEvent: {
      updateMany: async (args: unknown) => {
        auditUpdateCalls.push(args);
      }
    },
    assistant: {
      delete: recordDelete("assistant")
    },
    workspaceMember: {
      deleteMany: recordDelete("workspaceMember"),
      count: async () => 1
    },
    appUserAdminRole: {
      deleteMany: recordDelete("appUserAdminRole")
    },
    workspaceToolUsageDailyCounter: {
      deleteMany: recordDelete("workspaceToolUsageDailyCounter")
    },
    workspaceQuotaUsageEvent: {
      deleteMany: recordDelete("workspaceQuotaUsageEvent")
    },
    workspaceQuotaAccountingState: {
      deleteMany: recordDelete("workspaceQuotaAccountingState")
    },
    workspaceSubscription: {
      deleteMany: recordDelete("workspaceSubscription")
    },
    workspaceAdminNotificationChannel: {
      findMany: async () => [],
      deleteMany: recordDelete("workspaceAdminNotificationChannel")
    },
    adminNotificationDelivery: {
      deleteMany: recordDelete("adminNotificationDelivery")
    },
    workspace: {
      delete: recordDelete("workspace")
    },
    appUser: {
      delete: recordDelete("appUser")
    },
    $executeRawUnsafe: async (sql: string) => {
      rawSql.push(sql);
    }
  };

  const prisma = {
    appUser: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "user-1" ? { id: "user-1" } : null
    },
    assistant: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        where.userId === "user-1" ? assistant : null
    },
    workspaceMember: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        where.userId === "user-1" ? { workspaceId: "ws-1" } : null,
      count: async () => 1
    },
    assistantChatMessageAttachment: {
      aggregate: async () => ({
        _sum: { sizeBytes: BigInt(7) }
      })
    },
    assistantKnowledgeSource: {
      aggregate: async () => ({
        _sum: { sizeBytes: BigInt(11) }
      })
    },
    $transaction: async <T>(callback: (txArg: typeof tx) => Promise<T>) => callback(tx)
  };

  const service = new AdminDeleteUserService(
    prisma as never,
    {
      assertCanReadAdminSurface: async () => undefined
    } as Pick<AdminAuthorizationService, "assertCanReadAdminSurface"> as AdminAuthorizationService,
    {
      releaseMediaStorage: async (input: { sizeBytes: bigint }) => {
        releasedBytes.push(input.sizeBytes);
      },
      releaseKnowledgeStorage: async (input: { sizeBytes: bigint }) => {
        releasedKnowledgeBytes.push(input.sizeBytes);
      }
    } as never,
    {
      buildAssistantPrefix(assistantId: string) {
        return `assistant-media/assistants/${assistantId}/`;
      },
      async deletePrefix(prefix: string) {
        deletedPrefixes.push(prefix);
      }
    } as never,
    {
      buildAssistantPrefix(assistantId: string) {
        return `assistant-knowledge/assistants/${assistantId}/`;
      },
      async deletePrefix(prefix: string) {
        deletedPrefixes.push(prefix);
      }
    } as never
  );

  await service.execute("admin-1", "user-1");

  assert.deepEqual(deletedPrefixes, [
    "assistant-media/assistants/assistant-1/",
    "assistant-knowledge/assistants/assistant-1/"
  ]);
  assert.deepEqual(auditUpdateCalls, []);
  assert.equal(
    normalizeSql(rawSql[0] ?? ""),
    'ALTER TABLE "assistant_audit_events" DISABLE TRIGGER "assistant_audit_events_no_update"'
  );
  assert.equal(
    normalizeSql(rawSql[1] ?? ""),
    'ALTER TABLE "assistant_published_versions" DISABLE TRIGGER "assistant_published_versions_no_delete"'
  );
  assert.equal(
    normalizeSql(rawSql[2] ?? ""),
    'ALTER TABLE "assistant_published_versions" ENABLE TRIGGER "assistant_published_versions_no_delete"'
  );
  assert.equal(
    normalizeSql(rawSql[3] ?? ""),
    'ALTER TABLE "assistant_audit_events" ENABLE TRIGGER "assistant_audit_events_no_update"'
  );
  assert.ok(deleted.includes("assistantKnowledgeSource"));
  assert.ok(deleted.includes("runtimeBundleState"));
  assert.ok(deleted.indexOf("runtimeBundleState") < deleted.indexOf("assistantMaterializedSpec"));
  assert.ok(deleted.includes("assistant"));
  assert.ok(deleted.includes("appUser"));
  assert.deepEqual(releasedBytes, [BigInt(7)]);
  assert.deepEqual(releasedKnowledgeBytes, [BigInt(11)]);
}

void run();
