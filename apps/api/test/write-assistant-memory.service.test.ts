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
  existingDuplicate?: AssistantMemoryRegistryItem | null;
  currentCoreCount?: number;
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
  const bumpCalls: Array<{ assistantId: string; ids: readonly string[] }> = [];
  const setResolvedCalls: Array<{ id: string; assistantId: string }> = [];
  const existingDuplicate = options?.existingDuplicate ?? null;
  const memoryRepository: Pick<
    AssistantMemoryRegistryRepository,
    | "create"
    | "countActiveCoreByAssistantId"
    | "demoteOldestCoreByAssistantId"
    | "findActiveByNormalizedSummaryAndAssistantId"
    | "bumpLastUsedAt"
    | "setResolvedAtById"
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
        durability: input.durability,
        stability: input.stability,
        confidence: input.confidence,
        embeddingVector: null,
        embeddingModelKey: null,
        embeddingGeneratedAt: null,
        lastUsedAt: null,
        resolvedAt: null,
        forgottenAt: null,
        supersededAt: null,
        supersededByMemoryId: null,
        createdAt
      } satisfies AssistantMemoryRegistryItem;
    },
    async countActiveCoreByAssistantId() {
      return options?.currentCoreCount ?? 0;
    },
    async demoteOldestCoreByAssistantId(assistantId, demoteCount) {
      demoteCalls.push({ assistantId, demoteCount });
      return demoteCount;
    },
    async findActiveByNormalizedSummaryAndAssistantId() {
      return existingDuplicate;
    },
    async bumpLastUsedAt(assistantId, ids) {
      bumpCalls.push({ assistantId, ids });
      return ids.length;
    },
    async setResolvedAtById(id, assistantId) {
      setResolvedCalls.push({ id, assistantId });
      return true;
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
    demoteCalls,
    bumpCalls,
    setResolvedCalls
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
    layer: "long",
    confidence: 0.91,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: "message-1",
    requestId: "request-1"
  });
  assert.equal(parsed.summary, "User prefers concise answers.");
  const written = await happy.service.execute(parsed);
  assert.equal(written.written, true);
  assert.equal(written.item?.kind, "preference");
  assert.equal(written.item?.layer, "long");
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
    sourceLabel: "Long memory write: preference",
    memoryClass: "core",
    kind: "preference",
    durability: "identity",
    stability: "stable",
    confidence: 0.91
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
    layer: "long",
    confidence: null,
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
        layer: "long",
        confidence: null,
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
        summary: "User prefers concise answers.",
        layer: "long",
        confidence: 2,
        transportSurface: "web",
        sourceTrust: "trusted_1to1"
      }),
    (error) =>
      error instanceof BadRequestException &&
      error.message.includes("Memory write payload is invalid")
  );

  // ADR-074 M2 server-side dedup: an active entry with identical normalized
  // summary should short-circuit the write, bump `last_used_at` on the
  // existing row, and return the existing item without creating a new one.
  const existingItem: AssistantMemoryRegistryItem = {
    id: "memory-existing",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    relatedUserMessageId: "message-1",
    relatedAssistantMessageId: null,
    summary: "User prefers concise answers.",
    sourceType: "memory_write",
    sourceLabel: "Long memory write: preference",
    memoryClass: "core",
    kind: "preference",
    durability: "identity",
    stability: "stable",
    confidence: 0.91,
    embeddingVector: null,
    embeddingModelKey: null,
    embeddingGeneratedAt: null,
    lastUsedAt: null,
    resolvedAt: null,
    forgottenAt: null,
    supersededAt: null,
    supersededByMemoryId: null,
    createdAt: new Date("2026-04-12T00:00:00.000Z")
  };
  const dup = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope(),
    relatedMessage: {
      id: "message-1",
      author: "user",
      chatId: "chat-1"
    },
    existingDuplicate: existingItem
  });
  const dupResult = await dup.service.execute({
    assistantId: "assistant-1",
    kind: "preference",
    summary: "User prefers concise answers.",
    layer: "long",
    confidence: 0.91,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: "message-1",
    requestId: "request-dup"
  });
  assert.equal(dupResult.written, false);
  assert.equal(dupResult.code, "duplicate");
  assert.equal(dupResult.item?.id, "memory-existing");
  assert.equal(dup.createdInputs.length, 0);
  assert.equal(dup.bumpCalls.length, 1);
  assert.deepEqual(dup.bumpCalls[0]?.ids, ["memory-existing"]);
  assert.equal(dup.auditCalls.length, 1);
  assert.equal(dup.auditCalls[0]?.eventCode, "assistant.memory_write_duplicate");
  assert.equal(
    dup.setResolvedCalls.length,
    0,
    "non-open_loop dedup must NOT trigger implicit close-by-overwrite"
  );

  // ADR-074 Slice M3 — implicit close-by-overwrite. When the dedup path
  // matches an existing `open_loop` row, the new memory_write should stamp
  // `resolved_at = now()` on it via setResolvedAtById, regardless of the
  // *new* memory's kind (the existing open_loop is what closes).
  const openLoopExisting: AssistantMemoryRegistryItem = {
    ...existingItem,
    id: "memory-loop",
    summary: "Need to pick a venue for the retreat.",
    kind: "open_loop",
    sourceLabel: "Short memory write: open loop"
  };
  const implicitClose = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope(),
    relatedMessage: {
      id: "message-1",
      author: "user",
      chatId: "chat-1"
    },
    existingDuplicate: openLoopExisting
  });
  const implicitCloseResult = await implicitClose.service.execute({
    assistantId: "assistant-1",
    kind: "open_loop",
    summary: "Need to pick a venue for the retreat.",
    layer: "short",
    confidence: 0.78,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: "message-1",
    requestId: "request-implicit-close"
  });
  assert.equal(implicitCloseResult.written, false);
  assert.equal(implicitCloseResult.code, "duplicate");
  assert.equal(implicitClose.setResolvedCalls.length, 1);
  assert.deepEqual(implicitClose.setResolvedCalls[0], {
    id: "memory-loop",
    assistantId: "assistant-1"
  });
  const implicitAuditDetails = implicitClose.auditCalls[0]?.details as Record<string, unknown>;
  assert.equal(implicitAuditDetails.implicitlyResolvedOpenLoop, true);
  // ADR-074 Slice M3.1 — implicit close-by-overwrite must mark its source so
  // ops can distinguish it from the explicit `closeOpenLoop:true` flag and
  // the new `memory_write({ action: "close", ref })` path.
  assert.equal(implicitAuditDetails.closeSource, "dedup_overwrite");

  // Already-resolved open_loop must NOT be re-resolved (idempotency).
  const alreadyResolvedLoop: AssistantMemoryRegistryItem = {
    ...openLoopExisting,
    id: "memory-loop-resolved",
    resolvedAt: new Date("2026-04-15T00:00:00.000Z")
  };
  const idempotent = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope(),
    relatedMessage: {
      id: "message-1",
      author: "user",
      chatId: "chat-1"
    },
    existingDuplicate: alreadyResolvedLoop
  });
  await idempotent.service.execute({
    assistantId: "assistant-1",
    kind: "open_loop",
    summary: "Need to pick a venue for the retreat.",
    layer: "short",
    confidence: 0.78,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: "message-1",
    requestId: "request-already-resolved"
  });
  assert.equal(
    idempotent.setResolvedCalls.length,
    0,
    "already-resolved open_loop dedup must NOT call setResolvedAtById again"
  );
  const idempotentAuditDetails = idempotent.auditCalls[0]?.details as Record<string, unknown>;
  assert.equal(idempotentAuditDetails.implicitlyResolvedOpenLoop, false);

  const episodicWish = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope()
  });
  const episodicWishResult = await episodicWish.service.execute({
    assistantId: "assistant-1",
    kind: "preference",
    summary: "Wants a talking-avatar video in Italian.",
    layer: "short",
    confidence: 0.72,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: null,
    requestId: "request-episodic"
  });
  assert.equal(episodicWishResult.written, true);
  assert.equal(episodicWish.createdInputs[0]?.memoryClass, "contextual");
  assert.equal(episodicWish.createdInputs[0]?.durability, "episodic");
  assert.equal(episodicWish.createdInputs[0]?.stability, "time_bound");
  assert.equal(episodicWishResult.item?.layer, "short");

  const timeBoundIdentity = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope()
  });
  const timeBoundIdentityResult = await timeBoundIdentity.service.execute({
    assistantId: "assistant-1",
    kind: "fact",
    summary: "Is traveling this week and needs quick replies.",
    layer: "short",
    confidence: 0.68,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: null,
    requestId: "request-time-bound"
  });
  assert.equal(timeBoundIdentityResult.written, true);
  assert.equal(timeBoundIdentity.createdInputs[0]?.memoryClass, "contextual");
  assert.equal(timeBoundIdentity.createdInputs[0]?.durability, "episodic");
  assert.equal(timeBoundIdentity.createdInputs[0]?.stability, "time_bound");

  const trivial = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope()
  });
  const trivialResult = await trivial.service.execute({
    assistantId: "assistant-1",
    kind: "fact",
    summary: "ok",
    layer: "long",
    confidence: 0.99,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: null,
    requestId: "request-trivial"
  });
  assert.equal(trivialResult.written, false);
  assert.equal(trivialResult.code, "not_durable");
  assert.equal(trivial.createdInputs.length, 0);

  const coreCap = createHarness({
    memoryControl: createDefaultMemoryControlEnvelope(),
    currentCoreCount: 15
  });
  const coreCapResult = await coreCap.service.execute({
    assistantId: "assistant-1",
    kind: "preference",
    summary: "Prefers terse 3-bullet answers.",
    layer: "long",
    confidence: 0.95,
    transportSurface: "web",
    sourceTrust: "trusted_1to1",
    relatedUserMessageId: null,
    requestId: "request-core-cap"
  });
  assert.equal(coreCapResult.written, true);
  assert.deepEqual(coreCap.demoteCalls, [{ assistantId: "assistant-1", demoteCount: 1 }]);
}

void run();
