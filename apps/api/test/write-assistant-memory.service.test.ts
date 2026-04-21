import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { createDefaultMemoryControlEnvelope } from "../src/modules/workspace-management/domain/assistant-memory-control.defaults";
import type { AssistantChatRepository } from "../src/modules/workspace-management/domain/assistant-chat.repository";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import { WriteAssistantMemoryService } from "../src/modules/workspace-management/application/write-assistant-memory.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";

function createHarness(options?: {
  memoryControl?: Record<string, unknown> | null;
  relatedMessage?: { id: string; author: "user" | "assistant" | "system"; chatId: string } | null;
}) {
  const createdInputs: Array<Record<string, unknown>> = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const createdAt = new Date("2026-04-14T19:10:00.000Z");
  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftVoiceProfile: null,
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
    createdAt,
    updatedAt: createdAt
  };

  const assistantRepository: Pick<AssistantRepository, "findById"> = {
    async findById(id: string) {
      return id === assistant.id ? assistant : null;
    }
  };

  const governanceRepository: Pick<AssistantGovernanceRepository, "findByAssistantId"> = {
    async findByAssistantId() {
      if (options?.memoryControl === undefined) {
        return null;
      }
      return {
        id: "governance-1",
        assistantId: assistant.id,
        capabilityEnvelope: null,
        secretRefs: null,
        policyEnvelope: null,
        memoryControl: options.memoryControl,
        tasksControl: null,
        quotaHook: null,
        auditHook: null,
        assistantPlanOverrideCode: null,
        quotaPlanCode: null,
        createdAt,
        updatedAt: createdAt
      };
    }
  };

  const demoteCalls: Array<{ assistantId: string; demoteCount: number }> = [];
  const memoryRepository: Pick<
    AssistantMemoryRegistryRepository,
    "create" | "countActiveCoreByAssistantId" | "demoteOldestCoreByAssistantId"
  > = {
    async create(input) {
      createdInputs.push(input as Record<string, unknown>);
      return {
        id: "memory-1",
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        chatId: input.chatId,
        relatedUserMessageId: input.relatedUserMessageId,
        relatedAssistantMessageId: input.relatedAssistantMessageId,
        summary: input.summary,
        sourceType: input.sourceType,
        sourceLabel: input.sourceLabel,
        memoryClass: input.memoryClass,
        kind: input.kind,
        lastUsedAt: null,
        forgottenAt: null,
        createdAt
      } satisfies AssistantMemoryRegistryItem;
    },
    async countActiveCoreByAssistantId() {
      return 0;
    },
    async demoteOldestCoreByAssistantId(assistantId, demoteCount) {
      demoteCalls.push({ assistantId, demoteCount });
    }
  };

  const chatRepository: Pick<AssistantChatRepository, "findMessageByIdForAssistant"> = {
    async findMessageByIdForAssistant(messageId: string) {
      if (options?.relatedMessage === null) {
        return null;
      }
      if (!options?.relatedMessage || options.relatedMessage.id !== messageId) {
        return null;
      }
      return {
        id: options.relatedMessage.id,
        chatId: options.relatedMessage.chatId,
        assistantId: assistant.id,
        author: options.relatedMessage.author,
        content: "hello",
        createdAt
      };
    }
  };

  const appendAssistantAuditEventService: Pick<AppendAssistantAuditEventService, "execute"> = {
    async execute(input) {
      auditCalls.push(input as Record<string, unknown>);
    }
  };

  return {
    service: new WriteAssistantMemoryService(
      assistantRepository as AssistantRepository,
      governanceRepository as AssistantGovernanceRepository,
      memoryRepository as AssistantMemoryRegistryRepository,
      chatRepository as AssistantChatRepository,
      appendAssistantAuditEventService as AppendAssistantAuditEventService
    ),
    createdInputs,
    auditCalls,
    demoteCalls
  };
}

async function run(): Promise<void> {
  const happy = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope(),
    relatedMessage: {
      id: "message-1",
      author: "user",
      chatId: "chat-1"
    }
  });
  const parsed = happy.service.parseInput({
    assistantId: "assistant-1",
    kind: "preference",
    summary: "  User prefers concise answers.  ",
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: "message-1",
    requestId: "request-1"
  });
  assert.equal(parsed.summary, "User prefers concise answers.");
  const written = await happy.service.execute(parsed);
  assert.equal(written.written, true);
  assert.equal(written.item?.kind, "preference");
  assert.equal(written.item?.chatId, "chat-1");
  assert.deepEqual(happy.createdInputs[0], {
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    relatedUserMessageId: "message-1",
    relatedAssistantMessageId: null,
    summary: "User prefers concise answers.",
    sourceType: "memory_write",
    sourceLabel: "Memory write: preference",
    memoryClass: "core",
    kind: "preference"
  });
  assert.equal(happy.demoteCalls.length, 0);
  assert.equal(happy.auditCalls.length, 1);
  assert.equal(happy.auditCalls[0]?.eventCode, "assistant.memory_written");

  const denied = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope()
  });
  const deniedResult = await denied.service.execute({
    assistantId: "assistant-1",
    kind: "fact",
    summary: "User works in finance.",
    transportSurface: "telegram",
    sourceTrust: "group",
    relatedUserMessageId: null,
    requestId: "request-2"
  });
  assert.equal(deniedResult.written, false);
  assert.equal(deniedResult.code, "memory_group_global_write_denied");
  assert.equal(denied.createdInputs.length, 0);
  assert.equal(denied.auditCalls[0]?.eventCode, "assistant.memory_write_denied");

  await assert.rejects(
    async () =>
      happy.service.execute({
        assistantId: "assistant-1",
        kind: "fact",
        summary: "User works in finance.",
        transportSurface: "web",
        sourceTrust: "trusted_1to1",
        relatedUserMessageId: "missing-message",
        requestId: "request-3"
      }),
    (error) =>
      error instanceof BadRequestException &&
      error.message.includes("relatedUserMessageId does not belong to the assistant")
  );

  assert.throws(
    () =>
      happy.service.parseInput({
        assistantId: "assistant-1",
        kind: "preference",
        summary: "",
        transportSurface: "web",
        sourceTrust: "trusted_1to1"
      }),
    (error) =>
      error instanceof BadRequestException &&
      error.message.includes("Memory write payload is invalid")
  );
}

void run();
