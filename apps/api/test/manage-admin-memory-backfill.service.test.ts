import assert from "node:assert/strict";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import { ManageAdminMemoryBackfillService } from "../src/modules/workspace-management/application/manage-admin-memory-backfill.service";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";

type MemoryRow = AssistantMemoryRegistryItem;

function buildMemory(overrides: Partial<MemoryRow> & Pick<MemoryRow, "id" | "summary">): MemoryRow {
  return {
    id: overrides.id,
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: null,
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: overrides.summary,
    sourceType: "memory_write",
    sourceLabel: null,
    memoryClass: "contextual",
    kind: "fact",
    durability: "episodic",
    stability: "stable",
    confidence: 0.7,
    embeddingVector: null,
    embeddingModelKey: null,
    embeddingGeneratedAt: null,
    lastUsedAt: null,
    resolvedAt: null,
    forgottenAt: null,
    supersededAt: null,
    supersededByMemoryId: null,
    createdAt: new Date("2026-06-07T21:00:00.000Z"),
    ...overrides
  };
}

function createHarness(memories: MemoryRow[]) {
  const listCalls: Array<{ assistantId: string; limit: number }> = [];
  const reclassifyCalls: Array<{
    id: string;
    assistantId: string;
    memoryClass: MemoryRow["memoryClass"];
  }> = [];
  const forgottenCalls: Array<{ id: string; assistantId: string }> = [];
  const readCalls: string[] = [];
  const dangerousCalls: Array<{
    userId: string;
    action: string;
    stepUpToken: string | null;
  }> = [];
  const auditCalls: Array<Record<string, unknown>> = [];

  const repository: Pick<
    AssistantMemoryRegistryRepository,
    "listActiveForBackfill" | "reclassifyMemoryClassById" | "markForgottenById"
  > = {
    async listActiveForBackfill(assistantId, limit) {
      listCalls.push({ assistantId, limit });
      return memories;
    },
    async reclassifyMemoryClassById(id, assistantId, memoryClass) {
      reclassifyCalls.push({ id, assistantId, memoryClass });
      return true;
    },
    async markForgottenById(id, assistantId) {
      forgottenCalls.push({ id, assistantId });
      return true;
    }
  };

  const adminAuthorizationService: Pick<
    AdminAuthorizationService,
    "assertCanReadAdminSurface" | "assertCanPerformDangerousAdminAction"
  > = {
    async assertCanReadAdminSurface(userId) {
      readCalls.push(userId);
      return {
        userId,
        workspaceId: "workspace-1",
        roles: ["ops_admin"],
        hasGlobalPlatformAdminScope: true
      };
    },
    async assertCanPerformDangerousAdminAction(userId, action, stepUpToken) {
      dangerousCalls.push({ userId, action, stepUpToken });
      if (stepUpToken === null) {
        throw new Error("Dangerous admin actions require step-up token.");
      }
      return {
        userId,
        workspaceId: "workspace-1",
        roles: ["ops_admin"],
        hasGlobalPlatformAdminScope: true
      };
    }
  };

  const appendAssistantAuditEventService: Pick<AppendAssistantAuditEventService, "execute"> = {
    async execute(input) {
      auditCalls.push(input as Record<string, unknown>);
    }
  };

  return {
    service: new ManageAdminMemoryBackfillService(
      repository as AssistantMemoryRegistryRepository,
      adminAuthorizationService as AdminAuthorizationService,
      appendAssistantAuditEventService as AppendAssistantAuditEventService
    ),
    listCalls,
    reclassifyCalls,
    forgottenCalls,
    readCalls,
    dangerousCalls,
    auditCalls
  };
}

async function runPreviewMixedSet(): Promise<void> {
  const keptIdentityCore = buildMemory({
    id: "identity-core",
    summary: "User's name is Alex.",
    memoryClass: "core",
    durability: "identity",
    stability: "stable",
    createdAt: new Date("2026-06-07T21:05:00.000Z")
  });
  const episodicCore = buildMemory({
    id: "episodic-core",
    summary: "User wants a talking-avatar video in Italian.",
    memoryClass: "core",
    durability: "episodic",
    stability: "stable",
    createdAt: new Date("2026-06-07T21:04:00.000Z")
  });
  const trivialWebChat = buildMemory({
    id: "trivial-web-chat",
    summary: "hello",
    sourceType: "web_chat",
    memoryClass: "contextual",
    createdAt: new Date("2026-06-07T21:03:00.000Z")
  });
  const substantiveWebChat = buildMemory({
    id: "substantive-web-chat",
    summary: "User asked for a 3-step launch checklist.",
    sourceType: "web_chat",
    memoryClass: "contextual",
    createdAt: new Date("2026-06-07T21:02:00.000Z")
  });
  const contextualMemory = buildMemory({
    id: "contextual-memory",
    summary: "User prefers answers with one example.",
    memoryClass: "contextual",
    durability: "identity",
    stability: "stable",
    createdAt: new Date("2026-06-07T21:01:00.000Z")
  });
  const harness = createHarness([
    keptIdentityCore,
    episodicCore,
    trivialWebChat,
    substantiveWebChat,
    contextualMemory
  ]);

  const impact = await harness.service.preview("admin-1", { assistantId: "assistant-1" });

  assert.equal(impact.assistantId, "assistant-1");
  assert.equal(impact.scannedActive, 5);
  assert.equal(impact.reclassifyCoreToContextual.count, 1);
  assert.deepEqual(impact.reclassifyCoreToContextual.sample, [
    {
      id: "episodic-core",
      summary: "User wants a talking-avatar video in Italian.",
      durability: "episodic",
      stability: "stable"
    }
  ]);
  assert.equal(impact.pruneTrivialWebChat.count, 1);
  assert.deepEqual(impact.pruneTrivialWebChat.sample, [
    {
      id: "trivial-web-chat",
      summary: "hello"
    }
  ]);
  assert.deepEqual(harness.readCalls, ["admin-1"]);
  assert.equal(harness.dangerousCalls.length, 0);
  assert.equal(harness.reclassifyCalls.length, 0);
  assert.equal(harness.forgottenCalls.length, 0);
}

