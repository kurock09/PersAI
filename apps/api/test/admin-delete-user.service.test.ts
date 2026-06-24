import assert from "node:assert/strict";
import { AdminDeleteUserService } from "../src/modules/workspace-management/application/admin-delete-user.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function run(): Promise<void> {
  const rawSql: string[] = [];
  const auditUpdateCalls: Array<unknown> = [];
  const globalKnowledgeSourceUpdateCalls: Array<unknown> = [];
  const productKnowledgeTextEntryUpdateCalls: Array<unknown> = [];
  const skillUpdateCalls: Array<unknown> = [];
  const skillDocumentUpdateCalls: Array<unknown> = [];
  const skillKnowledgeCardUpdateCalls: Array<unknown> = [];
  const workspaceMemberUpdateCalls: Array<unknown> = [];
  const deleted: string[] = [];
  const releasedBytes: bigint[] = [];
  const releasedKnowledgeBytes: bigint[] = [];
  const deletedPrefixes: string[] = [];
  let activeAssistantReferenceCleared = false;
  const recordDelete = (label: string) => async () => {
    deleted.push(label);
  };

  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    handle: "test-handle",
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

  const sandboxGcLeaseCreates: Array<unknown> = [];
  const tx = {
    sandboxWorkspaceGcLease: {
      create: async (args: unknown) => {
        sandboxGcLeaseCreates.push(args);
        deleted.push("sandboxWorkspaceGcLease.create");
      }
    },
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
    globalKnowledgeSource: {
      updateMany: async (args: unknown) => {
        globalKnowledgeSourceUpdateCalls.push(args);
      }
    },
    productKnowledgeTextEntry: {
      updateMany: async (args: unknown) => {
        productKnowledgeTextEntryUpdateCalls.push(args);
      }
    },
    skill: {
      updateMany: async (args: unknown) => {
        skillUpdateCalls.push(args);
      }
    },
    skillDocument: {
      updateMany: async (args: unknown) => {
        skillDocumentUpdateCalls.push(args);
      }
    },
    skillKnowledgeCard: {
      updateMany: async (args: unknown) => {
        skillKnowledgeCardUpdateCalls.push(args);
      }
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
      delete: async () => {
        assert.equal(
          activeAssistantReferenceCleared,
          true,
          "active assistant pointer should be cleared before assistant deletion"
        );
        deleted.push("assistant");
      }
    },
    workspaceMember: {
      deleteMany: recordDelete("workspaceMember"),
      updateMany: async (args: unknown) => {
        workspaceMemberUpdateCalls.push(args);
        activeAssistantReferenceCleared = true;
        deleted.push("workspaceMember.updateMany");
      },
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
      findMany: async ({ where }: { where: { userId: string } }) =>
        where.userId === "user-1" ? [assistant] : []
    },
    workspaceMember: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        where.userId === "user-1"
          ? { workspaceId: "ws-1", activeAssistantId: "assistant-1" }
          : null,
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
  assert.deepEqual(globalKnowledgeSourceUpdateCalls, [
    { where: { createdByUserId: "user-1" }, data: { createdByUserId: "admin-1" } }
  ]);
  assert.deepEqual(productKnowledgeTextEntryUpdateCalls, [
    { where: { createdByUserId: "user-1" }, data: { createdByUserId: "admin-1" } }
  ]);
  assert.deepEqual(skillUpdateCalls, [
    { where: { createdByUserId: "user-1" }, data: { createdByUserId: "admin-1" } }
  ]);
  assert.deepEqual(skillDocumentUpdateCalls, [
    { where: { createdByUserId: "user-1" }, data: { createdByUserId: "admin-1" } }
  ]);
  assert.deepEqual(skillKnowledgeCardUpdateCalls, [
    { where: { createdByUserId: "user-1" }, data: { createdByUserId: "admin-1" } }
  ]);
  assert.deepEqual(workspaceMemberUpdateCalls, [
    {
      where: { activeAssistantId: "assistant-1" },
      data: { activeAssistantId: null }
    }
  ]);
  assert.deepEqual(auditUpdateCalls, [
    { where: { actorUserId: "user-1" }, data: { actorUserId: null } }
  ]);
  const normalizedRawSql = rawSql.map(normalizeSql);
  assert.ok(
    normalizedRawSql.includes(
      'ALTER TABLE "assistant_audit_events" DISABLE TRIGGER "assistant_audit_events_no_update"'
    )
  );
  assert.ok(
    normalizedRawSql.includes(
      'ALTER TABLE "assistant_audit_events" ENABLE TRIGGER "assistant_audit_events_no_update"'
    )
  );
  assert.ok(
    normalizedRawSql.includes(
      'ALTER TABLE "assistant_published_versions" DISABLE TRIGGER "assistant_published_versions_no_delete"'
    )
  );
  assert.ok(
    normalizedRawSql.includes(
      'ALTER TABLE "assistant_published_versions" ENABLE TRIGGER "assistant_published_versions_no_delete"'
    )
  );
  assert.ok(
    normalizedRawSql.includes(
      'DELETE FROM "assistant_web_chat_turn_attempts" WHERE "assistant_id" = $1::uuid'
    )
  );
  assert.ok(deleted.includes("assistantKnowledgeSource"));
  assert.ok(deleted.includes("runtimeBundleState"));
  assert.ok(deleted.indexOf("runtimeBundleState") < deleted.indexOf("assistantMaterializedSpec"));
  assert.ok(deleted.indexOf("workspaceMember.updateMany") < deleted.indexOf("assistant"));
  assert.ok(deleted.includes("assistant"));
  assert.ok(deleted.includes("appUser"));
  assert.deepEqual(releasedBytes, [BigInt(7)]);
  assert.deepEqual(releasedKnowledgeBytes, [BigInt(11)]);

  assert.equal(sandboxGcLeaseCreates.length, 1, "expected one assistant_outbound GC lease");
  const lease = sandboxGcLeaseCreates[0] as {
    data: { kind: string; targetId: string; metadata: { handle: string } };
  };
  assert.equal(lease.data.kind, "assistant_outbound");
  assert.equal(lease.data.targetId, "assistant-1");
  assert.equal(lease.data.metadata.handle, "test-handle");
  assert.ok(
    deleted.indexOf("sandboxWorkspaceGcLease.create") < deleted.indexOf("assistant"),
    "GC lease must be written before assistant row is deleted"
  );
}

void run();
