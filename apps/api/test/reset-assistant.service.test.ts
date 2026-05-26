import assert from "node:assert/strict";
import { ResetAssistantService } from "../src/modules/workspace-management/application/reset-assistant.service";

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function run(): Promise<void> {
  const deleted: string[] = [];
  const rawSql: string[] = [];
  const releasedMediaBytes: bigint[] = [];
  const releasedKnowledgeBytes: bigint[] = [];
  const deletedPrefixes: string[] = [];
  const auditEvents: Array<{ summary: string; eventCode: string }> = [];
  const assistant = {
    id: "assistant-1",
    workspaceId: "ws-1",
    userId: "user-1"
  };
  const recordDelete = (label: string) => async () => {
    deleted.push(label);
  };

  const tx = {
    assistant: {
      update: async () => undefined
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
      deleteMany: recordDelete("assistantPublishedVersion")
    },
    $executeRawUnsafe: async (sql: string) => {
      rawSql.push(sql);
    }
  };

  const prisma = {
    assistantKnowledgeSource: {
      aggregate: async () => ({
        _sum: { sizeBytes: BigInt(13) }
      })
    },
    $transaction: async <T>(callback: (txArg: typeof tx) => Promise<T>) => callback(tx)
  };

  const service = new ResetAssistantService(
    {} as never,
    {
      sumSizeBytesByAssistantId: async (assistantId: string) =>
        assistantId === "assistant-1" ? BigInt(5) : BigInt(0)
    } as never,
    prisma as never,
    {
      execute: async (event: { summary: string; eventCode: string }) => {
        auditEvents.push(event);
      }
    } as never,
    {
      releaseMediaStorage: async (input: { sizeBytes: bigint }) => {
        releasedMediaBytes.push(input.sizeBytes);
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
    } as never,
    {
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return { assistantId: assistant.id, assistant };
      }
    } as never
  );

  await service.execute("user-1");

  assert.ok(deleted.includes("assistantKnowledgeSource"));
  assert.ok(deleted.includes("assistantChat"));
  assert.ok(deleted.includes("runtimeBundleState"));
  assert.ok(deleted.includes("assistantMaterializedSpec"));
  assert.ok(deleted.indexOf("runtimeBundleState") < deleted.indexOf("assistantMaterializedSpec"));
  assert.deepEqual(deletedPrefixes, [
    "assistant-media/assistants/assistant-1/",
    "assistant-knowledge/assistants/assistant-1/"
  ]);
  assert.deepEqual(releasedMediaBytes, [BigInt(5)]);
  assert.deepEqual(releasedKnowledgeBytes, [BigInt(13)]);
  assert.equal(
    normalizeSql(rawSql[0] ?? ""),
    'ALTER TABLE "assistant_published_versions" DISABLE TRIGGER "assistant_published_versions_no_delete"'
  );
  assert.equal(
    normalizeSql(rawSql[1] ?? ""),
    'ALTER TABLE "assistant_published_versions" ENABLE TRIGGER "assistant_published_versions_no_delete"'
  );
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.eventCode, "assistant.full_reset");
  assert.equal(
    auditEvents[0]?.summary,
    "Full assistant reset: chats, memory, tasks, knowledge sources, runtime state, published versions, materialized specs, and workspace files deleted."
  );
}

void run();