async function runApplyWithStepUp(): Promise<void> {
  const episodicCore = buildMemory({
    id: "episodic-core",
    summary: "User wants a talking-avatar video in Italian.",
    memoryClass: "core",
    durability: "episodic",
    stability: "stable",
    createdAt: new Date("2026-06-07T21:04:00.000Z")
  });
  const trivialWebChat = buildMemory({
    id: "trivial-web-chat",
    summary: "hello",
    sourceType: "web_chat",
    memoryClass: "contextual",
    createdAt: new Date("2026-06-07T21:03:00.000Z")
  });
  const keptIdentityCore = buildMemory({
    id: "identity-core",
    summary: "User's name is Alex.",
    memoryClass: "core",
    durability: "identity",
    stability: "stable",
    createdAt: new Date("2026-06-07T21:02:00.000Z")
  });
  const harness = createHarness([episodicCore, trivialWebChat, keptIdentityCore]);

  const result = await harness.service.apply("admin-1", { assistantId: "assistant-1" }, "step-up");

  assert.deepEqual(harness.dangerousCalls, [
    {
      userId: "admin-1",
      action: "admin.memory_backfill.apply",
      stepUpToken: "step-up"
    }
  ]);
  assert.deepEqual(harness.forgottenCalls, [
    {
      id: "trivial-web-chat",
      assistantId: "assistant-1"
    }
  ]);
  assert.deepEqual(harness.reclassifyCalls, [
    {
      id: "episodic-core",
      assistantId: "assistant-1",
      memoryClass: "contextual"
    }
  ]);
  assert.equal(result.reclassified, 1);
  assert.equal(result.pruned, 1);
  assert.equal(result.scannedActive, 3);
  assert.equal(harness.auditCalls.length, 1);
  assert.deepEqual(harness.auditCalls[0], {
    workspaceId: "workspace-1",
    assistantId: "assistant-1",
    actorUserId: "admin-1",
    eventCategory: "admin_action",
    eventCode: "admin.memory_backfill.apply",
    summary: "Admin applied safe assistant memory backfill.",
    details: {
      assistantId: "assistant-1",
      reclassified: 1,
      pruned: 1,
      scannedActive: 3
    }
  });
}

async function runApplyWithoutStepUpThrows(): Promise<void> {
  const episodicCore = buildMemory({
    id: "episodic-core",
    summary: "User wants a talking-avatar video in Italian.",
    memoryClass: "core"
  });
  const harness = createHarness([episodicCore]);

  await assert.rejects(
    harness.service.apply("admin-1", { assistantId: "assistant-1" }, null),
    /step-up token/i
  );
  assert.equal(harness.forgottenCalls.length, 0);
  assert.equal(harness.reclassifyCalls.length, 0);
  assert.equal(harness.auditCalls.length, 0);
}

async function runPruneWinsOverReclassify(): Promise<void> {
  const bothTargets = buildMemory({
    id: "both-targets",
    summary: "hi",
    sourceType: "web_chat",
    memoryClass: "core",
    durability: "episodic",
    stability: "time_bound"
  });
  const harness = createHarness([bothTargets]);

  const result = await harness.service.apply("admin-1", { assistantId: "assistant-1" }, "step-up");

  assert.deepEqual(harness.forgottenCalls, [
    {
      id: "both-targets",
      assistantId: "assistant-1"
    }
  ]);
  assert.equal(harness.reclassifyCalls.length, 0);
  assert.equal(result.pruned, 1);
  assert.equal(result.reclassified, 0);
}

async function main(): Promise<void> {
  await runPreviewMixedSet();
  await runApplyWithStepUp();
  await runApplyWithoutStepUpThrows();
  await runPruneWinsOverReclassify();
}

void main();
